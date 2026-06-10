import { getNetworkStore } from './storeLinker';
import { useEnvironmentStore } from './environmentSlice';
import { useFlareStore } from './flareSlice';
import { useChunkStore } from './chunkSlice';
import { useInventoryStore } from './inventorySlice';
import { v4 as uuidV4 } from 'uuid';
import { saveChunkToDB, loadChunkFromDB, clearDB, cancelLoadFromDB, flushWAL } from '../utils/db';
import { BlockRegistry, BlockById, BlockKeyById, BlockIds } from '../registry/BlockRegistry';
import { setBlock, getIndex, getTextureId, CHUNK_Y_MIN, CHUNK_Y_MAX, getIsHidden, CHUNK_VOLUME } from '../utils/chunkData';
import { chunkWorkerPool } from '../utils/workerPool';
import { getSeed } from '../worldSeed';
import { tickFluids, wakeFluidsAround } from '../utils/fluidSystem';
import { checkStructuralIntegrity } from '../utils/structuralPhysics';
import { EventBus } from '../utils/EventBus';


// Module-level guard: prevents two concurrent async calls from double-generating
// the same chunk (race condition when the player moves fast).
const inFlightChunks = new Set();
const cancelledChunks = new Set();
const processingNetworkDeltas = new Set();
// --- Dirty-set rebuild batching (replaces per-chunk setTimeout debounce) ---
// Advantages over debounce:
//  1. Flood-resistant: 1000 block changes in one frame = 1 rebuild per unique chunk, never deferred indefinitely
//  2. Frame-aligned: fires at the START of the next rAF, not a wall-clock offset racing mid-render
//  3. Zero timer overhead: Set.add() is O(1) vs clearTimeout/setTimeout allocation per event
//  4. Scales with framerate: fast machines rebuild sooner, slow machines group more automatically
const dirtyChunkSet = new Set();
const inFlightRebuildSet = new Set(); // Prevents duplicate concurrent workers per chunk
let rafRebuildHandle = null;
let worldReadyForRebuild = false; // mirrors isWorldReady — set below once store is live

const flushDirtyChunks = (get, rawGet, rawSet) => {
  rafRebuildHandle = null;
  if (dirtyChunkSet.size === 0) return;

  // Drain the set — snapshot it so any new additions during async work go into the next frame
  const toRebuild = [...dirtyChunkSet];
  dirtyChunkSet.clear();

  for (const chunkKey of toRebuild) {
    if (inFlightRebuildSet.has(chunkKey)) {
      // Worker already running for this chunk — re-dirty it so it rebuilds again after completion
      dirtyChunkSet.add(chunkKey);
      continue;
    }
    _executeRebuild(chunkKey, get, rawGet, rawSet);
  }
};

const scheduleRafFlush = (get, rawGet, rawSet) => {
  if (rafRebuildHandle !== null) return; // Already scheduled
  rafRebuildHandle = requestAnimationFrame(() => flushDirtyChunks(get, rawGet, rawSet));
};
export const pass1Cache = new Map();
const flareLightMap = new Map();
const bufferRecycleQueue = [];
let bufferRecycleTimer = null;
const flushBufferRecycleQueue = () => {
  if (bufferRecycleQueue.length > 0) {
    const validBuffers = [];
    for (let i = 0; i < bufferRecycleQueue.length; i++) {
      if (bufferRecycleQueue[i] && bufferRecycleQueue[i].byteLength > 0) {
        validBuffers.push(bufferRecycleQueue[i]);
      }
    }
    if (validBuffers.length > 0) {
      chunkWorkerPool.recycleBuffers(validBuffers);
    }
    bufferRecycleQueue.length = 0;
  }
};
const getChunkKey = (x, z) => `${Math.floor(x / 16)},${Math.floor(z / 16)}`;
const getBlockKey = (x, y, z) => `${x},${y},${z}`;
let currentRawGet = null;
const staticWorldProxy = new Proxy({}, {
  get: (target, prop) => {
    if (prop === 'chunks' || prop === 'pendingMeshMounts' || prop === 'overflowChunks' || prop === 'activePhysicsChunks') {
      return useChunkStore.getState()[prop];
    }
    if (prop === 'chests' || prop === 'droppedItems' || prop === 'tombstones' || prop === 'debris' || prop === 'fallingStructures') {
      return useInventoryStore.getState()[prop];
    }
    if (prop === 'worldTime' || prop === 'daysElapsed' || prop === 'isRaining' || prop === 'isNightTime' || prop === 'skyColor' || prop === 'fogDensity') {
      return useEnvironmentStore.getState()[prop];
    }
    if (prop === 'placedFlares') {
      return useFlareStore.getState()[prop];
    }
    return currentRawGet ? currentRawGet()[prop] : undefined;
  }
});

const getCombinedState = (rawGet) => {
  currentRawGet = rawGet;
  return staticWorldProxy;
};

export const worldActions = (rawSet, rawGet) => {
  const set = rawSet;
  const get = rawGet;
  return {
    batcherVersion: 0,
    incrementBatcherVersion: () => rawSet(state => ({
      batcherVersion: state.batcherVersion + 1
    })),
    pass1Cache: pass1Cache,
    pendingDeltas: {},
    isResetting: false,
    tickFluids: () => tickFluids(rawGet, rawSet),
    queueBuffersForRecycling: buffers => {
      if (!buffers || buffers.length === 0) return;
      for (let i = 0; i < buffers.length; i++) {
        if (buffers[i] && buffers[i].byteLength > 0) {
          bufferRecycleQueue.push(buffers[i]);
        }
      }
      if (!bufferRecycleTimer) {
        bufferRecycleTimer = setTimeout(() => {
          flushBufferRecycleQueue();
          bufferRecycleTimer = null;
        }, 2000);
      }
    },
    mountNextMesh: (batchSize = 1) => {
      const chunkState = useChunkStore.getState();
      if (!chunkState.pendingMeshMounts || chunkState.pendingMeshMounts.length === 0) return;
      const actualBatchSize = Math.min(batchSize, chunkState.pendingMeshMounts.length);
      const batch = chunkState.pendingMeshMounts.slice(0, actualBatchSize);
      const nextChunks = {};
      const addedOverflow = [];
      const toRecycle = {};
      for (const nextMount of batch) {
        const existingChunk = useChunkStore.getState().chunks[nextMount.chunkKey];
        if (!existingChunk) {
          if (nextMount.meshArrays) {
            for (const [key, group] of Object.entries(nextMount.meshArrays)) {
              if (!group._isCached) toRecycle[`${nextMount.chunkKey}_${key}`] = group;
            }
          }
          continue;
        }
        let tightMeshArrays = null;
        if (nextMount.meshArrays) {
          tightMeshArrays = {};

          // Zero-copy transfer: The Web Worker already transferred the ArrayBuffer ownership to the main thread.
          // Slicing it here duplicates memory on the JS heap, causing massive GC pauses!
          for (const [key, group] of Object.entries(nextMount.meshArrays)) {
            if (group && group._isCached) {
              tightMeshArrays[key] = group;
            } else if (group && group.buffer && group.byteLength !== undefined) {
              // It's a direct TypedArray (like __flora)
              tightMeshArrays[key] = group;
            } else if (Array.isArray(group)) {
              tightMeshArrays[key] = group.map(subGroup => {
                if (subGroup && subGroup._isCached) return subGroup;
                const sub = {};
                for (const prop in subGroup) {
                  sub[prop] = subGroup[prop];
                }
                return sub;
              });
            } else if (group) {
              // It's an object containing TypedArrays (like solid, transparent)
              tightMeshArrays[key] = {};
              for (const prop in group) {
                tightMeshArrays[key][prop] = group[prop];
              }
            } else {
              tightMeshArrays[key] = group;
            }
          }
          if (!addedOverflow.includes(nextMount.chunkKey)) {
            addedOverflow.push(nextMount.chunkKey);
          }
        }
        const finalMeshArrays = {
          ...tightMeshArrays
        };
        if (existingChunk.physicsRebuildId === (existingChunk.rebuildId || 0) && existingChunk.meshArrays?.__physics) {
          finalMeshArrays.__physics = existingChunk.meshArrays.__physics;
        }
        nextChunks[nextMount.chunkKey] = {
          ...existingChunk,
          meshArrays: finalMeshArrays,
          physicsRebuildId: nextMount.rebuildId ?? (existingChunk.rebuildId || 0)
        };
      }
      const buffersToRecycle = [];
      for (const group of Object.values(toRecycle)) {
        if (!group) continue;
        if (Array.isArray(group)) {
          for (const sub of group) {
            ['pos', 'norm', 'color', 'uv'].forEach(attr => {
              if (sub[attr] && sub[attr].buffer && sub[attr].buffer.byteLength > 0) {
                buffersToRecycle.push(sub[attr].buffer);
              }
            });
            if (sub.idx && sub.idx.buffer && sub.idx.buffer.byteLength > 0) {
              buffersToRecycle.push(sub.idx.buffer);
            }
          }
        } else {
          ['pos', 'norm', 'color', 'uv'].forEach(attr => {
            if (group[attr] && group[attr].buffer && group[attr].buffer.byteLength > 0) {
              buffersToRecycle.push(group[attr].buffer);
            }
          });
          if (group.idx && group.idx.buffer && group.idx.buffer.byteLength > 0) {
            buffersToRecycle.push(group.idx.buffer);
          }
        }
      }
      if (buffersToRecycle.length > 0) {
        get().queueBuffersForRecycling(buffersToRecycle);
      }
      (() => {
        const prev = getCombinedState(rawGet);
        const nextPending = prev.pendingMeshMounts.slice(actualBatchSize);
        const nextOverflow = [...prev.overflowChunks];
        for (const k of addedOverflow) {
          if (!nextOverflow.includes(k)) nextOverflow.push(k);
        }
        const __patch = (prev => ({
          pendingMeshMounts: nextPending,
          overflowChunks: nextOverflow,
          chunks: {
            ...prev.chunks,
            ...nextChunks
          }
        }))(prev);
        if (__patch.chunks !== undefined || __patch.pendingMeshMounts !== undefined || __patch.overflowChunks !== undefined || __patch.activePhysicsChunks !== undefined) {
          const cPatch = {};
          if (__patch.chunks !== undefined) cPatch.chunks = __patch.chunks;
          if (__patch.pendingMeshMounts !== undefined) cPatch.pendingMeshMounts = __patch.pendingMeshMounts;
          if (__patch.overflowChunks !== undefined) cPatch.overflowChunks = __patch.overflowChunks;
          if (__patch.activePhysicsChunks !== undefined) cPatch.activePhysicsChunks = __patch.activePhysicsChunks;
          useChunkStore.setState(cPatch);
        }
        if (__patch.debris !== undefined || __patch.fallingStructures !== undefined || __patch.chests !== undefined || __patch.droppedItems !== undefined || __patch.tombstones !== undefined) {
          const iPatch = {};
          if (__patch.debris !== undefined) iPatch.debris = __patch.debris;
          if (__patch.fallingStructures !== undefined) iPatch.fallingStructures = __patch.fallingStructures;
          if (__patch.chests !== undefined) iPatch.chests = __patch.chests;
          if (__patch.droppedItems !== undefined) iPatch.droppedItems = __patch.droppedItems;
          if (__patch.tombstones !== undefined) iPatch.tombstones = __patch.tombstones;
          useInventoryStore.setState(iPatch);
        }
        if (__patch.placedFlares !== undefined) useFlareStore.setState({
          placedFlares: __patch.placedFlares
        });
        if (__patch.worldTime !== undefined) {
          useEnvironmentStore.setState({
            worldTime: __patch.worldTime,
            currentDay: __patch.currentDay,
            isNightTime: __patch.isNightTime,
            isRaining: __patch.isRaining,
            skyColor: __patch.skyColor,
            fogDensity: __patch.fogDensity
          });
        }
        if (__patch.pendingDeltas !== undefined || __patch.isResetting !== undefined || __patch.batcherVersion !== undefined) {
          const rawPatch = {};
          if (__patch.pendingDeltas !== undefined) rawPatch.pendingDeltas = __patch.pendingDeltas;
          if (__patch.isResetting !== undefined) rawPatch.isResetting = __patch.isResetting;
          if (__patch.batcherVersion !== undefined) rawPatch.batcherVersion = __patch.batcherVersion;
          rawSet(rawPatch);
        }
      })();
    },
    resetWorld: async () => {
      if (useStore.getState().isResetting) return;
      rawSet({
        isResetting: true
      });
      useChunkStore.setState({
        pendingMeshMounts: []
      });
      chunkWorkerPool._queue = [];
      inFlightChunks.clear();
      cancelledChunks.clear();
      pass1Cache.clear();
      await clearDB();
      rawSet({
        isResetting: false,
        pendingDeltas: {}
      });
      useChunkStore.setState({
        chunks: {}
      });
      useInventoryStore.setState({
        debris: []
      });
      useFlareStore.setState({
        placedFlares: []
      });
      const prefix = sessionStorage.getItem('saveSlotId') || 'default';
      sessionStorage.removeItem('saveSlotId');
      localStorage.removeItem(`saveMetadata_${prefix}`);
      window.location.reload();
    },
    applyWorldSync: chunksData => {
      (() => {
        const prev = getCombinedState(rawGet);
        const __patch = (prev => {
          const newChunks = {
            ...prev.chunks
          };
          let updated = false;
          for (const chunkKey in chunksData) {
            const rawBuf = chunksData[chunkKey];
            if (newChunks[chunkKey] && newChunks[chunkKey].buffer) {
              const target = newChunks[chunkKey].buffer;
              if (rawBuf instanceof Uint8Array || rawBuf instanceof Uint32Array) {
                target.set(new Uint32Array(rawBuf.buffer, rawBuf.byteOffset, rawBuf.byteLength / 4));
              } else {
                target.set(new Uint32Array(rawBuf));
              }
              newChunks[chunkKey] = {
                ...newChunks[chunkKey],
                isModified: true,
                rebuildId: (newChunks[chunkKey].rebuildId || 0) + 1
              };
              updated = true;
            } else {
              let newBuffer;
              if (rawBuf instanceof Uint8Array || rawBuf instanceof Uint32Array) {
                const exactBuffer = rawBuf.buffer.slice(rawBuf.byteOffset, rawBuf.byteOffset + rawBuf.byteLength);
                newBuffer = new Uint32Array(exactBuffer);
              } else if (rawBuf instanceof ArrayBuffer) {
                newBuffer = new Uint32Array(rawBuf);
              } else {
                newBuffer = new Uint32Array(rawBuf); // Fallback
              }
              if (!newChunks[chunkKey]) {
                newChunks[chunkKey] = {
                  buffer: newBuffer,
                  isModified: true,
                  rebuildId: 1
                };
              }
              updated = true;
            }

            // Apply any pending deltas that arrived before this sync
            const pending = prev.pendingDeltas[chunkKey];
            if (pending) {
              for (let i = 0; i < pending.length; i += 2) {
                newChunks[chunkKey].buffer[pending[i]] = pending[i + 1];
              }
            }
          }
          return updated ? {
            chunks: newChunks
          } : {};
        })(prev);
        if (__patch.chunks !== undefined || __patch.pendingMeshMounts !== undefined || __patch.overflowChunks !== undefined || __patch.activePhysicsChunks !== undefined) {
          const cPatch = {};
          if (__patch.chunks !== undefined) cPatch.chunks = __patch.chunks;
          if (__patch.pendingMeshMounts !== undefined) cPatch.pendingMeshMounts = __patch.pendingMeshMounts;
          if (__patch.overflowChunks !== undefined) cPatch.overflowChunks = __patch.overflowChunks;
          if (__patch.activePhysicsChunks !== undefined) cPatch.activePhysicsChunks = __patch.activePhysicsChunks;
          useChunkStore.setState(cPatch);
        }
        if (__patch.debris !== undefined || __patch.fallingStructures !== undefined || __patch.chests !== undefined || __patch.droppedItems !== undefined || __patch.tombstones !== undefined) {
          const iPatch = {};
          if (__patch.debris !== undefined) iPatch.debris = __patch.debris;
          if (__patch.fallingStructures !== undefined) iPatch.fallingStructures = __patch.fallingStructures;
          if (__patch.chests !== undefined) iPatch.chests = __patch.chests;
          if (__patch.droppedItems !== undefined) iPatch.droppedItems = __patch.droppedItems;
          if (__patch.tombstones !== undefined) iPatch.tombstones = __patch.tombstones;
          useInventoryStore.setState(iPatch);
        }
        if (__patch.placedFlares !== undefined) useFlareStore.setState({
          placedFlares: __patch.placedFlares
        });
        if (__patch.worldTime !== undefined) {
          useEnvironmentStore.setState({
            worldTime: __patch.worldTime,
            currentDay: __patch.currentDay,
            isNightTime: __patch.isNightTime,
            isRaining: __patch.isRaining,
            skyColor: __patch.skyColor,
            fogDensity: __patch.fogDensity
          });
        }
        if (__patch.pendingDeltas !== undefined || __patch.isResetting !== undefined || __patch.batcherVersion !== undefined) {
          const rawPatch = {};
          if (__patch.pendingDeltas !== undefined) rawPatch.pendingDeltas = __patch.pendingDeltas;
          if (__patch.isResetting !== undefined) rawPatch.isResetting = __patch.isResetting;
          if (__patch.batcherVersion !== undefined) rawPatch.batcherVersion = __patch.batcherVersion;
          rawSet(rawPatch);
        }
      })();
      // Need to rebuild all synced chunks!
      for (const chunkKey in chunksData) {
        get().requestMeshRebuild(chunkKey);
      }
    },
    applyNetworkDelta: (chunkKey, deltas) => {
      // Incoming from WebRTC!
      let rebuilds = new Set();
      (() => {
        const prev = getCombinedState(rawGet);
        const __patch = (prev => {
          const prevChunkData = prev.chunks[chunkKey];
          if (!prevChunkData) {
            // Silently load, apply, and save to DB in the background to prevent data loss!
            if (!processingNetworkDeltas.has(chunkKey)) {
              processingNetworkDeltas.add(chunkKey);
              setTimeout(async () => {
                try {
                  const processingDeltas = useStore.getState().pendingDeltas[chunkKey];
                  if (!processingDeltas) return;
                  (() => {
                    const prev = getCombinedState(rawGet);
                    const __patch = (s => {
                      const next = {
                        ...s.pendingDeltas
                      };
                      delete next[chunkKey];
                      return {
                        pendingDeltas: next
                      };
                    })(prev);
                    if (__patch.chunks !== undefined || __patch.pendingMeshMounts !== undefined || __patch.overflowChunks !== undefined || __patch.activePhysicsChunks !== undefined) {
                      const cPatch = {};
                      if (__patch.chunks !== undefined) cPatch.chunks = __patch.chunks;
                      if (__patch.pendingMeshMounts !== undefined) cPatch.pendingMeshMounts = __patch.pendingMeshMounts;
                      if (__patch.overflowChunks !== undefined) cPatch.overflowChunks = __patch.overflowChunks;
                      if (__patch.activePhysicsChunks !== undefined) cPatch.activePhysicsChunks = __patch.activePhysicsChunks;
                      useChunkStore.setState(cPatch);
                    }
                    if (__patch.debris !== undefined || __patch.fallingStructures !== undefined || __patch.chests !== undefined || __patch.droppedItems !== undefined || __patch.tombstones !== undefined) {
                      const iPatch = {};
                      if (__patch.debris !== undefined) iPatch.debris = __patch.debris;
                      if (__patch.fallingStructures !== undefined) iPatch.fallingStructures = __patch.fallingStructures;
                      if (__patch.chests !== undefined) iPatch.chests = __patch.chests;
                      if (__patch.droppedItems !== undefined) iPatch.droppedItems = __patch.droppedItems;
                      if (__patch.tombstones !== undefined) iPatch.tombstones = __patch.tombstones;
                      useInventoryStore.setState(iPatch);
                    }
                    if (__patch.placedFlares !== undefined) useFlareStore.setState({
                      placedFlares: __patch.placedFlares
                    });
                    if (__patch.worldTime !== undefined) {
                      useEnvironmentStore.setState({
                        worldTime: __patch.worldTime,
                        currentDay: __patch.currentDay,
                        isNightTime: __patch.isNightTime,
                        isRaining: __patch.isRaining,
                        skyColor: __patch.skyColor,
                        fogDensity: __patch.fogDensity
                      });
                    }
                    if (__patch.pendingDeltas !== undefined || __patch.isResetting !== undefined || __patch.batcherVersion !== undefined) {
                      const rawPatch = {};
                      if (__patch.pendingDeltas !== undefined) rawPatch.pendingDeltas = __patch.pendingDeltas;
                      if (__patch.isResetting !== undefined) rawPatch.isResetting = __patch.isResetting;
                      if (__patch.batcherVersion !== undefined) rawPatch.batcherVersion = __patch.batcherVersion;
                      rawSet(rawPatch);
                    }
                  })();
                  let chunkData;
                  chunkData = await loadChunkFromDB(chunkKey);
                  if (!chunkData) {
                    const [cx, cz] = chunkKey.split(',');
                    chunkData = await chunkWorkerPool.generatePass1(parseInt(cx), parseInt(cz), getSeed());
                  }
                  if (chunkData && chunkData.buffer) {
                    const buffer = new Uint32Array(chunkData.buffer);
                    for (let i = 0; i < processingDeltas.length; i += 2) {
                      buffer[processingDeltas[i]] = processingDeltas[i + 1];
                    }
                    chunkData.buffer = buffer;
                    chunkData.isModified = true;
                    await saveChunkToDB(chunkKey, chunkData);
                  }
                } catch (e) {
                  console.error('Silent delta save failed', e);
                } finally {
                  processingNetworkDeltas.delete(chunkKey);
                  if (useStore.getState().pendingDeltas[chunkKey]) {
                    useStore.getState().applyNetworkDelta(chunkKey, []);
                  }
                }
              }, 0);
            }
            return {
              pendingDeltas: {
                ...prev.pendingDeltas,
                [chunkKey]: [...(prev.pendingDeltas[chunkKey] || []), ...deltas]
              }
            };
          }
          rebuilds.add(chunkKey);
          const [cx, cz] = chunkKey.split(',').map(Number);
          const buffer = prevChunkData.buffer; // Mutate in place to avoid GC thrashing!
          for (let i = 0; i < deltas.length; i += 2) {
            const idx = deltas[i];
            buffer[idx] = deltas[i + 1];
            const lx = idx % 256 % 16;
            const lz = Math.floor(idx % 256 / 16);
            if (lx === 0) {
              rebuilds.add(`${cx - 1},${cz}`);
              if (lz === 0) rebuilds.add(`${cx - 1},${cz - 1}`);
              if (lz === 15) rebuilds.add(`${cx - 1},${cz + 1}`);
            }
            if (lx === 15) {
              rebuilds.add(`${cx + 1},${cz}`);
              if (lz === 0) rebuilds.add(`${cx + 1},${cz - 1}`);
              if (lz === 15) rebuilds.add(`${cx + 1},${cz + 1}`);
            }
            if (lz === 0) rebuilds.add(`${cx},${cz - 1}`);
            if (lz === 15) rebuilds.add(`${cx},${cz + 1}`);
          }
          return {
            chunks: {
              ...prev.chunks,
              [chunkKey]: {
                ...prevChunkData,
                isModified: true,
                rebuildId: (prevChunkData.rebuildId || 0) + 1
              }
            }
          };
        })(prev);
        if (__patch.chunks !== undefined || __patch.pendingMeshMounts !== undefined || __patch.overflowChunks !== undefined || __patch.activePhysicsChunks !== undefined) {
          const cPatch = {};
          if (__patch.chunks !== undefined) cPatch.chunks = __patch.chunks;
          if (__patch.pendingMeshMounts !== undefined) cPatch.pendingMeshMounts = __patch.pendingMeshMounts;
          if (__patch.overflowChunks !== undefined) cPatch.overflowChunks = __patch.overflowChunks;
          if (__patch.activePhysicsChunks !== undefined) cPatch.activePhysicsChunks = __patch.activePhysicsChunks;
          useChunkStore.setState(cPatch);
        }
        if (__patch.debris !== undefined || __patch.fallingStructures !== undefined || __patch.chests !== undefined || __patch.droppedItems !== undefined || __patch.tombstones !== undefined) {
          const iPatch = {};
          if (__patch.debris !== undefined) iPatch.debris = __patch.debris;
          if (__patch.fallingStructures !== undefined) iPatch.fallingStructures = __patch.fallingStructures;
          if (__patch.chests !== undefined) iPatch.chests = __patch.chests;
          if (__patch.droppedItems !== undefined) iPatch.droppedItems = __patch.droppedItems;
          if (__patch.tombstones !== undefined) iPatch.tombstones = __patch.tombstones;
          useInventoryStore.setState(iPatch);
        }
        if (__patch.placedFlares !== undefined) useFlareStore.setState({
          placedFlares: __patch.placedFlares
        });
        if (__patch.worldTime !== undefined) {
          useEnvironmentStore.setState({
            worldTime: __patch.worldTime,
            currentDay: __patch.currentDay,
            isNightTime: __patch.isNightTime,
            isRaining: __patch.isRaining,
            skyColor: __patch.skyColor,
            fogDensity: __patch.fogDensity
          });
        }
        if (__patch.pendingDeltas !== undefined || __patch.isResetting !== undefined || __patch.batcherVersion !== undefined) {
          const rawPatch = {};
          if (__patch.pendingDeltas !== undefined) rawPatch.pendingDeltas = __patch.pendingDeltas;
          if (__patch.isResetting !== undefined) rawPatch.isResetting = __patch.isResetting;
          if (__patch.batcherVersion !== undefined) rawPatch.batcherVersion = __patch.batcherVersion;
          rawSet(rawPatch);
        }
      })();

      // Only rebuild the chunk itself and neighbors that actually touch the modified blocks!
      rebuilds.forEach(nck => {
        if (useChunkStore.getState().chunks[nck]) get().requestMeshRebuild(nck);
      });
    },
    getGlobalBlockSafe: (x, y, z) => {
      const cx = Math.floor(x / 16);
      const cz = Math.floor(z / 16);
      const chunk = useChunkStore.getState().chunks[`${cx},${cz}`];
      if (!chunk || !chunk.buffer) return 0;
      const ly = Math.round(y - 0.5);
      if (ly < CHUNK_Y_MIN || ly > CHUNK_Y_MAX) return 0;
      const lx = (x % 16 + 16) % 16;
      const lz = (z % 16 + 16) % 16;
      return chunk.buffer[getIndex(lx, ly, lz)];
    },
    findSafeSpawnY: (x, z) => {
      const cx = Math.floor(x / 16);
      const cz = Math.floor(z / 16);
      const chunk = useChunkStore.getState().chunks[`${cx},${cz}`];
      if (!chunk || !chunk.buffer || !chunk.meshArrays) return 400; // Wait for mesh to mount

      const lx = Math.floor((x % 16 + 16) % 16);
      const lz = Math.floor((z % 16 + 16) % 16);

      // Scan from top of the world down to find the highest non-air block
      for (let ly = CHUNK_Y_MAX; ly >= CHUNK_Y_MIN; ly--) {
        const val = chunk.buffer[getIndex(lx, ly, lz)];
        const texId = getTextureId(val);
        if (texId !== 0) {
          // We found a block!
          const blockDef = BlockRegistry[BlockKeyById[texId]];
          // If it's a liquid, they'll spawn on the liquid surface.
          // If it's solid, they'll spawn on top of it.
          if (blockDef && !blockDef.isPassable) {
            return ly + 1.5; // Player capsule height compensation
          }
        }
      }
      return 400; // Fallback if column is entirely empty
    },
    clearVisualMeshArrays: chunkKey => (() => {
      const prev = getCombinedState(rawGet);
      const __patch = (prev => {
        const chunk = prev.chunks[chunkKey];
        if (!chunk || !chunk.meshArrays) return prev;

        // If it only has physics keys or meta keys (or is completely empty), it's already cleared.
        const keys = Object.keys(chunk.meshArrays);
        if (keys.length === 0 || keys.every(k => k === '__physics' || k === '_physics' || k === '__meta' || k === '__flora')) {
          return prev; // Bypass state update to prevent infinite loops in Chunk.jsx
        }

        // We KEEP the __physics array because Rapier TrimeshCollider relies on it
        const newMeshArrays = {};
        if (chunk.meshArrays.__physics) {
          newMeshArrays.__physics = chunk.meshArrays.__physics;
        }
        if (chunk.meshArrays._physics) {
          newMeshArrays._physics = chunk.meshArrays._physics;
        }
        if (chunk.meshArrays.__meta) {
          newMeshArrays.__meta = chunk.meshArrays.__meta;
        }
        if (chunk.meshArrays.__flora) {
          newMeshArrays.__flora = chunk.meshArrays.__flora;
        }
        return {
          chunks: {
            ...prev.chunks,
            [chunkKey]: {
              ...chunk,
              meshArrays: newMeshArrays
            }
          }
        };
      })(prev);
      if (__patch.chunks !== undefined || __patch.pendingMeshMounts !== undefined || __patch.overflowChunks !== undefined || __patch.activePhysicsChunks !== undefined) {
        const cPatch = {};
        if (__patch.chunks !== undefined) cPatch.chunks = __patch.chunks;
        if (__patch.pendingMeshMounts !== undefined) cPatch.pendingMeshMounts = __patch.pendingMeshMounts;
        if (__patch.overflowChunks !== undefined) cPatch.overflowChunks = __patch.overflowChunks;
        if (__patch.activePhysicsChunks !== undefined) cPatch.activePhysicsChunks = __patch.activePhysicsChunks;
        useChunkStore.setState(cPatch);
      }
      if (__patch.debris !== undefined || __patch.fallingStructures !== undefined || __patch.chests !== undefined || __patch.droppedItems !== undefined || __patch.tombstones !== undefined) {
        const iPatch = {};
        if (__patch.debris !== undefined) iPatch.debris = __patch.debris;
        if (__patch.fallingStructures !== undefined) iPatch.fallingStructures = __patch.fallingStructures;
        if (__patch.chests !== undefined) iPatch.chests = __patch.chests;
        if (__patch.droppedItems !== undefined) iPatch.droppedItems = __patch.droppedItems;
        if (__patch.tombstones !== undefined) iPatch.tombstones = __patch.tombstones;
        useInventoryStore.setState(iPatch);
      }
      if (__patch.placedFlares !== undefined) useFlareStore.setState({
        placedFlares: __patch.placedFlares
      });
      if (__patch.worldTime !== undefined) {
        useEnvironmentStore.setState({
          worldTime: __patch.worldTime,
          currentDay: __patch.currentDay,
          isNightTime: __patch.isNightTime,
          isRaining: __patch.isRaining,
          skyColor: __patch.skyColor,
          fogDensity: __patch.fogDensity
        });
      }
      if (__patch.pendingDeltas !== undefined || __patch.isResetting !== undefined || __patch.batcherVersion !== undefined) {
        const rawPatch = {};
        if (__patch.pendingDeltas !== undefined) rawPatch.pendingDeltas = __patch.pendingDeltas;
        if (__patch.isResetting !== undefined) rawPatch.isResetting = __patch.isResetting;
        if (__patch.batcherVersion !== undefined) rawPatch.batcherVersion = __patch.batcherVersion;
        rawSet(rawPatch);
      }
    })(),
    applyNetworkSync: chunksData => {
      (() => {
        const prev = getCombinedState(rawGet);
        const __patch = (prev => {
          const newChunks = {
            ...prev.chunks
          };
          let updated = false;
          for (const chunkKey in chunksData) {
            const incoming = chunksData[chunkKey];
            const current = prev.chunks[chunkKey];
            if (current && current.buffer) {
              const target = current.buffer;
              if (incoming.buffer instanceof Uint8Array || incoming.buffer instanceof Uint32Array) {
                target.set(new Uint32Array(incoming.buffer.buffer, incoming.buffer.byteOffset, incoming.buffer.byteLength / 4));
              } else {
                target.set(new Uint32Array(incoming.buffer));
              }
              newChunks[chunkKey] = {
                ...current,
                isModified: true,
                rebuildId: (current.rebuildId || 0) + 1
              };
              updated = true;
            } else {
              let exactBuffer;
              if (incoming.buffer.slice) {
                exactBuffer = incoming.buffer.slice(incoming.buffer.byteOffset, incoming.buffer.byteOffset + incoming.buffer.byteLength);
              } else {
                exactBuffer = incoming.buffer;
              }
              const newBuffer = new Uint32Array(exactBuffer);
              newChunks[chunkKey] = {
                buffer: newBuffer,
                isModified: true,
                rebuildId: 1
              };
              updated = true;
            }

            // Apply any pending deltas that arrived before this sync
            const pending = prev.pendingDeltas[chunkKey];
            if (pending) {
              for (let i = 0; i < pending.length; i += 2) {
                newChunks[chunkKey].buffer[pending[i]] = pending[i + 1];
              }
            }
          }
          return updated ? {
            chunks: newChunks
          } : {};
        })(prev);
        if (__patch.chunks !== undefined || __patch.pendingMeshMounts !== undefined || __patch.overflowChunks !== undefined || __patch.activePhysicsChunks !== undefined) {
          const cPatch = {};
          if (__patch.chunks !== undefined) cPatch.chunks = __patch.chunks;
          if (__patch.pendingMeshMounts !== undefined) cPatch.pendingMeshMounts = __patch.pendingMeshMounts;
          if (__patch.overflowChunks !== undefined) cPatch.overflowChunks = __patch.overflowChunks;
          if (__patch.activePhysicsChunks !== undefined) cPatch.activePhysicsChunks = __patch.activePhysicsChunks;
          useChunkStore.setState(cPatch);
        }
        if (__patch.debris !== undefined || __patch.fallingStructures !== undefined || __patch.chests !== undefined || __patch.droppedItems !== undefined || __patch.tombstones !== undefined) {
          const iPatch = {};
          if (__patch.debris !== undefined) iPatch.debris = __patch.debris;
          if (__patch.fallingStructures !== undefined) iPatch.fallingStructures = __patch.fallingStructures;
          if (__patch.chests !== undefined) iPatch.chests = __patch.chests;
          if (__patch.droppedItems !== undefined) iPatch.droppedItems = __patch.droppedItems;
          if (__patch.tombstones !== undefined) iPatch.tombstones = __patch.tombstones;
          useInventoryStore.setState(iPatch);
        }
        if (__patch.placedFlares !== undefined) useFlareStore.setState({
          placedFlares: __patch.placedFlares
        });
        if (__patch.worldTime !== undefined) {
          useEnvironmentStore.setState({
            worldTime: __patch.worldTime,
            currentDay: __patch.currentDay,
            isNightTime: __patch.isNightTime,
            isRaining: __patch.isRaining,
            skyColor: __patch.skyColor,
            fogDensity: __patch.fogDensity
          });
        }
        if (__patch.pendingDeltas !== undefined || __patch.isResetting !== undefined || __patch.batcherVersion !== undefined) {
          const rawPatch = {};
          if (__patch.pendingDeltas !== undefined) rawPatch.pendingDeltas = __patch.pendingDeltas;
          if (__patch.isResetting !== undefined) rawPatch.isResetting = __patch.isResetting;
          if (__patch.batcherVersion !== undefined) rawPatch.batcherVersion = __patch.batcherVersion;
          rawSet(rawPatch);
        }
      })();
      // Need to rebuild all synced chunks!
      for (const chunkKey in chunksData) {
        get().requestMeshRebuild(chunkKey);
      }
    },
    activeFluids: [],
    // Stores string keys like "x,y,z" of fluids that need ticking
    worldTime: 12.0,
    daysElapsed: 1,
    isNightTime: false,
    isRaining: false,
    fallingStructures: [],
    debris: [],
    setWorldTime: (time, day, isRainingOverride = undefined) => {
      let newRaining;
      (() => {
        const prev = getCombinedState(rawGet);
        const __patch = (state => {
          newRaining = isRainingOverride !== undefined ? isRainingOverride : state.isRaining;
          if (isRainingOverride === undefined && Math.floor(time) !== Math.floor(state.worldTime)) {
            if (Math.random() < 0.1) {
              newRaining = !newRaining;
            }
          }
          return {
            worldTime: time,
            daysElapsed: day,
            isRaining: newRaining
          };
        })(prev);
        if (__patch.chunks !== undefined || __patch.pendingMeshMounts !== undefined || __patch.overflowChunks !== undefined || __patch.activePhysicsChunks !== undefined) {
          const cPatch = {};
          if (__patch.chunks !== undefined) cPatch.chunks = __patch.chunks;
          if (__patch.pendingMeshMounts !== undefined) cPatch.pendingMeshMounts = __patch.pendingMeshMounts;
          if (__patch.overflowChunks !== undefined) cPatch.overflowChunks = __patch.overflowChunks;
          if (__patch.activePhysicsChunks !== undefined) cPatch.activePhysicsChunks = __patch.activePhysicsChunks;
          useChunkStore.setState(cPatch);
        }
        if (__patch.debris !== undefined || __patch.fallingStructures !== undefined || __patch.chests !== undefined || __patch.droppedItems !== undefined || __patch.tombstones !== undefined) {
          const iPatch = {};
          if (__patch.debris !== undefined) iPatch.debris = __patch.debris;
          if (__patch.fallingStructures !== undefined) iPatch.fallingStructures = __patch.fallingStructures;
          if (__patch.chests !== undefined) iPatch.chests = __patch.chests;
          if (__patch.droppedItems !== undefined) iPatch.droppedItems = __patch.droppedItems;
          if (__patch.tombstones !== undefined) iPatch.tombstones = __patch.tombstones;
          useInventoryStore.setState(iPatch);
        }
        if (__patch.placedFlares !== undefined) useFlareStore.setState({
          placedFlares: __patch.placedFlares
        });
        if (__patch.worldTime !== undefined) {
          useEnvironmentStore.setState({
            worldTime: __patch.worldTime,
            currentDay: __patch.currentDay,
            isNightTime: __patch.isNightTime,
            isRaining: __patch.isRaining,
            skyColor: __patch.skyColor,
            fogDensity: __patch.fogDensity
          });
        }
        if (__patch.pendingDeltas !== undefined || __patch.isResetting !== undefined || __patch.batcherVersion !== undefined) {
          const rawPatch = {};
          if (__patch.pendingDeltas !== undefined) rawPatch.pendingDeltas = __patch.pendingDeltas;
          if (__patch.isResetting !== undefined) rawPatch.isResetting = __patch.isResetting;
          if (__patch.batcherVersion !== undefined) rawPatch.batcherVersion = __patch.batcherVersion;
          rawSet(rawPatch);
        }
      })();

      // Strangler Fig Shadow Write: Update the parallel store
      useEnvironmentStore.getState().setWorldTime(time, day, isRainingOverride);
      useEnvironmentStore.getState().validateStateParity({
        worldTime: time,
        daysElapsed: day,
        isRaining: newRaining
      });

      // Broadcast if host
      const netStore = getNetworkStore();
      if (netStore && netStore.getState().isHost) {
        netStore.getState().connections.forEach(conn => {
          try {
            conn.send({
              type: 'TIME_SYNC',
              worldTime: time,
              daysElapsed: day,
              isRaining: newRaining
            });
          } catch {
            /* ignore */
          }
        });
      }
    },
    placedFlares: [],
    placeFlare: (pos, normal, id) => {
      (() => {
        const prev = getCombinedState(rawGet);
        const __patch = (prev => {
          const newFlares = [...prev.placedFlares, {
            id: id,
            pos,
            normal,
            emitLight: true
          }];
          // Strangler Fig Shadow Write
          useFlareStore.getState().placeFlare(pos, normal, id);
          useFlareStore.getState().validateStateParity(newFlares);
          return {
            placedFlares: newFlares
          };
        })(prev);
        if (__patch.chunks !== undefined || __patch.pendingMeshMounts !== undefined || __patch.overflowChunks !== undefined || __patch.activePhysicsChunks !== undefined) {
          const cPatch = {};
          if (__patch.chunks !== undefined) cPatch.chunks = __patch.chunks;
          if (__patch.pendingMeshMounts !== undefined) cPatch.pendingMeshMounts = __patch.pendingMeshMounts;
          if (__patch.overflowChunks !== undefined) cPatch.overflowChunks = __patch.overflowChunks;
          if (__patch.activePhysicsChunks !== undefined) cPatch.activePhysicsChunks = __patch.activePhysicsChunks;
          useChunkStore.setState(cPatch);
        }
        if (__patch.debris !== undefined || __patch.fallingStructures !== undefined || __patch.chests !== undefined || __patch.droppedItems !== undefined || __patch.tombstones !== undefined) {
          const iPatch = {};
          if (__patch.debris !== undefined) iPatch.debris = __patch.debris;
          if (__patch.fallingStructures !== undefined) iPatch.fallingStructures = __patch.fallingStructures;
          if (__patch.chests !== undefined) iPatch.chests = __patch.chests;
          if (__patch.droppedItems !== undefined) iPatch.droppedItems = __patch.droppedItems;
          if (__patch.tombstones !== undefined) iPatch.tombstones = __patch.tombstones;
          useInventoryStore.setState(iPatch);
        }
        if (__patch.placedFlares !== undefined) useFlareStore.setState({
          placedFlares: __patch.placedFlares
        });
        if (__patch.worldTime !== undefined) {
          useEnvironmentStore.setState({
            worldTime: __patch.worldTime,
            currentDay: __patch.currentDay,
            isNightTime: __patch.isNightTime,
            isRaining: __patch.isRaining,
            skyColor: __patch.skyColor,
            fogDensity: __patch.fogDensity
          });
        }
        if (__patch.pendingDeltas !== undefined || __patch.isResetting !== undefined || __patch.batcherVersion !== undefined) {
          const rawPatch = {};
          if (__patch.pendingDeltas !== undefined) rawPatch.pendingDeltas = __patch.pendingDeltas;
          if (__patch.isResetting !== undefined) rawPatch.isResetting = __patch.isResetting;
          if (__patch.batcherVersion !== undefined) rawPatch.batcherVersion = __patch.batcherVersion;
          rawSet(rawPatch);
        }
      })();

      // Inject Flare Block into Voxel Engine
      const vx = Math.floor(pos[0] + normal[0] * 0.1);
      const vy = Math.floor(pos[1] + normal[1] * 0.1);
      const vz = Math.floor(pos[2] + normal[2] * 0.1);
      const key = `${vx},${vy},${vz}`;
      if (flareLightMap.has(key)) {
        flareLightMap.get(key).count++;
      } else {
        // Backup current block (to restore water/flora later)
        const currentBlockId = get().getGlobalBlockSafe(vx, vy, vz);
        flareLightMap.set(key, {
          count: 1,
          prevBlock: currentBlockId
        });
      }

      // Defer to allow React to flush, then set the voxel
      setTimeout(() => get().setVoxelRaw(vx, vy, vz, BlockIds['flare']), 0);
      const networkActions = getNetworkStore();
      if (networkActions) {
        networkActions.getState().broadcastEvent({
          type: 'ENTITY_SPAWN_EVENT',
          entityType: 'flare',
          id: id,
          pos,
          normal
        });
      }
    },
    removeFlare: id => {
      const flare = useFlareStore.getState().placedFlares.find(f => f.id === id);
      if (flare) {
        const vx = Math.floor(flare.pos[0] + flare.normal[0] * 0.1);
        const vy = Math.floor(flare.pos[1] + flare.normal[1] * 0.1);
        const vz = Math.floor(flare.pos[2] + flare.normal[2] * 0.1);
        const key = `${vx},${vy},${vz}`;
        const record = flareLightMap.get(key);
        if (record) {
          record.count--;
          if (record.count <= 0) {
            flareLightMap.delete(key);
            setTimeout(() => get().setVoxelRaw(vx, vy, vz, record.prevBlock), 0);
          }
        }
      }
      (() => {
        const prev = getCombinedState(rawGet);
        const __patch = (prev => {
          const newFlares = prev.placedFlares.filter(t => t.id !== id);
          // Strangler Fig Shadow Write
          useFlareStore.getState().removeFlare(id);
          useFlareStore.getState().validateStateParity(newFlares);
          return {
            placedFlares: newFlares
          };
        })(prev);
        if (__patch.chunks !== undefined || __patch.pendingMeshMounts !== undefined || __patch.overflowChunks !== undefined || __patch.activePhysicsChunks !== undefined) {
          const cPatch = {};
          if (__patch.chunks !== undefined) cPatch.chunks = __patch.chunks;
          if (__patch.pendingMeshMounts !== undefined) cPatch.pendingMeshMounts = __patch.pendingMeshMounts;
          if (__patch.overflowChunks !== undefined) cPatch.overflowChunks = __patch.overflowChunks;
          if (__patch.activePhysicsChunks !== undefined) cPatch.activePhysicsChunks = __patch.activePhysicsChunks;
          useChunkStore.setState(cPatch);
        }
        if (__patch.debris !== undefined || __patch.fallingStructures !== undefined || __patch.chests !== undefined || __patch.droppedItems !== undefined || __patch.tombstones !== undefined) {
          const iPatch = {};
          if (__patch.debris !== undefined) iPatch.debris = __patch.debris;
          if (__patch.fallingStructures !== undefined) iPatch.fallingStructures = __patch.fallingStructures;
          if (__patch.chests !== undefined) iPatch.chests = __patch.chests;
          if (__patch.droppedItems !== undefined) iPatch.droppedItems = __patch.droppedItems;
          if (__patch.tombstones !== undefined) iPatch.tombstones = __patch.tombstones;
          useInventoryStore.setState(iPatch);
        }
        if (__patch.placedFlares !== undefined) useFlareStore.setState({
          placedFlares: __patch.placedFlares
        });
        if (__patch.worldTime !== undefined) {
          useEnvironmentStore.setState({
            worldTime: __patch.worldTime,
            currentDay: __patch.currentDay,
            isNightTime: __patch.isNightTime,
            isRaining: __patch.isRaining,
            skyColor: __patch.skyColor,
            fogDensity: __patch.fogDensity
          });
        }
        if (__patch.pendingDeltas !== undefined || __patch.isResetting !== undefined || __patch.batcherVersion !== undefined) {
          const rawPatch = {};
          if (__patch.pendingDeltas !== undefined) rawPatch.pendingDeltas = __patch.pendingDeltas;
          if (__patch.isResetting !== undefined) rawPatch.isResetting = __patch.isResetting;
          if (__patch.batcherVersion !== undefined) rawPatch.batcherVersion = __patch.batcherVersion;
          rawSet(rawPatch);
        }
      })();
      const networkActions = getNetworkStore();
      if (networkActions) {
        networkActions.getState().broadcastEvent({
          type: 'ACTION_INTENT',
          action: 'REMOVE_FLARE',
          id: id
        });
      }
    },
    setVoxelRaw: (x, y, z, texId) => {
      const chunkKey = getChunkKey(x, z);
      const cx = Math.floor(x / 16);
      const cz = Math.floor(z / 16);
      const ly = Math.floor(y);
      if (ly < CHUNK_Y_MIN || ly > CHUNK_Y_MAX) return;
      const state = get();
      const chunkData = useChunkStore.getState().chunks[chunkKey];
      if (!chunkData || !chunkData.buffer) return;
      const lx = (x % 16 + 16) % 16;
      const lz = (z % 16 + 16) % 16;
      const health = BlockById[texId]?.health ?? 100;
      const rebuilds = new Set([chunkKey]);
      if (lx === 0) {
        rebuilds.add(`${cx - 1},${cz}`);
        if (lz === 0) rebuilds.add(`${cx - 1},${cz - 1}`);
        if (lz === 15) rebuilds.add(`${cx - 1},${cz + 1}`);
      }
      if (lx === 15) {
        rebuilds.add(`${cx + 1},${cz}`);
        if (lz === 0) rebuilds.add(`${cx + 1},${cz - 1}`);
        if (lz === 15) rebuilds.add(`${cx + 1},${cz + 1}`);
      }
      if (lz === 0) rebuilds.add(`${cx},${cz - 1}`);
      if (lz === 15) rebuilds.add(`${cx},${cz + 1}`);
      (() => {
        const prev = getCombinedState(rawGet);
        const __patch = (prev => {
          const pChunk = prev.chunks[chunkKey];
          if (!pChunk) return prev;
          const buffer = pChunk.buffer; // Mutate in place to avoid GC thrashing!
          const idx = getIndex(lx, ly, lz);
          setBlock(buffer, idx, texId, health, 0, 0);
          const networkActions = getNetworkStore();
          if (networkActions) {
            networkActions.getState().broadcastDelta(chunkKey, [idx, buffer[idx]]);
          }
          return {
            chunks: {
              ...prev.chunks,
              [chunkKey]: {
                ...pChunk,
                isModified: true,
                rebuildId: (pChunk.rebuildId || 0) + 1
              }
            }
          };
        })(prev);
        if (__patch.chunks !== undefined || __patch.pendingMeshMounts !== undefined || __patch.overflowChunks !== undefined || __patch.activePhysicsChunks !== undefined) {
          const cPatch = {};
          if (__patch.chunks !== undefined) cPatch.chunks = __patch.chunks;
          if (__patch.pendingMeshMounts !== undefined) cPatch.pendingMeshMounts = __patch.pendingMeshMounts;
          if (__patch.overflowChunks !== undefined) cPatch.overflowChunks = __patch.overflowChunks;
          if (__patch.activePhysicsChunks !== undefined) cPatch.activePhysicsChunks = __patch.activePhysicsChunks;
          useChunkStore.setState(cPatch);
        }
        if (__patch.debris !== undefined || __patch.fallingStructures !== undefined || __patch.chests !== undefined || __patch.droppedItems !== undefined || __patch.tombstones !== undefined) {
          const iPatch = {};
          if (__patch.debris !== undefined) iPatch.debris = __patch.debris;
          if (__patch.fallingStructures !== undefined) iPatch.fallingStructures = __patch.fallingStructures;
          if (__patch.chests !== undefined) iPatch.chests = __patch.chests;
          if (__patch.droppedItems !== undefined) iPatch.droppedItems = __patch.droppedItems;
          if (__patch.tombstones !== undefined) iPatch.tombstones = __patch.tombstones;
          useInventoryStore.setState(iPatch);
        }
        if (__patch.placedFlares !== undefined) useFlareStore.setState({
          placedFlares: __patch.placedFlares
        });
        if (__patch.worldTime !== undefined) {
          useEnvironmentStore.setState({
            worldTime: __patch.worldTime,
            currentDay: __patch.currentDay,
            isNightTime: __patch.isNightTime,
            isRaining: __patch.isRaining,
            skyColor: __patch.skyColor,
            fogDensity: __patch.fogDensity
          });
        }
        if (__patch.pendingDeltas !== undefined || __patch.isResetting !== undefined || __patch.batcherVersion !== undefined) {
          const rawPatch = {};
          if (__patch.pendingDeltas !== undefined) rawPatch.pendingDeltas = __patch.pendingDeltas;
          if (__patch.isResetting !== undefined) rawPatch.isResetting = __patch.isResetting;
          if (__patch.batcherVersion !== undefined) rawPatch.batcherVersion = __patch.batcherVersion;
          rawSet(rawPatch);
        }
      })();
      rebuilds.forEach(nck => {
        if (useChunkStore.getState().chunks[nck]) get().requestMeshRebuild(nck);
      });
    },
    requestMeshRebuild: chunkKey => {
      // Wire the module-level trampoline on first call (captures get/rawGet/rawSet from store closure)
      if (_executeRebuild === null) {
        _executeRebuild = (key) => get()._executeRebuildInternal(key, get, rawGet, rawSet);
      }

      // During startup (world not ready yet) hold rebuilds for 1s to prevent a storm
      if (!worldReadyForRebuild) {
        const isReady = get().isWorldReady;
        if (isReady) worldReadyForRebuild = true;
        if (!isReady) {
          // Fallback: a single short timeout for startup only — once fired we switch to rAF mode
          setTimeout(() => {
            worldReadyForRebuild = true;
            dirtyChunkSet.add(chunkKey);
            scheduleRafFlush(get, rawGet, rawSet);
          }, 1000);
          return;
        }
      }
      dirtyChunkSet.add(chunkKey);
      scheduleRafFlush(get, rawGet, rawSet);
    },
    _executeRebuildInternal: async (chunkKey, get, rawGet, rawSet) => {
      // This is called by the module-level _executeRebuild trampoline below
      inFlightRebuildSet.add(chunkKey);
      try {
          const chunkData = useChunkStore.getState().chunks[chunkKey];
          if (!chunkData) return;
          const targetRebuildId = chunkData.rebuildId || 0;
          // Create a dedicated transferable copy for the worker.
          // We CANNOT transfer chunkData.buffer directly — it is the live authoritative block data
          // read by BlockInteraction, fluid ticks, and getBlock. Neutering it mid-frame crashes those systems.
          // A fresh Uint32Array copy is still O(n) memcpy but avoids the structured-clone serialization
          // overhead, and the worker returns the buffer back so the store gets an updated copy.
          const buffer = new Uint32Array(chunkData.buffer);
          const neighborBuffers = [];
          const [cxStr, czStr] = chunkKey.split(',');
          const cx = parseInt(cxStr, 10);
          const cz = parseInt(czStr, 10);
          const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]];
          for (const [dx, dz] of dirs) {
            const key = `${cx + dx},${cz + dz}`;
            let nBuffer = null;
            if (useChunkStore.getState().chunks[key] && useChunkStore.getState().chunks[key].buffer) {
              nBuffer = useChunkStore.getState().chunks[key].buffer;
            } else if (get().pass1Cache && get().pass1Cache.has(key)) {
              nBuffer = get().pass1Cache.get(key).buffer;
            }
            if (nBuffer) {
              neighborBuffers.push({
                cx: cx + dx,
                cz: cz + dz,
                buffer: nBuffer
              });
            }
          }
          const workerResult = await chunkWorkerPool.rebuild(buffer, neighborBuffers, cx, cz, getSeed());
          // Worker may return null if it crashed
          if (!workerResult || workerResult.error) return;
          const {
            meshArrays,
            lightOverflow
          } = workerResult;
          if (lightOverflow && lightOverflow.length > 0) {
            const neighborsToRebuild = new Set();
            (() => {
              const prev = getCombinedState(rawGet);
              const __patch = (prev => {
                const nextChunks = {
                  ...prev.chunks
                };
                let changed = false;
                for (let i = 0; i < lightOverflow.length; i++) {
                  const overflow = lightOverflow[i];
                  const ncx = Math.floor(overflow.x / 16);
                  const ncz = Math.floor(overflow.z / 16);
                  const nKey = `${ncx},${ncz}`;
                  const nChunk = nextChunks[nKey];
                  if (nChunk && nChunk.buffer) {
                    const lx = (overflow.x % 16 + 16) % 16;
                    const lz = (overflow.z % 16 + 16) % 16;
                    const idx = getIndex(lx, overflow.y, lz);
                    const oldVal = nChunk.buffer[idx];
                    let newVal = oldVal;
                    if (overflow.type === 'sun') {
                      const currentSun = oldVal >> 26 & 0xf;
                      if (overflow.val > currentSun) {
                        newVal = oldVal & ~(0xf << 26) | (overflow.val & 0xf) << 26;
                      }
                    } else {
                      const currentBlk = oldVal >> 22 & 0xf;
                      if (overflow.val > currentBlk) {
                        newVal = oldVal & ~(0xf << 22) | (overflow.val & 0xf) << 22;
                      }
                    }
                    if (newVal !== oldVal) {
                      nChunk.buffer[idx] = newVal;
                      neighborsToRebuild.add(nKey);
                      changed = true;
                    }
                  }
                }
                if (changed) {
                  neighborsToRebuild.forEach(k => {
                    nextChunks[k] = {
                      ...nextChunks[k],
                      rebuildId: (nextChunks[k].rebuildId || 0) + 1
                    };
                  });
                  return {
                    chunks: nextChunks
                  };
                }
                return {};
              })(prev);
              if (__patch.chunks !== undefined || __patch.pendingMeshMounts !== undefined || __patch.overflowChunks !== undefined || __patch.activePhysicsChunks !== undefined) {
                const cPatch = {};
                if (__patch.chunks !== undefined) cPatch.chunks = __patch.chunks;
                if (__patch.pendingMeshMounts !== undefined) cPatch.pendingMeshMounts = __patch.pendingMeshMounts;
                if (__patch.overflowChunks !== undefined) cPatch.overflowChunks = __patch.overflowChunks;
                if (__patch.activePhysicsChunks !== undefined) cPatch.activePhysicsChunks = __patch.activePhysicsChunks;
                useChunkStore.setState(cPatch);
              }
              if (__patch.debris !== undefined || __patch.fallingStructures !== undefined || __patch.chests !== undefined || __patch.droppedItems !== undefined || __patch.tombstones !== undefined) {
                const iPatch = {};
                if (__patch.debris !== undefined) iPatch.debris = __patch.debris;
                if (__patch.fallingStructures !== undefined) iPatch.fallingStructures = __patch.fallingStructures;
                if (__patch.chests !== undefined) iPatch.chests = __patch.chests;
                if (__patch.droppedItems !== undefined) iPatch.droppedItems = __patch.droppedItems;
                if (__patch.tombstones !== undefined) iPatch.tombstones = __patch.tombstones;
                useInventoryStore.setState(iPatch);
              }
              if (__patch.placedFlares !== undefined) useFlareStore.setState({
                placedFlares: __patch.placedFlares
              });
              if (__patch.worldTime !== undefined) {
                useEnvironmentStore.setState({
                  worldTime: __patch.worldTime,
                  currentDay: __patch.currentDay,
                  isNightTime: __patch.isNightTime,
                  isRaining: __patch.isRaining,
                  skyColor: __patch.skyColor,
                  fogDensity: __patch.fogDensity
                });
              }
              if (__patch.pendingDeltas !== undefined || __patch.isResetting !== undefined || __patch.batcherVersion !== undefined) {
                const rawPatch = {};
                if (__patch.pendingDeltas !== undefined) rawPatch.pendingDeltas = __patch.pendingDeltas;
                if (__patch.isResetting !== undefined) rawPatch.isResetting = __patch.isResetting;
                if (__patch.batcherVersion !== undefined) rawPatch.batcherVersion = __patch.batcherVersion;
                rawSet(rawPatch);
              }
            })();
            neighborsToRebuild.forEach(nKey => {
              if (useChunkStore.getState().chunks[nKey]) get().requestMeshRebuild(nKey);
            });
          }
          (() => {
            const prev = getCombinedState(rawGet);
            const __patch = (prev => {
              const c = prev.chunks[chunkKey];
              // Discard stale worker results if the chunk was modified again during computation
              if (!c || (c.rebuildId || 0) !== targetRebuildId) {
                return prev;
              }
              const finalMeshArrays = {
                ...meshArrays
              };

              // PHYSICS BVH CACHING OPTIMIZATION:
              // If this chunk's blocks weren't modified (it was only rebuilt to propagate light),
              // its rebuildId hasn't changed since the last physics build.
              // We preserve the exact Float32Array reference so React Three Rapier completely skips
              // rebuilding the WASM BVH tree for this chunk, eliminating the lag spike!
              if (c.physicsRebuildId === (c.rebuildId || 0) && c.meshArrays?.__physics) {
                finalMeshArrays.__physics = c.meshArrays.__physics;
              }
              return {
                pendingMeshMounts: [...prev.pendingMeshMounts, {
                  chunkKey,
                  meshArrays: finalMeshArrays,
                  rebuildId: targetRebuildId
                }],
                chunks: {
                  ...prev.chunks,
                  [chunkKey]: {
                    ...c,
                    // Update buffer with lit result from worker
                    ...(workerResult.buffer && {
                      buffer: new Uint32Array(workerResult.buffer)
                    })
                  }
                }
              };
            })(prev);
            if (__patch.chunks !== undefined || __patch.pendingMeshMounts !== undefined || __patch.overflowChunks !== undefined || __patch.activePhysicsChunks !== undefined) {
              const cPatch = {};
              if (__patch.chunks !== undefined) cPatch.chunks = __patch.chunks;
              if (__patch.pendingMeshMounts !== undefined) cPatch.pendingMeshMounts = __patch.pendingMeshMounts;
              if (__patch.overflowChunks !== undefined) cPatch.overflowChunks = __patch.overflowChunks;
              if (__patch.activePhysicsChunks !== undefined) cPatch.activePhysicsChunks = __patch.activePhysicsChunks;
              useChunkStore.setState(cPatch);
            }
            if (__patch.debris !== undefined || __patch.fallingStructures !== undefined || __patch.chests !== undefined || __patch.droppedItems !== undefined || __patch.tombstones !== undefined) {
              const iPatch = {};
              if (__patch.debris !== undefined) iPatch.debris = __patch.debris;
              if (__patch.fallingStructures !== undefined) iPatch.fallingStructures = __patch.fallingStructures;
              if (__patch.chests !== undefined) iPatch.chests = __patch.chests;
              if (__patch.droppedItems !== undefined) iPatch.droppedItems = __patch.droppedItems;
              if (__patch.tombstones !== undefined) iPatch.tombstones = __patch.tombstones;
              useInventoryStore.setState(iPatch);
            }
            if (__patch.placedFlares !== undefined) useFlareStore.setState({
              placedFlares: __patch.placedFlares
            });
            if (__patch.worldTime !== undefined) {
              useEnvironmentStore.setState({
                worldTime: __patch.worldTime,
                currentDay: __patch.currentDay,
                isNightTime: __patch.isNightTime,
                isRaining: __patch.isRaining,
                skyColor: __patch.skyColor,
                fogDensity: __patch.fogDensity
              });
            }
            if (__patch.pendingDeltas !== undefined || __patch.isResetting !== undefined || __patch.batcherVersion !== undefined) {
              const rawPatch = {};
              if (__patch.pendingDeltas !== undefined) rawPatch.pendingDeltas = __patch.pendingDeltas;
              if (__patch.isResetting !== undefined) rawPatch.isResetting = __patch.isResetting;
              if (__patch.batcherVersion !== undefined) rawPatch.batcherVersion = __patch.batcherVersion;
              rawSet(rawPatch);
            }
          })();
        } catch (error) {
          console.error(`Error rebuilding mesh for chunk ${chunkKey}:`, error);
        } finally {
          // Release the in-flight lock so the next queued dirty can run
          inFlightRebuildSet.delete(chunkKey);
          // If this chunk was re-dirtied while the worker ran, schedule the next flush
          if (dirtyChunkSet.has(chunkKey)) {
            scheduleRafFlush(get, rawGet, rawSet);
          }
        }
      },
    loadChunkAsync: async (cx, cz, skipDB = false) => {
      const chunkKey = `${cx},${cz}`;
      if (useChunkStore.getState().chunks[chunkKey]) return 'DECORATED';
      if (cx === 0 && cz === 0) console.log(`[LOAD CHUNK 0,0] Starting loadChunkAsync`);
      if (inFlightChunks.has(chunkKey)) {
        cancelledChunks.delete(chunkKey);
        return 'PRISTINE';
      }
      inFlightChunks.add(chunkKey);
      cancelledChunks.delete(chunkKey);
      let chunkData = null;
      let chunkSeed = getSeed();
      try {
        if (cancelledChunks.has(chunkKey)) {
          inFlightChunks.delete(chunkKey);
          return 'CANCELLED';
        }
        const networkActions = getNetworkStore();
        if (networkActions) {
          const networkState = networkActions.getState();
          if (!networkState.isHost && networkState.connectionStatus === 'connected') {
            const hostResponse = await networkState.requestChunkFromHost(chunkKey);
            if (cancelledChunks.has(chunkKey)) {
              inFlightChunks.delete(chunkKey);
              return 'CANCELLED';
            }
            if (hostResponse !== 'PRISTINE') {
              chunkData = {
                buffer: new Uint32Array(hostResponse),
                isModified: true,
                rebuildId: 0
              };
            }
          }
        }
        if (!chunkData && !skipDB) {
          chunkData = await loadChunkFromDB(chunkKey);
        }
        if (cancelledChunks.has(chunkKey)) {
          inFlightChunks.delete(chunkKey);
          return 'CANCELLED';
        }
        if (chunkData) {
          if (chunkData.buffer && chunkData.buffer.constructor && chunkData.buffer.constructor.name === 'ArrayBuffer') {
            chunkData.buffer = new Uint32Array(chunkData.buffer);
          }

          // Unify the pipeline! Put DB chunks in pass1Cache so they wait at the Gate!
          pass1Cache.set(chunkKey, {
            buffer: chunkData.buffer,
            isFromDB: true,
            chunkData: chunkData
          });
          inFlightChunks.delete(chunkKey);
          cancelledChunks.delete(chunkKey);
          return 'PRISTINE'; // Enter pass1Chunks and wait for neighbors!
        }

        // If NOT in DB/Network, generate Pass 1!
        const pass1Data = await chunkWorkerPool.generatePass1(cx, cz, chunkSeed);
        if (cancelledChunks.has(chunkKey) || pass1Data?.error) {
          inFlightChunks.delete(chunkKey);
          return 'CANCELLED';
        }
        pass1Cache.set(chunkKey, pass1Data);
        inFlightChunks.delete(chunkKey);
        cancelledChunks.delete(chunkKey);
        return 'PRISTINE';
      } catch (err) {
        console.error(`[loadChunkAsync] FATAL ERROR loading chunk ${chunkKey}. Deleting corrupted save and forcing regeneration!`, err);
        // Aggressive DB Wipe for Corrupted Chunk
        try {
          const {
            del
          } = await import('idb-keyval');
          const prefix = sessionStorage.getItem('saveSlotId') || 'default';
          await del(`${prefix}_chunk_v14_${chunkKey}`);
        } catch (_e) {
          /* intentionally ignored: IDB might already be locked or deleted */
        }
        inFlightChunks.delete(chunkKey);
        cancelledChunks.delete(chunkKey);

        // Return "CANCELLED" to let ChunkManager seamlessly queue it for loading again next frame!
        return 'CANCELLED';
      }
    },
    loadChunkPass2Async: async (cx, cz) => {
      const chunkKey = `${cx},${cz}`;
      const pass1Data = pass1Cache.get(chunkKey);
      // Return NO_DATA (not CANCELLED) when the cache was evicted.
      // The gate treats CANCELLED as "retry", which creates an infinite loop
      // when pass1Cache was already cleared. NO_DATA triggers a full re-load.
      if (!pass1Data) return 'NO_DATA';
      if (inFlightChunks.has(chunkKey)) {
        cancelledChunks.delete(chunkKey);
        return;
      }
      inFlightChunks.add(chunkKey);
      cancelledChunks.delete(chunkKey);
      try {
        const chunkSeed = getSeed();
        let chunkData;
        if (pass1Data.isFromDB) {
          // Gather neighbors
          const neighborBuffers = [];
          const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]];
          for (const [dx, dz] of dirs) {
            const key = `${cx + dx},${cz + dz}`;
            let nBuffer = null;
            if (useChunkStore.getState().chunks[key] && useChunkStore.getState().chunks[key].buffer) {
              nBuffer = useChunkStore.getState().chunks[key].buffer;
            } else if (pass1Cache.has(key)) {
              nBuffer = pass1Cache.get(key).buffer;
            }
            if (nBuffer) {
              neighborBuffers.push({
                cx: cx + dx,
                cz: cz + dz,
                buffer: nBuffer
              });
            }
          }
          chunkData = pass1Data.chunkData;
          const rebuildResult = await chunkWorkerPool.rebuild(chunkData.buffer, neighborBuffers, cx, cz, chunkSeed);
          chunkData.meshArrays = rebuildResult.meshArrays;
          if (rebuildResult.buffer) {
            chunkData.buffer = new Uint32Array(rebuildResult.buffer);
          }
          // Overflow from DB rebuild is usually just lights. Could process them if needed.
        } else {
          chunkData = await chunkWorkerPool.generatePass2(cx, cz, pass1Data.buffer, pass1Data.getSurfaceHeightMap, chunkSeed);
          if (chunkData?.error) {
            inFlightChunks.delete(chunkKey);
            // Do NOT delete from pass1Cache here — we need the gate to see 'NO_DATA'
            // so it evicts the chunk and lets the sweep re-queue a fresh load.
            // Deleting here and returning 'CANCELLED' was causing permanent void holes.
            pass1Cache.delete(chunkKey);
            return 'NO_DATA';
          }

          // CRITICAL FIX: The worker transferred an ArrayBuffer back. We MUST wrap it in a Uint32Array!
          chunkData.buffer = new Uint32Array(chunkData.buffer);
        }
        pass1Cache.delete(chunkKey);
        if (cancelledChunks.has(chunkKey)) {
          inFlightChunks.delete(chunkKey);
          return 'CANCELLED';
        }

        // ── Handle Decorator Overflow ──
        const overflowPayload = chunkData.overflow || [];
        const overflowGroups = {};
        for (const block of overflowPayload) {
          const tcX = Math.floor(block.x / 16);
          const tcZ = Math.floor(block.z / 16);
          const targetKey = `${tcX},${tcZ}`;
          if (!overflowGroups[targetKey]) overflowGroups[targetKey] = [];
          overflowGroups[targetKey].push(block);
        }
        for (const [tKey, blocks] of Object.entries(overflowGroups)) {
          const tChunk = useChunkStore.getState().chunks[tKey];
          if (tChunk) {
            // 1. Target is already DECORATED (meshed and rendered)
            let modified = false;
            for (const b of blocks) {
              const lx = (b.x % 16 + 16) % 16;
              const ly = b.y;
              const lz = (b.z % 16 + 16) % 16;
              if (ly >= CHUNK_Y_MIN && ly <= CHUNK_Y_MAX) {
                const idx = getIndex(lx, ly, lz);
                tChunk.buffer[idx] = b.id & 0xff | 100 << 8; // Health 100
                modified = true;
              }
            }
            if (modified) {
              // Trigger Batched Dirty Meshing!
              tChunk.isModified = true;
              get().requestMeshRebuild(tKey); // Dispatches meshOnly worker
            }
          } else if (pass1Cache.has(tKey)) {
            // 2. Target is TERRAIN_GENERATED
            const pData = pass1Cache.get(tKey);
            for (const b of blocks) {
              const lx = (b.x % 16 + 16) % 16;
              const ly = b.y;
              const lz = (b.z % 16 + 16) % 16;
              if (ly >= CHUNK_Y_MIN && ly <= CHUNK_Y_MAX) {
                const idx = getIndex(lx, ly, lz);
                pData.buffer[idx] = b.id & 0xff | 100 << 8;
              }
            }
          } else {
            // 3. Target hasn't started generating at all
            (() => {
              const prev = getCombinedState(rawGet);
              const __patch = (prev => {
                const pending = {
                  ...prev.pendingDeltas
                };
                if (!pending[tKey]) pending[tKey] = [];
                for (const b of blocks) {
                  const lx = (b.x % 16 + 16) % 16;
                  const ly = b.y;
                  const lz = (b.z % 16 + 16) % 16;
                  if (ly >= CHUNK_Y_MIN && ly <= CHUNK_Y_MAX) {
                    const idx = getIndex(lx, ly, lz);
                    pending[tKey].push(idx, b.id & 0xff | 100 << 8);
                  }
                }
                return {
                  pendingDeltas: pending
                };
              })(prev);
              if (__patch.chunks !== undefined || __patch.pendingMeshMounts !== undefined || __patch.overflowChunks !== undefined || __patch.activePhysicsChunks !== undefined) {
                const cPatch = {};
                if (__patch.chunks !== undefined) cPatch.chunks = __patch.chunks;
                if (__patch.pendingMeshMounts !== undefined) cPatch.pendingMeshMounts = __patch.pendingMeshMounts;
                if (__patch.overflowChunks !== undefined) cPatch.overflowChunks = __patch.overflowChunks;
                if (__patch.activePhysicsChunks !== undefined) cPatch.activePhysicsChunks = __patch.activePhysicsChunks;
                useChunkStore.setState(cPatch);
              }
              if (__patch.debris !== undefined || __patch.fallingStructures !== undefined || __patch.chests !== undefined || __patch.droppedItems !== undefined || __patch.tombstones !== undefined) {
                const iPatch = {};
                if (__patch.debris !== undefined) iPatch.debris = __patch.debris;
                if (__patch.fallingStructures !== undefined) iPatch.fallingStructures = __patch.fallingStructures;
                if (__patch.chests !== undefined) iPatch.chests = __patch.chests;
                if (__patch.droppedItems !== undefined) iPatch.droppedItems = __patch.droppedItems;
                if (__patch.tombstones !== undefined) iPatch.tombstones = __patch.tombstones;
                useInventoryStore.setState(iPatch);
              }
              if (__patch.placedFlares !== undefined) useFlareStore.setState({
                placedFlares: __patch.placedFlares
              });
              if (__patch.worldTime !== undefined) {
                useEnvironmentStore.setState({
                  worldTime: __patch.worldTime,
                  currentDay: __patch.currentDay,
                  isNightTime: __patch.isNightTime,
                  isRaining: __patch.isRaining,
                  skyColor: __patch.skyColor,
                  fogDensity: __patch.fogDensity
                });
              }
              if (__patch.pendingDeltas !== undefined || __patch.isResetting !== undefined || __patch.batcherVersion !== undefined) {
                const rawPatch = {};
                if (__patch.pendingDeltas !== undefined) rawPatch.pendingDeltas = __patch.pendingDeltas;
                if (__patch.isResetting !== undefined) rawPatch.isResetting = __patch.isResetting;
                if (__patch.batcherVersion !== undefined) rawPatch.batcherVersion = __patch.batcherVersion;
                rawSet(rawPatch);
              }
            })();
          }
        }
        chunkData.rebuildId = 0;
        chunkData.physicsRebuildId = 0;
        const pending = useStore.getState().pendingDeltas[chunkKey];
        if (pending) {
          for (let i = 0; i < pending.length; i += 2) {
            chunkData.buffer[pending[i]] = pending[i + 1];
          }
          chunkData.isModified = true;
          chunkData.rebuildId = (chunkData.rebuildId || 0) + 1;
          (() => {
            const prev = getCombinedState(rawGet);
            const __patch = (prev => {
              const nextPending = {
                ...prev.pendingDeltas
              };
              delete nextPending[chunkKey];
              return {
                pendingDeltas: nextPending
              };
            })(prev);
            if (__patch.chunks !== undefined || __patch.pendingMeshMounts !== undefined || __patch.overflowChunks !== undefined || __patch.activePhysicsChunks !== undefined) {
              const cPatch = {};
              if (__patch.chunks !== undefined) cPatch.chunks = __patch.chunks;
              if (__patch.pendingMeshMounts !== undefined) cPatch.pendingMeshMounts = __patch.pendingMeshMounts;
              if (__patch.overflowChunks !== undefined) cPatch.overflowChunks = __patch.overflowChunks;
              if (__patch.activePhysicsChunks !== undefined) cPatch.activePhysicsChunks = __patch.activePhysicsChunks;
              useChunkStore.setState(cPatch);
            }
            if (__patch.debris !== undefined || __patch.fallingStructures !== undefined || __patch.chests !== undefined || __patch.droppedItems !== undefined || __patch.tombstones !== undefined) {
              const iPatch = {};
              if (__patch.debris !== undefined) iPatch.debris = __patch.debris;
              if (__patch.fallingStructures !== undefined) iPatch.fallingStructures = __patch.fallingStructures;
              if (__patch.chests !== undefined) iPatch.chests = __patch.chests;
              if (__patch.droppedItems !== undefined) iPatch.droppedItems = __patch.droppedItems;
              if (__patch.tombstones !== undefined) iPatch.tombstones = __patch.tombstones;
              useInventoryStore.setState(iPatch);
            }
            if (__patch.placedFlares !== undefined) useFlareStore.setState({
              placedFlares: __patch.placedFlares
            });
            if (__patch.worldTime !== undefined) {
              useEnvironmentStore.setState({
                worldTime: __patch.worldTime,
                currentDay: __patch.currentDay,
                isNightTime: __patch.isNightTime,
                isRaining: __patch.isRaining,
                skyColor: __patch.skyColor,
                fogDensity: __patch.fogDensity
              });
            }
            if (__patch.pendingDeltas !== undefined || __patch.isResetting !== undefined || __patch.batcherVersion !== undefined) {
              const rawPatch = {};
              if (__patch.pendingDeltas !== undefined) rawPatch.pendingDeltas = __patch.pendingDeltas;
              if (__patch.isResetting !== undefined) rawPatch.isResetting = __patch.isResetting;
              if (__patch.batcherVersion !== undefined) rawPatch.batcherVersion = __patch.batcherVersion;
              rawSet(rawPatch);
            }
          })();
          // CRITICAL FIX: Trigger a mesh rebuild to actually show the applied overflow blocks!
          get().requestMeshRebuild(chunkKey);
        }
        const meshArrays = chunkData.meshArrays;
        delete chunkData.meshArrays;
        (() => {
          const prev = getCombinedState(rawGet);
          const __patch = (prev => ({
            chunks: {
              ...prev.chunks,
              [chunkKey]: chunkData
            },
            pendingMeshMounts: [...prev.pendingMeshMounts, {
              chunkKey,
              meshArrays,
              rebuildId: chunkData.rebuildId || 0
            }]
          }))(prev);
          if (__patch.chunks !== undefined || __patch.pendingMeshMounts !== undefined || __patch.overflowChunks !== undefined || __patch.activePhysicsChunks !== undefined) {
            const cPatch = {};
            if (__patch.chunks !== undefined) cPatch.chunks = __patch.chunks;
            if (__patch.pendingMeshMounts !== undefined) cPatch.pendingMeshMounts = __patch.pendingMeshMounts;
            if (__patch.overflowChunks !== undefined) cPatch.overflowChunks = __patch.overflowChunks;
            if (__patch.activePhysicsChunks !== undefined) cPatch.activePhysicsChunks = __patch.activePhysicsChunks;
            useChunkStore.setState(cPatch);
          }
          if (__patch.debris !== undefined || __patch.fallingStructures !== undefined || __patch.chests !== undefined || __patch.droppedItems !== undefined || __patch.tombstones !== undefined) {
            const iPatch = {};
            if (__patch.debris !== undefined) iPatch.debris = __patch.debris;
            if (__patch.fallingStructures !== undefined) iPatch.fallingStructures = __patch.fallingStructures;
            if (__patch.chests !== undefined) iPatch.chests = __patch.chests;
            if (__patch.droppedItems !== undefined) iPatch.droppedItems = __patch.droppedItems;
            if (__patch.tombstones !== undefined) iPatch.tombstones = __patch.tombstones;
            useInventoryStore.setState(iPatch);
          }
          if (__patch.placedFlares !== undefined) useFlareStore.setState({
            placedFlares: __patch.placedFlares
          });
          if (__patch.worldTime !== undefined) {
            useEnvironmentStore.setState({
              worldTime: __patch.worldTime,
              currentDay: __patch.currentDay,
              isNightTime: __patch.isNightTime,
              isRaining: __patch.isRaining,
              skyColor: __patch.skyColor,
              fogDensity: __patch.fogDensity
            });
          }
          if (__patch.pendingDeltas !== undefined || __patch.isResetting !== undefined || __patch.batcherVersion !== undefined) {
            const rawPatch = {};
            if (__patch.pendingDeltas !== undefined) rawPatch.pendingDeltas = __patch.pendingDeltas;
            if (__patch.isResetting !== undefined) rawPatch.isResetting = __patch.isResetting;
            if (__patch.batcherVersion !== undefined) rawPatch.batcherVersion = __patch.batcherVersion;
            rawSet(rawPatch);
          }
        })();
        inFlightChunks.delete(chunkKey);
        pass1Cache.delete(chunkKey);
        return 'DECORATED';
      } catch (err) {
        console.error(`[loadChunkPass2Async] FATAL ERROR for chunk ${cx},${cz}:`, err);
        try {
          const {
            del
          } = await import('idb-keyval');
          const prefix = sessionStorage.getItem('saveSlotId') || 'default';
          await del(`${prefix}_chunk_v14_${chunkKey}`);
        } catch (_e) {
          /* intentionally ignored: IDB might already be locked or deleted */
        }
        inFlightChunks.delete(chunkKey);
        cancelledChunks.delete(chunkKey);
        pass1Cache.delete(chunkKey);
        return false;
      }
    },
    cancelLoadChunk: chunkKey => {
      if (pass1Cache.has(chunkKey)) pass1Cache.delete(chunkKey);
      if (inFlightChunks.has(chunkKey)) {
        cancelledChunks.add(chunkKey);
        const [cxStr, czStr] = chunkKey.split(',');
        cancelLoadFromDB(chunkKey); // Immediately rip it out of the database queue!
        chunkWorkerPool.cancelGenerate(+cxStr, +czStr);
      }
    },
    unloadChunk: async chunkKey => {
      if (pass1Cache.has(chunkKey)) pass1Cache.delete(chunkKey);
      if (inFlightChunks.has(chunkKey)) {
        cancelledChunks.add(chunkKey);
        return;
      }
      // Remove from dirty-set rebuild system so no ghost worker fires after unload
      dirtyChunkSet.delete(chunkKey);
      inFlightRebuildSet.delete(chunkKey);
      const chunkData = useChunkStore.getState().chunks[chunkKey];
      if (!chunkData) return;
      (() => {
        const prev = getCombinedState(rawGet);
        const __patch = (prev => {
          const newChunks = {
            ...prev.chunks
          };
          delete newChunks[chunkKey];
          const newOverflow = prev.overflowChunks.filter(k => k !== chunkKey);
          const [cxStr, czStr] = chunkKey.split(',');
          const cxNum = parseInt(cxStr, 10);
          const czNum = parseInt(czStr, 10);
          const isOutsideChunk = pos => {
            const fcx = Math.floor(pos[0] / 16);
            const fcz = Math.floor(pos[2] / 16);
            return !(fcx === cxNum && fcz === czNum);
          };
          const newFlares = prev.placedFlares.filter(f => isOutsideChunk(f.pos));
          const newDrops = prev.droppedItems ? prev.droppedItems.filter(d => isOutsideChunk(d.pos)) : [];
          const newDebris = prev.debris ? prev.debris.filter(d => isOutsideChunk(d.pos)) : [];
          return {
            chunks: newChunks,
            placedFlares: newFlares,
            droppedItems: newDrops,
            debris: newDebris,
            overflowChunks: newOverflow
          };
        })(prev);
        if (__patch.chunks !== undefined || __patch.pendingMeshMounts !== undefined || __patch.overflowChunks !== undefined || __patch.activePhysicsChunks !== undefined) {
          const cPatch = {};
          if (__patch.chunks !== undefined) cPatch.chunks = __patch.chunks;
          if (__patch.pendingMeshMounts !== undefined) cPatch.pendingMeshMounts = __patch.pendingMeshMounts;
          if (__patch.overflowChunks !== undefined) cPatch.overflowChunks = __patch.overflowChunks;
          if (__patch.activePhysicsChunks !== undefined) cPatch.activePhysicsChunks = __patch.activePhysicsChunks;
          useChunkStore.setState(cPatch);
        }
        if (__patch.debris !== undefined || __patch.fallingStructures !== undefined || __patch.chests !== undefined || __patch.droppedItems !== undefined || __patch.tombstones !== undefined) {
          const iPatch = {};
          if (__patch.debris !== undefined) iPatch.debris = __patch.debris;
          if (__patch.fallingStructures !== undefined) iPatch.fallingStructures = __patch.fallingStructures;
          if (__patch.chests !== undefined) iPatch.chests = __patch.chests;
          if (__patch.droppedItems !== undefined) iPatch.droppedItems = __patch.droppedItems;
          if (__patch.tombstones !== undefined) iPatch.tombstones = __patch.tombstones;
          useInventoryStore.setState(iPatch);
        }
        if (__patch.placedFlares !== undefined) useFlareStore.setState({
          placedFlares: __patch.placedFlares
        });
        if (__patch.worldTime !== undefined) {
          useEnvironmentStore.setState({
            worldTime: __patch.worldTime,
            currentDay: __patch.currentDay,
            isNightTime: __patch.isNightTime,
            isRaining: __patch.isRaining,
            skyColor: __patch.skyColor,
            fogDensity: __patch.fogDensity
          });
        }
        if (__patch.pendingDeltas !== undefined || __patch.isResetting !== undefined || __patch.batcherVersion !== undefined) {
          const rawPatch = {};
          if (__patch.pendingDeltas !== undefined) rawPatch.pendingDeltas = __patch.pendingDeltas;
          if (__patch.isResetting !== undefined) rawPatch.isResetting = __patch.isResetting;
          if (__patch.batcherVersion !== undefined) rawPatch.batcherVersion = __patch.batcherVersion;
          rawSet(rawPatch);
        }
      })();
      if (chunkData.isModified) {
        await saveChunkToDB(chunkKey, chunkData);
      }
    },
    addCube: (x, y, z) => {
      const chunkKey = getChunkKey(x, z);
      const cx = Math.floor(x / 16);
      const cz = Math.floor(z / 16);
      const ly = Math.floor(y); // Use floor: DDA returns integer block coords; Math.round(y-0.5) is wrong for negative Y
      if (ly < CHUNK_Y_MIN || ly > CHUNK_Y_MAX) return false;
      const state = get();
      const chunkData = useChunkStore.getState().chunks[chunkKey];
      if (!chunkData || !chunkData.buffer) return false;
      const lx = (x % 16 + 16) % 16;
      const lz = (z % 16 + 16) % 16;
      const currentVal = chunkData.buffer[getIndex(lx, ly, lz)];
      const currentTexId = getTextureId(currentVal);
      if (currentTexId !== 0 && BlockById[currentTexId]?.isPassable === false) {
        return false; // Already blocked! Abort to prevent duplicate item consumption and rebuilds.
      }
      const rebuilds = new Set([chunkKey]);
      if (lx === 0) {
        rebuilds.add(`${cx - 1},${cz}`);
        if (lz === 0) rebuilds.add(`${cx - 1},${cz - 1}`);
        if (lz === 15) rebuilds.add(`${cx - 1},${cz + 1}`);
      }
      if (lx === 15) {
        rebuilds.add(`${cx + 1},${cz}`);
        if (lz === 0) rebuilds.add(`${cx + 1},${cz - 1}`);
        if (lz === 15) rebuilds.add(`${cx + 1},${cz + 1}`);
      }
      if (lz === 0) rebuilds.add(`${cx},${cz - 1}`);
      if (lz === 15) rebuilds.add(`${cx},${cz + 1}`);
      (() => {
        const prev = getCombinedState(rawGet);
        const __patch = (prev => {
          const prevChunkData = prev.chunks[chunkKey] || {
            buffer: new Uint32Array(81920),
            isModified: false
          };
          const newBuffer = new Uint32Array(prevChunkData.buffer);
          const lx = (x % 16 + 16) % 16;
          const lz = (z % 16 + 16) % 16;

          // We resolve tex to ID
          const texName = prev.texture;
          const texId = BlockIds[texName] || 1;
          if (currentTexId !== 0 && BlockKeyById[currentTexId] === 'flare') {
            setTimeout(() => useFlareStore.getState().removeFlare(getBlockKey(x, y, z)), 0);
          }
          const health = BlockRegistry[texName]?.health ?? 100;
          const idx = getIndex(lx, ly, lz);
          setBlock(newBuffer, idx, texId, health, 0, 0);
          const rebuildId = (prevChunkData.rebuildId || 0) + 1;
          const networkActions = getNetworkStore();
          if (networkActions) {
            networkActions.getState().broadcastDelta(chunkKey, [idx, newBuffer[idx]]);
          }
          let newChests = prev.chests;
          if (texName === 'chest') {
            const chestKey = `${x},${y},${z}`;
            newChests = {
              ...prev.chests,
              [chestKey]: new Array(27).fill(null)
            };
          }
          return {
            chunks: {
              ...prev.chunks,
              [chunkKey]: {
                ...prevChunkData,
                buffer: newBuffer,
                isModified: true,
                rebuildId
              }
            },
            chests: newChests
          };
        })(prev);
        if (__patch.chunks !== undefined || __patch.pendingMeshMounts !== undefined || __patch.overflowChunks !== undefined || __patch.activePhysicsChunks !== undefined) {
          const cPatch = {};
          if (__patch.chunks !== undefined) cPatch.chunks = __patch.chunks;
          if (__patch.pendingMeshMounts !== undefined) cPatch.pendingMeshMounts = __patch.pendingMeshMounts;
          if (__patch.overflowChunks !== undefined) cPatch.overflowChunks = __patch.overflowChunks;
          if (__patch.activePhysicsChunks !== undefined) cPatch.activePhysicsChunks = __patch.activePhysicsChunks;
          useChunkStore.setState(cPatch);
        }
        if (__patch.debris !== undefined || __patch.fallingStructures !== undefined || __patch.chests !== undefined || __patch.droppedItems !== undefined || __patch.tombstones !== undefined) {
          const iPatch = {};
          if (__patch.debris !== undefined) iPatch.debris = __patch.debris;
          if (__patch.fallingStructures !== undefined) iPatch.fallingStructures = __patch.fallingStructures;
          if (__patch.chests !== undefined) iPatch.chests = __patch.chests;
          if (__patch.droppedItems !== undefined) iPatch.droppedItems = __patch.droppedItems;
          if (__patch.tombstones !== undefined) iPatch.tombstones = __patch.tombstones;
          useInventoryStore.setState(iPatch);
        }
        if (__patch.placedFlares !== undefined) useFlareStore.setState({
          placedFlares: __patch.placedFlares
        });
        if (__patch.worldTime !== undefined) {
          useEnvironmentStore.setState({
            worldTime: __patch.worldTime,
            currentDay: __patch.currentDay,
            isNightTime: __patch.isNightTime,
            isRaining: __patch.isRaining,
            skyColor: __patch.skyColor,
            fogDensity: __patch.fogDensity
          });
        }
        if (__patch.pendingDeltas !== undefined || __patch.isResetting !== undefined || __patch.batcherVersion !== undefined) {
          const rawPatch = {};
          if (__patch.pendingDeltas !== undefined) rawPatch.pendingDeltas = __patch.pendingDeltas;
          if (__patch.isResetting !== undefined) rawPatch.isResetting = __patch.isResetting;
          if (__patch.batcherVersion !== undefined) rawPatch.batcherVersion = __patch.batcherVersion;
          rawSet(rawPatch);
        }
      })();
      get().consumeActiveItem();
      rebuilds.forEach(ck => get().requestMeshRebuild(ck));
      wakeFluidsAround(get, set, x, y, z);
      return true;
    },
    bakeCube: (key, pos) => {
      const state = get();
      const debrisBlock = useInventoryStore.getState().debris.find(d => d.key === key);
      if (!debrisBlock) return;
      const [x, y, z] = pos;
      const chunkKey = getChunkKey(x, z);
      const cx = Math.floor(x / 16);
      const cz = Math.floor(z / 16);
      const ly = Math.round(y - 0.5);

      // Bounds check
      if (ly < CHUNK_Y_MIN || ly > CHUNK_Y_MAX) {
        get().removeDebris(key);
        return;
      }
      const chunkData = useChunkStore.getState().chunks[chunkKey];
      if (!chunkData || !chunkData.buffer) {
        get().removeDebris(key);
        return;
      }
      const lx = (Math.round(x) % 16 + 16) % 16;
      const lz = (Math.round(z) % 16 + 16) % 16;
      const currentVal = chunkData.buffer[getIndex(lx, ly, lz)];
      const currentTexId = getTextureId(currentVal);

      // If the space is already occupied by a solid block, just delete the debris
      if (currentTexId !== 0 && BlockById[currentTexId]?.isPassable === false) {
        get().removeDebris(key);
        return;
      }
      const rebuilds = new Set([chunkKey]);
      if (lx === 0) {
        rebuilds.add(`${cx - 1},${cz}`);
        if (lz === 0) rebuilds.add(`${cx - 1},${cz - 1}`);
        if (lz === 15) rebuilds.add(`${cx - 1},${cz + 1}`);
      }
      if (lx === 15) {
        rebuilds.add(`${cx + 1},${cz}`);
        if (lz === 0) rebuilds.add(`${cx + 1},${cz - 1}`);
        if (lz === 15) rebuilds.add(`${cx + 1},${cz + 1}`);
      }
      if (lz === 0) rebuilds.add(`${cx},${cz - 1}`);
      if (lz === 15) rebuilds.add(`${cx},${cz + 1}`);
      (() => {
        const prev = getCombinedState(rawGet);
        const __patch = (prev => {
          const prevChunkData = prev.chunks[chunkKey];
          const newBuffer = new Uint32Array(prevChunkData.buffer);
          const texId = BlockIds[debrisBlock.texture] || 1;
          const health = BlockRegistry[debrisBlock.texture]?.health ?? 100;
          const idx = getIndex(lx, ly, lz);
          setBlock(newBuffer, idx, texId, health, 0, 0);
          const rebuildId = (prevChunkData.rebuildId || 0) + 1;
          const networkActions = getNetworkStore();
          if (networkActions) {
            networkActions.getState().broadcastDelta(chunkKey, [idx, newBuffer[idx]]);
          }
          return {
            chunks: {
              ...prev.chunks,
              [chunkKey]: {
                ...prevChunkData,
                buffer: newBuffer,
                isModified: true,
                rebuildId
              }
            },
            debris: prev.debris.filter(d => d.key !== key)
          };
        })(prev);
        if (__patch.chunks !== undefined || __patch.pendingMeshMounts !== undefined || __patch.overflowChunks !== undefined || __patch.activePhysicsChunks !== undefined) {
          const cPatch = {};
          if (__patch.chunks !== undefined) cPatch.chunks = __patch.chunks;
          if (__patch.pendingMeshMounts !== undefined) cPatch.pendingMeshMounts = __patch.pendingMeshMounts;
          if (__patch.overflowChunks !== undefined) cPatch.overflowChunks = __patch.overflowChunks;
          if (__patch.activePhysicsChunks !== undefined) cPatch.activePhysicsChunks = __patch.activePhysicsChunks;
          useChunkStore.setState(cPatch);
        }
        if (__patch.debris !== undefined || __patch.fallingStructures !== undefined || __patch.chests !== undefined || __patch.droppedItems !== undefined || __patch.tombstones !== undefined) {
          const iPatch = {};
          if (__patch.debris !== undefined) iPatch.debris = __patch.debris;
          if (__patch.fallingStructures !== undefined) iPatch.fallingStructures = __patch.fallingStructures;
          if (__patch.chests !== undefined) iPatch.chests = __patch.chests;
          if (__patch.droppedItems !== undefined) iPatch.droppedItems = __patch.droppedItems;
          if (__patch.tombstones !== undefined) iPatch.tombstones = __patch.tombstones;
          useInventoryStore.setState(iPatch);
        }
        if (__patch.placedFlares !== undefined) useFlareStore.setState({
          placedFlares: __patch.placedFlares
        });
        if (__patch.worldTime !== undefined) {
          useEnvironmentStore.setState({
            worldTime: __patch.worldTime,
            currentDay: __patch.currentDay,
            isNightTime: __patch.isNightTime,
            isRaining: __patch.isRaining,
            skyColor: __patch.skyColor,
            fogDensity: __patch.fogDensity
          });
        }
        if (__patch.pendingDeltas !== undefined || __patch.isResetting !== undefined || __patch.batcherVersion !== undefined) {
          const rawPatch = {};
          if (__patch.pendingDeltas !== undefined) rawPatch.pendingDeltas = __patch.pendingDeltas;
          if (__patch.isResetting !== undefined) rawPatch.isResetting = __patch.isResetting;
          if (__patch.batcherVersion !== undefined) rawPatch.batcherVersion = __patch.batcherVersion;
          rawSet(rawPatch);
        }
      })();
      rebuilds.forEach(ck => get().requestMeshRebuild(ck));
      wakeFluidsAround(get, set, Math.round(x), Math.round(y), Math.round(z));
    },
    removeCube: (x, y, z, causedByGravity = false, initiatedByPlayerId = null) => {
      const chunkKey = getChunkKey(x, z);
      const cx = Math.floor(x / 16);
      const cz = Math.floor(z / 16);
      const ly = Math.floor(y); // Use floor: DDA returns integer block coords; Math.round(y-0.5) is wrong for negative Y
      if (ly < CHUNK_Y_MIN || ly > CHUNK_Y_MAX) return;
      const state = get();
      const chunkData = useChunkStore.getState().chunks[chunkKey];
      if (!chunkData || !chunkData.buffer) return;
      const lx = (x % 16 + 16) % 16;
      const lz = (z % 16 + 16) % 16;
      const val = chunkData.buffer[getIndex(lx, ly, lz)];
      if ((val & 0xff) === 0) return; // Block is already air! Abort side effects to prevent multiple drops/lag.

      const texId = val & 0xff;
      if (BlockKeyById[texId] === 'bedrock') return; // Cannot destroy bedrock

      const rebuilds = new Set([chunkKey]);
      if (lx === 0) {
        rebuilds.add(`${cx - 1},${cz}`);
        if (lz === 0) rebuilds.add(`${cx - 1},${cz - 1}`);
        if (lz === 15) rebuilds.add(`${cx - 1},${cz + 1}`);
      }
      if (lx === 15) {
        rebuilds.add(`${cx + 1},${cz}`);
        if (lz === 0) rebuilds.add(`${cx + 1},${cz - 1}`);
        if (lz === 15) rebuilds.add(`${cx + 1},${cz + 1}`);
      }
      if (lz === 0) rebuilds.add(`${cx},${cz - 1}`);
      if (lz === 15) rebuilds.add(`${cx},${cz + 1}`);

      const prev = getCombinedState(rawGet);

      const __patch = (prev => {
        const prevChunkData = prev.chunks[chunkKey];
        if (!prevChunkData) return {};
        const newBuffer = new Uint32Array(prevChunkData.buffer);
        const val = newBuffer[getIndex(lx, ly, lz)];
        if ((val & 0xff) === 0) return {};
        const texId = getTextureId(val);
        const texName = BlockKeyById[texId] || 'stone';

        // Extract chest items if container
        let chestItems = null;
        if (texName === 'chest') {
          const chestKey = `${x},${y},${z}`;
          chestItems = useInventoryStore.getState().chests[chestKey] || null;
        }

        const newChunks = {
          ...prev.chunks
        };

        const deltas = [];

        // Check flora cascade above:
        let floraBroken = null;
        if (ly + 1 <= CHUNK_Y_MAX) {
          const aboveIdx = getIndex(lx, ly + 1, lz);
          const aboveVal = newBuffer[aboveIdx];
          if ((aboveVal & 0xff) !== 0) {
            const aboveTexId = getTextureId(aboveVal);
            const aboveTexName = BlockKeyById[aboveTexId];
            if (BlockById[aboveTexId]?.isFlora || aboveTexName === 'flare') {
              setBlock(newBuffer, aboveIdx, 0, 0, 0, 0);
              deltas.push(aboveIdx, 0);
              floraBroken = {
                x,
                y: ly + 1,
                z,
                texName: aboveTexName
              };
            }
          }
        }

        setBlock(newBuffer, getIndex(lx, ly, lz), 0, 0, 0, 0);
        deltas.push(getIndex(lx, ly, lz), 0);

        // BFS UNHIDE PROPAGATION:
        {
          const BFS_MAX_DEPTH = 5;
          const bfsQueue = []; // [gx, gy, gz, depth]
          const bfsDirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
          // Seed: check all 6 neighbors of the broken block (and above flora if broken)
          bfsDirs.forEach(([dx, dy, dz]) => {
            bfsQueue.push([x + dx, ly + dy, z + dz, 1]);
            if (floraBroken) {
              bfsQueue.push([x + dx, ly + 1 + dy, z + dz, 1]);
            }
          });
          const bfsVisited = new Set([`${x},${ly},${z}`]); // don't re-visit the broken block(s)
          if (floraBroken) bfsVisited.add(`${x},${ly + 1},${z}`);

          let qi = 0;
          while (qi < bfsQueue.length) {
            const [nx, ny, nz, depth] = bfsQueue[qi++];
            const key = `${nx},${ny},${nz}`;
            if (bfsVisited.has(key)) continue;
            bfsVisited.add(key);
            if (ny < CHUNK_Y_MIN || ny > CHUNK_Y_MAX) continue;
            const ncx = Math.floor(nx / 16);
            const ncz = Math.floor(nz / 16);
            const nChunkKey = `${ncx},${ncz}`;
            const nlx = (nx % 16 + 16) % 16;
            const nlz = (nz % 16 + 16) % 16;
            let targetBuffer;
            let isMainChunk = nChunkKey === chunkKey;
            if (isMainChunk) {
              targetBuffer = newBuffer;
            } else {
              const nChunk = newChunks[nChunkKey] || prev.chunks[nChunkKey];
              if (!nChunk?.buffer) continue;
              // Copy-on-write: only allocate once per cross-chunk neighbor
              if (!newChunks[nChunkKey] || newChunks[nChunkKey] === prev.chunks[nChunkKey]) {
                newChunks[nChunkKey] = {
                  ...prev.chunks[nChunkKey],
                  buffer: new Uint32Array(prev.chunks[nChunkKey].buffer),
                  isModified: true
                };
              }
              targetBuffer = newChunks[nChunkKey].buffer;
            }
            const nIdx = getIndex(nlx, ny, nlz);
            const nVal = targetBuffer[nIdx];
            if ((nVal & 0xff) === 0) {
              // Air — propagate through it (don't stop, but don't unhide air)
            } else if (getIsHidden(nVal)) {
              // Hidden solid block — unhide it and keep propagating
              targetBuffer[nIdx] = nVal & ~(1 << 21);
              if (isMainChunk) {
                deltas.push(nIdx, targetBuffer[nIdx]);
              } else {
                const networkActions = getNetworkStore();
                if (networkActions) {
                  networkActions.getState().broadcastDelta(nChunkKey, [nIdx, targetBuffer[nIdx]]);
                }
              }
            } else {
              // Already-visible solid block — stop propagating in this direction
              continue;
            }

            // Propagate further if within depth limit
            if (depth < BFS_MAX_DEPTH) {
              bfsDirs.forEach(([dx, dy, dz]) => bfsQueue.push([nx + dx, ny + dy, nz + dz, depth + 1]));
            }
          }
        }

        const networkActions = getNetworkStore();
        if (networkActions) {
          networkActions.getState().broadcastDelta(chunkKey, deltas);
        }

        newChunks[chunkKey] = {
          ...prevChunkData,
          buffer: newBuffer,
          isModified: true,
          rebuildId: (prevChunkData.rebuildId || 0) + 1
        };

        return {
          chunks: newChunks,
          _meta: {
            texName,
            chestItems,
            floraBroken
          }
        };
      })(prev);

      if (__patch.chunks !== undefined) {
        useChunkStore.setState({ chunks: __patch.chunks });
      }

      rebuilds.forEach(ck => get().requestMeshRebuild(ck));

      const { texName, chestItems, floraBroken } = __patch._meta || {};

      // Emit block destruction events
      if (floraBroken) {
        EventBus.emit('EVENT_BLOCK_DESTROYED', {
          x: floraBroken.x,
          y: floraBroken.y,
          z: floraBroken.z,
          texName: floraBroken.texName,
          chestItems: null,
          causedByGravity: true,
          initiatedByPlayerId
        });
      }

      EventBus.emit('EVENT_BLOCK_DESTROYED', {
        x,
        y: ly,
        z,
        texName,
        chestItems,
        causedByGravity,
        initiatedByPlayerId
      });
    },
    removeCubesBulk: (blocks, causedByGravity = false, initiatedByPlayerId = null) => {
      const state = get();
      const rebuilds = new Set();
      const chunkDeltas = {};
      const networkActions = getNetworkStore();
      const processedBlocks = [];

      const prev = getCombinedState(rawGet);

      const __patch = (prev => {
        const newChunks = {
          ...prev.chunks
        };

        blocks.forEach(b => {
          const { x, y, z } = b;
          const ly = Math.floor(y);
          if (ly < CHUNK_Y_MIN || ly > CHUNK_Y_MAX) return;
          const lx = (x % 16 + 16) % 16;
          const lz = (z % 16 + 16) % 16;
          const cx = Math.floor(x / 16);
          const cz = Math.floor(z / 16);
          const chunkKey = `${cx},${cz}`;

          if (!newChunks[chunkKey] || !newChunks[chunkKey].buffer) return;

          if (newChunks[chunkKey] === prev.chunks[chunkKey]) {
            newChunks[chunkKey] = {
              ...prev.chunks[chunkKey],
              buffer: new Uint32Array(prev.chunks[chunkKey].buffer),
              isModified: true,
              rebuildId: (prev.chunks[chunkKey].rebuildId || 0) + 1
            };
          }

            const newBuffer = newChunks[chunkKey].buffer;
            const idx = getIndex(lx, ly, lz);
            const val = newBuffer[idx];
            if ((val & 0xff) === 0) return; // already air

            const texId = val & 0xff;
            const texName = BlockKeyById[texId];
            if (texName === 'bedrock') return; // protect bedrock!

            setBlock(newBuffer, idx, 0, 0, 0, 0);
            if (!chunkDeltas[chunkKey]) chunkDeltas[chunkKey] = [];
            chunkDeltas[chunkKey].push(idx, 0);

            rebuilds.add(chunkKey);
            if (lx === 0) rebuilds.add(`${cx - 1},${cz}`);
            if (lx === 15) rebuilds.add(`${cx + 1},${cz}`);
            if (lz === 0) rebuilds.add(`${cx},${cz - 1}`);
            if (lz === 15) rebuilds.add(`${cx},${cz + 1}`);

            let chestItems = null;
            if (texName === 'chest') {
              chestItems = useInventoryStore.getState().chests[`${x},${y},${z}`] || null;
            }

            processedBlocks.push({
              x,
              y: ly,
              z,
              texName,
              chestItems
            });
          });

          // BFS UNHIDE PROPAGATION FOR BULK REMOVAL:
          {
            const BFS_MAX_DEPTH = 5;
            const bfsQueue = [];
            const bfsDirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
            const bfsVisited = new Set();

            // Seed BFS queue with neighbors of all successfully processed (destroyed) blocks
            processedBlocks.forEach(b => {
              const bx = b.x;
              const by = b.y;
              const bz = b.z;
              bfsVisited.add(`${bx},${by},${bz}`);
              bfsDirs.forEach(([dx, dy, dz]) => {
                bfsQueue.push([bx + dx, by + dy, bz + dz, 1]);
              });
            });

            let qi = 0;
            while (qi < bfsQueue.length) {
              const [nx, ny, nz, depth] = bfsQueue[qi++];
              const key = `${nx},${ny},${nz}`;
              if (bfsVisited.has(key)) continue;
              bfsVisited.add(key);
              if (ny < CHUNK_Y_MIN || ny > CHUNK_Y_MAX) continue;

              const ncx = Math.floor(nx / 16);
              const ncz = Math.floor(nz / 16);
              const nChunkKey = `${ncx},${ncz}`;
              const nlx = (nx % 16 + 16) % 16;
              const nlz = (nz % 16 + 16) % 16;

              const nChunk = newChunks[nChunkKey] || prev.chunks[nChunkKey];
              if (!nChunk?.buffer) continue;

              // Copy-on-write
              if (!newChunks[nChunkKey] || newChunks[nChunkKey] === prev.chunks[nChunkKey]) {
                newChunks[nChunkKey] = {
                  ...prev.chunks[nChunkKey],
                  buffer: new Uint32Array(prev.chunks[nChunkKey].buffer),
                  isModified: true,
                  rebuildId: (prev.chunks[nChunkKey].rebuildId || 0) + 1
                };
              }
              const targetBuffer = newChunks[nChunkKey].buffer;
              const nIdx = getIndex(nlx, ny, nlz);
              const nVal = targetBuffer[nIdx];
              if ((nVal & 0xff) === 0) continue; // air doesn't need unhiding

              // Clear hidden bit (bit 21)
              const unhiddenVal = nVal & ~(1 << 21);
              if (unhiddenVal !== nVal) {
                targetBuffer[nIdx] = unhiddenVal;
                if (!chunkDeltas[nChunkKey]) chunkDeltas[nChunkKey] = [];
                chunkDeltas[nChunkKey].push(nIdx, unhiddenVal);
                rebuilds.add(nChunkKey);
              }

              // If the neighbor block is not opaque, propagate further (BFS)
              const nTexId = getTextureId(nVal);
              const nDef = BlockById[nTexId];
              const isOpaque = nTexId !== 0 && nDef && !nDef.isTransparent;
              if (!isOpaque && depth < BFS_MAX_DEPTH) {
                bfsDirs.forEach(([dx, dy, dz]) => {
                  bfsQueue.push([nx + dx, ny + dy, nz + dz, depth + 1]);
                });
              }
            }
          }

          return {
            chunks: newChunks
          };
      })(prev);

      if (__patch.chunks !== undefined) {
        useChunkStore.setState({ chunks: __patch.chunks });
      }

      rebuilds.forEach(ck => get().requestMeshRebuild(ck));

      if (networkActions) {
        for (const ck in chunkDeltas) {
          networkActions.getState().broadcastDelta(ck, chunkDeltas[ck]);
        }
      }

      if (processedBlocks.length > 0) {
        EventBus.emit('EVENT_BLOCKS_DESTROYED_BULK', {
          blocks: processedBlocks,
          causedByGravity,
          initiatedByPlayerId
        });
      }
    },
    damageBlocksBulk: blocksData => {
      // blocksData: Array of { x, y, z, amount }

      (() => {
        const prev = getCombinedState(rawGet);
        const __patch = (prev => {
          const newChunks = {
            ...prev.chunks
          };
          const newPendingDeltas = {
            ...prev.pendingDeltas
          };
          let updated = false;
          const rebuilds = new Set();
          for (const {
            x,
            y,
            z,
            amount
          } of blocksData) {
            const chunkKey = getChunkKey(x, z);
            const ly = Math.floor(y);
            if (ly < CHUNK_Y_MIN || ly >= CHUNK_Y_MAX) continue;
            const chunkData = newChunks[chunkKey];
            if (!chunkData || !chunkData.buffer) continue;
            const lx = Math.floor(x) % 16;
            const lz = Math.floor(z) % 16;
            const localX = lx < 0 ? lx + 16 : lx;
            const localZ = lz < 0 ? lz + 16 : lz;
            const i = getIndex(localX, ly, localZ);
            const val = chunkData.buffer[i];
            const currentId = getTextureId(val);
            if (currentId === 0) continue;
            const texName = BlockKeyById[currentId];
            if (texName === 'bedrock') continue;
            if (BlockById[currentId]?.isFluid) continue;

            const blockConfig = BlockById[currentId] || { health: 100 };
            let health = getHealth(val);
            if (health === Infinity) continue;

            health -= amount;
            if (health <= 0) {
              // Block is destroyed
              setBlock(chunkData.buffer, i, 0, 0, false);
              if (!newPendingDeltas[chunkKey]) newPendingDeltas[chunkKey] = {};
              newPendingDeltas[chunkKey][getBlockKey(localX, ly, localZ)] = 0;
              rebuilds.add(chunkKey);

              const dirs = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
              for (const [dx, dy, dz] of dirs) {
                const nx = Math.floor(x) + dx;
                const ny = ly + dy;
                const nz = Math.floor(z) + dz;
                if (ny < CHUNK_Y_MIN || ny > CHUNK_Y_MAX) continue;
                const ncx = Math.floor(nx / 16);
                const ncz = Math.floor(nz / 16);
                const nKey = `${ncx},${ncz}`;
                const nlx = (nx % 16 + 16) % 16;
                const nlz = (nz % 16 + 16) % 16;
                const nChunk = newChunks[nKey] || prev.chunks[nKey];
                if (nChunk && nChunk.buffer) {
                  if (!newChunks[nKey] || newChunks[nKey] === prev.chunks[nKey]) {
                    newChunks[nKey] = {
                      ...prev.chunks[nKey],
                      buffer: new Uint32Array(prev.chunks[nKey].buffer),
                      isModified: true,
                      rebuildId: (prev.chunks[nKey].rebuildId || 0) + 1
                    };
                  }
                  const nBuffer = newChunks[nKey].buffer;
                  const nIdx = getIndex(nlx, ny, nlz);
                  const nVal = nBuffer[nIdx];
                  if ((nVal & 0xff) !== 0) {
                    const unhiddenVal = nVal & ~(1 << 21);
                    if (unhiddenVal !== nVal) {
                      nBuffer[nIdx] = unhiddenVal;
                      rebuilds.add(nKey);
                    }
                  }
                }
              }

              const neighborChunks = [getChunkKey(x - 1, z), getChunkKey(x + 1, z), getChunkKey(x, z - 1), getChunkKey(x, z + 1)];
              for (const nc of neighborChunks) {
                if (nc !== chunkKey) rebuilds.add(nc);
              }
            } else {
              // Block damaged
              chunkData.buffer[i] = (val & ~(0x1ff << 8)) | ((health & 0x1ff) << 8);
              newChunks[chunkKey] = {
                ...chunkData
              };
            }
            updated = true;
          }
          if (!updated) return prev;

          // We rely on external removal of physics/items if needed, but for Beast attacks
          // bulk block destruction should rebuild meshes.
          rebuilds.forEach(cKey => {
            if (newChunks[cKey]) {
              newChunks[cKey].rebuildId = (newChunks[cKey].rebuildId || 0) + 1;
              newChunks[cKey].isModified = true;
            }
          });
          return {
            chunks: newChunks,
            pendingDeltas: newPendingDeltas
          };
        })(prev);
        if (__patch.chunks !== undefined || __patch.pendingMeshMounts !== undefined || __patch.overflowChunks !== undefined || __patch.activePhysicsChunks !== undefined) {
          const cPatch = {};
          if (__patch.chunks !== undefined) cPatch.chunks = __patch.chunks;
          if (__patch.pendingMeshMounts !== undefined) cPatch.pendingMeshMounts = __patch.pendingMeshMounts;
          if (__patch.overflowChunks !== undefined) cPatch.overflowChunks = __patch.overflowChunks;
          if (__patch.activePhysicsChunks !== undefined) cPatch.activePhysicsChunks = __patch.activePhysicsChunks;
          useChunkStore.setState(cPatch);
        }
        if (__patch.debris !== undefined || __patch.fallingStructures !== undefined || __patch.chests !== undefined || __patch.droppedItems !== undefined || __patch.tombstones !== undefined) {
          const iPatch = {};
          if (__patch.debris !== undefined) iPatch.debris = __patch.debris;
          if (__patch.fallingStructures !== undefined) iPatch.fallingStructures = __patch.fallingStructures;
          if (__patch.chests !== undefined) iPatch.chests = __patch.chests;
          if (__patch.droppedItems !== undefined) iPatch.droppedItems = __patch.droppedItems;
          if (__patch.tombstones !== undefined) iPatch.tombstones = __patch.tombstones;
          useInventoryStore.setState(iPatch);
        }
        if (__patch.placedFlares !== undefined) useFlareStore.setState({
          placedFlares: __patch.placedFlares
        });
        if (__patch.worldTime !== undefined) {
          useEnvironmentStore.setState({
            worldTime: __patch.worldTime,
            currentDay: __patch.currentDay,
            isNightTime: __patch.isNightTime,
            isRaining: __patch.isRaining,
            skyColor: __patch.skyColor,
            fogDensity: __patch.fogDensity
          });
        }
        if (__patch.pendingDeltas !== undefined || __patch.isResetting !== undefined || __patch.batcherVersion !== undefined) {
          const rawPatch = {};
          if (__patch.pendingDeltas !== undefined) rawPatch.pendingDeltas = __patch.pendingDeltas;
          if (__patch.isResetting !== undefined) rawPatch.isResetting = __patch.isResetting;
          if (__patch.batcherVersion !== undefined) rawPatch.batcherVersion = __patch.batcherVersion;
          rawSet(rawPatch);
        }
      })();

      // Defer mesh rebuilds
      const state = get();
      // We don't have rebuilds set here, so we'll just request rebuilds on next frame for pending chunks if needed.
      // Actually, we can just let AutoSaveManager/Network sync handle it, or we can manually request.
      // The beast attack is just an effect. We will add manual rebuild requests in SwarmManager.
    },
    damageBlock: (x, y, z, amount, naturalOnly = false) => {
      const chunkKey = getChunkKey(x, z);
      const ly = Math.floor(y); // Use floor: DDA returns integer block coords; Math.round(y-0.5) is wrong for negative Y
      if (ly < CHUNK_Y_MIN || ly > CHUNK_Y_MAX) return;
      const state = get();
      const chunkData = useChunkStore.getState().chunks[chunkKey];
      if (!chunkData) return;
      const lx = (x % 16 + 16) % 16;
      const lz = (z % 16 + 16) % 16;
      const val = chunkData.buffer[getIndex(lx, ly, lz)];
      if ((val & 0xff) === 0) return;
      if (naturalOnly) {
        const texId = val & 0xff;
        const def = BlockById[texId];
        if (def && (def.isContainer || def.isInteractable || def.id === BlockIds.tnt)) return;
      }
      const health = val >> 8 & 0x1ff;
      if (health === 511) return; // Infinity

      if (health - amount <= 0) {
        useStore.getState().removeCube(x, y, z);
      } else {
        (() => {
          const prev = getCombinedState(rawGet);
          const __patch = (prev => {
            const newChunks = {
              ...prev.chunks
            };
            const newBuffer = new Uint32Array(chunkData.buffer);

            // rewrite health
            const newHealth = health - amount;
            const idx = getIndex(lx, ly, lz);
            newBuffer[idx] = val & ~(0x1ff << 8) | (newHealth & 0x1ff) << 8;
            const networkActions = getNetworkStore();
            if (networkActions) {
              networkActions.getState().broadcastDelta(chunkKey, [idx, newBuffer[idx]]);
            }
            newChunks[chunkKey] = {
              ...chunkData,
              buffer: newBuffer,
              isModified: true
            };
            return {
              chunks: newChunks
            };
          })(prev);
          if (__patch.chunks !== undefined || __patch.pendingMeshMounts !== undefined || __patch.overflowChunks !== undefined || __patch.activePhysicsChunks !== undefined) {
            const cPatch = {};
            if (__patch.chunks !== undefined) cPatch.chunks = __patch.chunks;
            if (__patch.pendingMeshMounts !== undefined) cPatch.pendingMeshMounts = __patch.pendingMeshMounts;
            if (__patch.overflowChunks !== undefined) cPatch.overflowChunks = __patch.overflowChunks;
            if (__patch.activePhysicsChunks !== undefined) cPatch.activePhysicsChunks = __patch.activePhysicsChunks;
            useChunkStore.setState(cPatch);
          }
          if (__patch.debris !== undefined || __patch.fallingStructures !== undefined || __patch.chests !== undefined || __patch.droppedItems !== undefined || __patch.tombstones !== undefined) {
            const iPatch = {};
            if (__patch.debris !== undefined) iPatch.debris = __patch.debris;
            if (__patch.fallingStructures !== undefined) iPatch.fallingStructures = __patch.fallingStructures;
            if (__patch.chests !== undefined) iPatch.chests = __patch.chests;
            if (__patch.droppedItems !== undefined) iPatch.droppedItems = __patch.droppedItems;
            if (__patch.tombstones !== undefined) iPatch.tombstones = __patch.tombstones;
            useInventoryStore.setState(iPatch);
          }
          if (__patch.placedFlares !== undefined) useFlareStore.setState({
            placedFlares: __patch.placedFlares
          });
          if (__patch.worldTime !== undefined) {
            useEnvironmentStore.setState({
              worldTime: __patch.worldTime,
              currentDay: __patch.currentDay,
              isNightTime: __patch.isNightTime,
              isRaining: __patch.isRaining,
              skyColor: __patch.skyColor,
              fogDensity: __patch.fogDensity
            });
          }
          if (__patch.pendingDeltas !== undefined || __patch.isResetting !== undefined || __patch.batcherVersion !== undefined) {
            const rawPatch = {};
            if (__patch.pendingDeltas !== undefined) rawPatch.pendingDeltas = __patch.pendingDeltas;
            if (__patch.isResetting !== undefined) rawPatch.isResetting = __patch.isResetting;
            if (__patch.batcherVersion !== undefined) rawPatch.batcherVersion = __patch.batcherVersion;
            rawSet(rawPatch);
          }
        })();
      }
    },
    triggerExplosion: (ex, ey, ez, radius = 4) => {
      const state = get();
      const blocksToDestroy = [];
      const minX = Math.floor(ex - radius);
      const maxX = Math.ceil(ex + radius);
      const minY = Math.floor(ey - radius);
      const maxY = Math.ceil(ey + radius);
      const minZ = Math.floor(ez - radius);
      const maxZ = Math.ceil(ez + radius);
      for (let gx = minX; gx <= maxX; gx++) {
        for (let ly = Math.max(CHUNK_Y_MIN, minY); ly <= Math.min(CHUNK_Y_MAX, maxY); ly++) {
          for (let gz = minZ; gz <= maxZ; gz++) {
            const cx = Math.floor(gx / 16);
            const cz = Math.floor(gz / 16);
            const chunkKey = `${cx},${cz}`;
            const chunk = useChunkStore.getState().chunks[chunkKey];
            if (!chunk || !chunk.buffer) continue;
            const lx = (gx % 16 + 16) % 16;
            const lz = (gz % 16 + 16) % 16;
            const idx = (ly - CHUNK_Y_MIN) * 256 + lz * 16 + lx;
            const val = chunk.buffer[idx];
            if ((val & 0xff) === 0) continue;
            const texId = getTextureId(val);
            if (BlockKeyById[texId] === 'bedrock') continue;
            const gy = ly + 0.5;
            const dist = Math.sqrt(Math.pow(gx - ex, 2) + Math.pow(gy - ey, 2) + Math.pow(gz - ez, 2));
            if (dist <= radius) {
              blocksToDestroy.push({
                x: gx,
                y: gy,
                z: gz
              });
            }
          }
        }
      }
      if (blocksToDestroy.length > 0) {
        state.removeCubesBulk(blocksToDestroy);
      }
      if (state.requestAreaDamage) {
        setTimeout(() => state.requestAreaDamage([ex, ey, ez], radius + 3, 1000), 0);
      }
      const blastRadius = Math.ceil(radius);
      for (let dx = -blastRadius - 1; dx <= blastRadius + 1; dx++) {
        for (let dy = -blastRadius - 1; dy <= blastRadius + 1; dy++) {
          for (let dz = -blastRadius - 1; dz <= blastRadius + 1; dz++) {
            if (Math.sqrt(dx * dx + dy * dy + dz * dz) <= blastRadius + 1) {
              wakeFluidsAround(get, set, Math.floor(ex + dx), Math.floor(ey + dy) + 0.5, Math.floor(ez + dz));
            }
          }
        }
      }
    },
    shatterStructure: (structureId, debrisBlocks) => useInventoryStore.setState(prev => ({
      fallingStructures: prev.fallingStructures.filter(s => s.id !== structureId),
      debris: [...prev.debris, ...debrisBlocks].slice(-300)
    })),
    removeDebris: debrisKey => useInventoryStore.setState(prev => ({
      debris: prev.debris.filter(d => d.key !== debrisKey)
    })),
    saveWorld: async () => {
      if (useStore.getState().isResetting) return;
      const chunks = useChunkStore.getState().chunks;
      const chunksToSave = [];

      // FAILSAFE 2: Self-Healing Global State Sweep
      // If any flare or dropped item is caught living inside an unloaded chunk coordinate,
      // it means the entity was orphaned due to a race condition. Delete it.
      (() => {
        const prev = getCombinedState(rawGet);
        const __patch = (prev => {
          let changed = false;
          const validFlares = prev.placedFlares.filter(f => {
            const cx = Math.floor(f.pos[0] / 16);
            const cz = Math.floor(f.pos[2] / 16);
            const chunkKey = `${cx},${cz}`;
            if (!prev.chunks[chunkKey]) {
              console.warn(`[FAILSAFE] Purged orphaned Flare at ${f.pos.join(',')} in unloaded chunk ${chunkKey}`);
              return false;
            }
            return true;
          });
          const validDrops = prev.droppedItems.filter(d => {
            const cx = Math.floor(d.pos[0] / 16);
            const cz = Math.floor(d.pos[2] / 16);
            const chunkKey = `${cx},${cz}`;
            if (!prev.chunks[chunkKey]) {
              console.warn(`[FAILSAFE] Purged orphaned Item at ${d.pos.join(',')} in unloaded chunk ${chunkKey}`);
              return false;
            }
            return true;
          });
          const nextState = {};
          if (validFlares.length !== prev.placedFlares.length) {
            nextState.placedFlares = validFlares;
            changed = true;
          }
          if (validDrops.length !== prev.droppedItems.length) {
            nextState.droppedItems = validDrops;
            changed = true;
          }
          return changed ? nextState : prev;
        })(prev);
        if (__patch.chunks !== undefined || __patch.pendingMeshMounts !== undefined || __patch.overflowChunks !== undefined || __patch.activePhysicsChunks !== undefined) {
          const cPatch = {};
          if (__patch.chunks !== undefined) cPatch.chunks = __patch.chunks;
          if (__patch.pendingMeshMounts !== undefined) cPatch.pendingMeshMounts = __patch.pendingMeshMounts;
          if (__patch.overflowChunks !== undefined) cPatch.overflowChunks = __patch.overflowChunks;
          if (__patch.activePhysicsChunks !== undefined) cPatch.activePhysicsChunks = __patch.activePhysicsChunks;
          useChunkStore.setState(cPatch);
        }
        if (__patch.debris !== undefined || __patch.fallingStructures !== undefined || __patch.chests !== undefined || __patch.droppedItems !== undefined || __patch.tombstones !== undefined) {
          const iPatch = {};
          if (__patch.debris !== undefined) iPatch.debris = __patch.debris;
          if (__patch.fallingStructures !== undefined) iPatch.fallingStructures = __patch.fallingStructures;
          if (__patch.chests !== undefined) iPatch.chests = __patch.chests;
          if (__patch.droppedItems !== undefined) iPatch.droppedItems = __patch.droppedItems;
          if (__patch.tombstones !== undefined) iPatch.tombstones = __patch.tombstones;
          useInventoryStore.setState(iPatch);
        }
        if (__patch.placedFlares !== undefined) useFlareStore.setState({
          placedFlares: __patch.placedFlares
        });
        if (__patch.worldTime !== undefined) {
          useEnvironmentStore.setState({
            worldTime: __patch.worldTime,
            currentDay: __patch.currentDay,
            isNightTime: __patch.isNightTime,
            isRaining: __patch.isRaining,
            skyColor: __patch.skyColor,
            fogDensity: __patch.fogDensity
          });
        }
        if (__patch.pendingDeltas !== undefined || __patch.isResetting !== undefined || __patch.batcherVersion !== undefined) {
          const rawPatch = {};
          if (__patch.pendingDeltas !== undefined) rawPatch.pendingDeltas = __patch.pendingDeltas;
          if (__patch.isResetting !== undefined) rawPatch.isResetting = __patch.isResetting;
          if (__patch.batcherVersion !== undefined) rawPatch.batcherVersion = __patch.batcherVersion;
          rawSet(rawPatch);
        }
      })();

      // 1. Gather all modified chunks and their CURRENT rebuildId
      for (const [key, data] of Object.entries(chunks)) {
        if (data.isModified) {
          chunksToSave.push({
            key,
            data,
            savedRebuildId: data.rebuildId || 0
          });
        }
      }
      if (chunksToSave.length === 0) return;

      // 2. Perform async IndexedDB saves
      await Promise.all(chunksToSave.map(c => saveChunkToDB(c.key, c.data)));

      // Force WAL to flush immediately so that saveWorld is truly atomic and waits for completion
      await flushWAL();

      // Save decoupled world entities (chests, items, etc)
      const {
        saveWorldEntities
      } = await import('../utils/db');
      await saveWorldEntities({
        chests: useInventoryStore.getState().chests,
        authoritativeInventories: get().authoritativeInventories,
        tombstones: useInventoryStore.getState().tombstones,
        droppedItems: useInventoryStore.getState().droppedItems
      });

      // 3. Clear isModified ONLY IF the chunk wasn't modified again during the save
      (() => {
        const prev = getCombinedState(rawGet);
        const __patch = (prev => {
          const newChunks = {
            ...prev.chunks
          };
          let changed = false;
          for (const {
            key,
            savedRebuildId
          } of chunksToSave) {
            const current = newChunks[key];
            if (current && current.isModified && (current.rebuildId || 0) === savedRebuildId) {
              newChunks[key] = {
                ...current,
                isModified: false
              };
              changed = true;
            }
          }
          return changed ? {
            chunks: newChunks
          } : prev;
        })(prev);
        if (__patch.chunks !== undefined || __patch.pendingMeshMounts !== undefined || __patch.overflowChunks !== undefined || __patch.activePhysicsChunks !== undefined) {
          const cPatch = {};
          if (__patch.chunks !== undefined) cPatch.chunks = __patch.chunks;
          if (__patch.pendingMeshMounts !== undefined) cPatch.pendingMeshMounts = __patch.pendingMeshMounts;
          if (__patch.overflowChunks !== undefined) cPatch.overflowChunks = __patch.overflowChunks;
          if (__patch.activePhysicsChunks !== undefined) cPatch.activePhysicsChunks = __patch.activePhysicsChunks;
          useChunkStore.setState(cPatch);
        }
        if (__patch.debris !== undefined || __patch.fallingStructures !== undefined || __patch.chests !== undefined || __patch.droppedItems !== undefined || __patch.tombstones !== undefined) {
          const iPatch = {};
          if (__patch.debris !== undefined) iPatch.debris = __patch.debris;
          if (__patch.fallingStructures !== undefined) iPatch.fallingStructures = __patch.fallingStructures;
          if (__patch.chests !== undefined) iPatch.chests = __patch.chests;
          if (__patch.droppedItems !== undefined) iPatch.droppedItems = __patch.droppedItems;
          if (__patch.tombstones !== undefined) iPatch.tombstones = __patch.tombstones;
          useInventoryStore.setState(iPatch);
        }
        if (__patch.placedFlares !== undefined) useFlareStore.setState({
          placedFlares: __patch.placedFlares
        });
        if (__patch.worldTime !== undefined) {
          useEnvironmentStore.setState({
            worldTime: __patch.worldTime,
            currentDay: __patch.currentDay,
            isNightTime: __patch.isNightTime,
            isRaining: __patch.isRaining,
            skyColor: __patch.skyColor,
            fogDensity: __patch.fogDensity
          });
        }
        if (__patch.pendingDeltas !== undefined || __patch.isResetting !== undefined || __patch.batcherVersion !== undefined) {
          const rawPatch = {};
          if (__patch.pendingDeltas !== undefined) rawPatch.pendingDeltas = __patch.pendingDeltas;
          if (__patch.isResetting !== undefined) rawPatch.isResetting = __patch.isResetting;
          if (__patch.batcherVersion !== undefined) rawPatch.batcherVersion = __patch.batcherVersion;
          rawSet(rawPatch);
        }
      })();
    }
  };
};

// --- Dirty-set trampoline ---
// The module-level flushDirtyChunks cannot close over get/rawGet/rawSet directly
// because those are created inside the store factory. _executeRebuild is assigned
// on first call to requestMeshRebuild(), capturing the store closures.
let _executeRebuild = null;

// --- Telemetry Hook ---
const telemetryInterval = setInterval(() => {
  if (window.__DEBUG_STATS__) {
    window.__DEBUG_STATS__.inFlightChunks = inFlightChunks.size;
    window.__DEBUG_STATS__.processingDeltas = processingNetworkDeltas.size;
    window.__DEBUG_STATS__.dirtyChunks = dirtyChunkSet.size;
    window.__DEBUG_STATS__.inFlightRebuilds = inFlightRebuildSet.size;
  }
}, 200);
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    clearInterval(telemetryInterval);
    if (rafRebuildHandle !== null) {
      cancelAnimationFrame(rafRebuildHandle);
      rafRebuildHandle = null;
    }
  });
}