import { getNetworkStore } from "./storeLinker";
import { v4 as uuidV4 } from "uuid";
import {
  saveChunkToDB,
  loadChunkFromDB,
  deleteChunkFromDB,
  clearDB,
  cancelLoadFromDB,
  flushWAL,
} from "../utils/db";
import {
  BlockRegistry,
  BlockById,
  BlockKeyById,
  BlockIds,
} from "../registry/BlockRegistry";
import {
  setBlock,
  getIndex,
  getTextureId,
  getIsHidden,
  getLevel,
  CHUNK_Y_MIN,
  CHUNK_Y_MAX,
} from "../utils/chunkData";
import { chunkWorkerPool } from "../utils/workerPool";
import { getSeed } from "../worldSeed";
import { tickFluids, wakeFluidsAround } from "../utils/fluidSystem";
import { checkStructuralIntegrity } from "../utils/structuralPhysics";

// Module-level guard: prevents two concurrent async calls from double-generating
// the same chunk (race condition when the player moves fast).
const inFlightChunks = new Set();
const cancelledChunks = new Set();
const processingNetworkDeltas = new Set();
const meshRebuildTimers = {};
const pass1Cache = new Map();

const getChunkKey = (x, z) => `${Math.floor(x / 16)},${Math.floor(z / 16)}`;
const getBlockKey = (x, y, z) => `${x},${y},${z}`;

export const createWorldSlice = (set, get) => ({
    batcherVersion: 0,
    incrementBatcherVersion: () => set(state => ({ batcherVersion: state.batcherVersion + 1 })),
    chunks: {},
    pass1Cache: pass1Cache,
    chests: {}, // Spatial Container Schema (Phase 6): { "x,y,z": [ ...slots... ] }
    pendingDeltas: {},
    isResetting: false,
    tickFluids: () => tickFluids(get, set),
    pendingMeshMounts: [],
  overflowChunks: [],
  activePhysicsChunks: [],
  setActivePhysicsChunks: (chunks) => set({ activePhysicsChunks: chunks }),
  mountNextMesh: (batchSize = 1) => {
    const state = get();
    if (!state.pendingMeshMounts || state.pendingMeshMounts.length === 0) return;
    
    const actualBatchSize = Math.min(batchSize, state.pendingMeshMounts.length);
    const batch = state.pendingMeshMounts.slice(0, actualBatchSize);
    const remaining = state.pendingMeshMounts.slice(actualBatchSize);
    
    const nextChunks = {};
    let newOverflow = [...state.overflowChunks];
    const toRecycle = {};

    for (const nextMount of batch) {
        const existingChunk = state.chunks[nextMount.chunkKey];
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
            for (const [key, group] of Object.entries(nextMount.meshArrays)) {
                if (group._isCached) {
                    tightMeshArrays[key] = group;
                } else {
                    tightMeshArrays[key] = {};
                    for (const prop in group) {
                        try {
                            tightMeshArrays[key][prop] = group[prop].slice();
                        } catch (e) {}
                    }
                    toRecycle[`${nextMount.chunkKey}_${key}`] = group;
                }
            }
            if (!newOverflow.includes(nextMount.chunkKey)) {
                newOverflow.push(nextMount.chunkKey);
            }
        }
        
        const finalMeshArrays = { ...tightMeshArrays };
        if (
          existingChunk.physicsRebuildId === (existingChunk.rebuildId || 0) &&
          existingChunk.meshArrays?.__physics
        ) {
          finalMeshArrays.__physics = { ...existingChunk.meshArrays.__physics, _isCached: true };
        }
        
        nextChunks[nextMount.chunkKey] = {
            ...existingChunk,
            meshArrays: finalMeshArrays,
            physicsRebuildId: (nextMount.rebuildId ?? (existingChunk.rebuildId || 0))
        };
    }
    
    // Bypass recycleBuffers call entirely to prevent Vite HMR caching issues causing TypeErrors
    // V8 GC will handle the typed arrays for now.
    
    set(prev => ({
        pendingMeshMounts: remaining,
        overflowChunks: newOverflow,
        chunks: {
            ...prev.chunks,
            ...nextChunks
        }
    }));
  },

  resetWorld: async () => {
    if (get().isResetting) return;
    set({ isResetting: true, pendingMeshMounts: [] });
    
    chunkWorkerPool._queue = [];

    inFlightChunks.clear();
    cancelledChunks.clear();
    
    await clearDB();
    
    set({
      chunks: {},
      isResetting: false,
      debris: [],
      placedFlares: [],
      pendingDeltas: {}
    });
    
    const prefix = sessionStorage.getItem("saveSlotId") || "default";
    sessionStorage.removeItem("saveSlotId");
    localStorage.removeItem(`saveMetadata_${prefix}`);
    window.location.reload();
  },
  
  applyWorldSync: (chunksData) => {
    set((prev) => {
      const newChunks = { ...prev.chunks };
      let updated = false;
      for (const chunkKey in chunksData) {
        const rawBuf = chunksData[chunkKey];
        let newBuffer;
        if (rawBuf instanceof Uint8Array) {
          const exactBuffer = rawBuf.buffer.slice(
            rawBuf.byteOffset,
            rawBuf.byteOffset + rawBuf.byteLength,
          );
          newBuffer = new Uint32Array(exactBuffer);
        } else if (rawBuf instanceof ArrayBuffer) {
          newBuffer = new Uint32Array(rawBuf);
        } else {
          newBuffer = new Uint32Array(rawBuf); // Fallback
        }

        if (newChunks[chunkKey]) {
          newChunks[chunkKey] = {
            ...newChunks[chunkKey],
            buffer: newBuffer,
            isModified: true,
            rebuildId: (newChunks[chunkKey].rebuildId || 0) + 1,
          };
          updated = true;
        } else {
          // Chunk not loaded yet on guest? Store it so it's ready when the chunk loads
          newChunks[chunkKey] = {
            buffer: newBuffer,
            isModified: true,
            rebuildId: 1,
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
      return updated ? { chunks: newChunks } : {};
    });
    // Need to rebuild all synced chunks!
    for (const chunkKey in chunksData) {
      get().requestMeshRebuild(chunkKey);
    }
  },

  applyNetworkDelta: (chunkKey, deltas) => {
    // Incoming from WebRTC!
    let rebuilds = new Set();
    set((prev) => {
      const prevChunkData = prev.chunks[chunkKey];
      if (!prevChunkData) {
        // Silently load, apply, and save to DB in the background to prevent data loss!
        if (!processingNetworkDeltas.has(chunkKey)) {
          processingNetworkDeltas.add(chunkKey);
          setTimeout(async () => {
            try {
              const processingDeltas = get().pendingDeltas[chunkKey];
              if (!processingDeltas) return;
              set((s) => {
                const next = { ...s.pendingDeltas };
                delete next[chunkKey];
                return { pendingDeltas: next };
              });
              let chunkData;
              chunkData = await loadChunkFromDB(chunkKey);
              if (!chunkData) {
                const [cx, cz] = chunkKey.split(",");
                chunkData = await chunkWorkerPool.generatePass1(
                  parseInt(cx),
                  parseInt(cz),
                  getSeed(),
                );
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
              console.error("Silent delta save failed", e);
            } finally {
              processingNetworkDeltas.delete(chunkKey);
              if (get().pendingDeltas[chunkKey]) {
                get().applyNetworkDelta(chunkKey, []);
              }
            }
          }, 0);
        }

        return {
          pendingDeltas: {
            ...prev.pendingDeltas,
            [chunkKey]: [...(prev.pendingDeltas[chunkKey] || []), ...deltas],
          },
        };
      }

      rebuilds.add(chunkKey);
      const [cx, cz] = chunkKey.split(",").map(Number);

      const newBuffer = new Uint32Array(prevChunkData.buffer);
      for (let i = 0; i < deltas.length; i += 2) {
        const idx = deltas[i];
        newBuffer[idx] = deltas[i + 1];

        const lx = (idx % 256) % 16;
        const lz = Math.floor((idx % 256) / 16);

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
            buffer: newBuffer,
            isModified: true,
            rebuildId: (prevChunkData.rebuildId || 0) + 1,
          },
        },
      };
    });

    // Only rebuild the chunk itself and neighbors that actually touch the modified blocks!
    rebuilds.forEach((nck) => {
      if (get().chunks[nck]) get().requestMeshRebuild(nck);
    });
  },

  getGlobalBlockSafe: (x, y, z) => {
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const chunk = get().chunks[`${cx},${cz}`];
    if (!chunk || !chunk.buffer) return 0;
    const ly = Math.round(y - 0.5);
    if (ly < CHUNK_Y_MIN || ly > CHUNK_Y_MAX) return 0;
    const lx = ((x % 16) + 16) % 16;
    const lz = ((z % 16) + 16) % 16;
    return chunk.buffer[getIndex(lx, ly, lz)];
  },

  findSafeSpawnY: (x, z) => {
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const chunk = get().chunks[`${cx},${cz}`];
    if (!chunk || !chunk.buffer || !chunk.meshArrays) return 400; // Wait for mesh to mount

    const lx = Math.floor(((x % 16) + 16) % 16);
    const lz = Math.floor(((z % 16) + 16) % 16);

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

  clearVisualMeshArrays: (chunkKey) =>
    set((prev) => {
      const chunk = prev.chunks[chunkKey];
      if (!chunk || !chunk.meshArrays) return prev;

      // If it only has physics keys or meta keys (or is completely empty), it's already cleared.
      const keys = Object.keys(chunk.meshArrays);
      if (
        keys.length === 0 ||
        keys.every(
          (k) =>
            k === "__physics" ||
            k === "_physics" ||
            k === "__meta" ||
            k === "__flora",
        )
      ) {
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
            meshArrays: newMeshArrays,
          },
        },
      };
    }),

  applyNetworkSync: (chunksData) => {
    set((prev) => {
      const newChunks = { ...prev.chunks };
      let updated = false;

      for (const chunkKey in chunksData) {
        const incoming = chunksData[chunkKey];
        const current = prev.chunks[chunkKey];

        if (!current) {
          const newBuffer = new Uint8Array(incoming.buffer);
          newChunks[chunkKey] = {
            buffer: newBuffer,
            isModified: true,
            rebuildId: 1,
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
      return updated ? { chunks: newChunks } : {};
    });
    // Need to rebuild all synced chunks!
    for (const chunkKey in chunksData) {
      get().requestMeshRebuild(chunkKey);
    }
  },

  activeFluids: [], // Stores string keys like "x,y,z" of fluids that need ticking
  worldTime: 12.0,
  daysElapsed: 1,
  isNightTime: false,
  isRaining: false,
  fallingStructures: [],
  debris: [],

  setWorldTime: (time, day) => set((state) => {
    let newRaining = state.isRaining;
    if (Math.floor(time) !== Math.floor(state.worldTime)) {
      if (Math.random() < 0.10) {
        newRaining = !newRaining;
      }
    }
    return { worldTime: time, daysElapsed: day, isRaining: newRaining };
  }),

  placedFlares: [],

  placeFlare: (pos, normal, id) => {
    set((prev) => ({
      placedFlares: [
        ...prev.placedFlares,
        { id: id, pos, normal, emitLight: true },
      ],
    }));
    const useNetworkStore = getNetworkStore();
    if (useNetworkStore) {
      useNetworkStore.getState().broadcastEvent({
        type: "ENTITY_SPAWN_EVENT",
        entityType: "flare",
        id: id,
        pos,
        normal,
      });
    }
  },
  removeFlare: (id) => {
    set((prev) => ({
      placedFlares: prev.placedFlares.filter((t) => t.id !== id),
    }));
    const useNetworkStore = getNetworkStore();
    if (useNetworkStore) {
      useNetworkStore.getState().broadcastEvent({
        type: "ACTION_INTENT",
        action: "REMOVE_FLARE",
        id: id,
      });
    }
  },

  requestMeshRebuild: (chunkKey) => {
    if (meshRebuildTimers[chunkKey]) clearTimeout(meshRebuildTimers[chunkKey]);

    const debounceTime = get().isWorldReady ? 25 : 1000;

    meshRebuildTimers[chunkKey] = setTimeout(async () => {
      const chunkData = get().chunks[chunkKey];
      if (!chunkData) return;

      const targetRebuildId = chunkData.rebuildId || 0;

      const buffer = chunkData.buffer;

      const neighborBuffers = [];
      const [cxStr, czStr] = chunkKey.split(",");
      const cx = parseInt(cxStr, 10);
      const cz = parseInt(czStr, 10);

      const dirs = [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
        [-1, -1],
        [1, 1],
        [-1, 1],
        [1, -1],
      ];
      for (const [dx, dz] of dirs) {
        const key = `${cx + dx},${cz + dz}`;
        let nBuffer = null;
        if (get().chunks[key] && get().chunks[key].buffer) {
           nBuffer = get().chunks[key].buffer;
        } else if (get().pass1Cache && get().pass1Cache.has(key)) {
           nBuffer = get().pass1Cache.get(key).buffer;
        }
        if (nBuffer) {
          neighborBuffers.push({ cx: cx + dx, cz: cz + dz, buffer: nBuffer });
        }
      }

      const meshArrays = await chunkWorkerPool.rebuild(
        buffer,
        neighborBuffers,
        cx,
        cz,
        getSeed(),
      );
      // Worker may return null if it crashed
      if (!meshArrays) return;

      set((prev) => {
        delete meshRebuildTimers[chunkKey];
        const c = prev.chunks[chunkKey];
        // Discard stale worker results if the chunk was modified again during computation
        if (!c || (c.rebuildId || 0) !== targetRebuildId) {
            return prev;
        }

        const finalMeshArrays = { ...meshArrays };

        // PHYSICS BVH CACHING OPTIMIZATION:
        // If this chunk's blocks weren't modified (it was only rebuilt to propagate light),
        // its rebuildId hasn't changed since the last physics build.
        // We preserve the exact Float32Array reference so React Three Rapier completely skips
        // rebuilding the WASM BVH tree for this chunk, eliminating the lag spike!
        if (
          c.physicsRebuildId === (c.rebuildId || 0) &&
          c.meshArrays?.__physics
        ) {
          finalMeshArrays.__physics = { ...c.meshArrays.__physics, _isCached: true };
        }

        return {
          pendingMeshMounts: [...prev.pendingMeshMounts, { chunkKey, meshArrays: finalMeshArrays, rebuildId: targetRebuildId }],
          chunks: {
            ...prev.chunks,
            [chunkKey]: {
              ...c,
              // Wait for mountNextMesh to set meshArrays
            },
          },
        };
      });
    }, debounceTime); // Dynamic debounce to batch fast block breaking or prevent startup rebuild storm
  },

    loadChunkAsync: async (cx, cz, skipDB = false) => {
    const chunkKey = `${cx},${cz}`;
    if (get().chunks[chunkKey]) return "DECORATED";
    if (cx === 0 && cz === 0) console.log(`[LOAD CHUNK 0,0] Starting loadChunkAsync`);

    if (inFlightChunks.has(chunkKey)) {
      cancelledChunks.delete(chunkKey);
      return "PRISTINE";
    }

    inFlightChunks.add(chunkKey);
    cancelledChunks.delete(chunkKey);

    let chunkData = null;
    let chunkSeed = getSeed();

    try {
      if (cancelledChunks.has(chunkKey)) {
        inFlightChunks.delete(chunkKey);
        return "CANCELLED";
      }

      const useNetworkStore = getNetworkStore();
      if (useNetworkStore) {
        const networkState = useNetworkStore.getState();
        if (!networkState.isHost && networkState.connectionStatus === "connected") {
          const hostResponse = await networkState.requestChunkFromHost(chunkKey);
          if (cancelledChunks.has(chunkKey)) return "CANCELLED";
          if (hostResponse !== "PRISTINE") {
            chunkData = {
              buffer: new Uint32Array(hostResponse),
              isModified: true,
              rebuildId: 0,
            };
          }
        }
      }

      if (!chunkData && !skipDB) {
         chunkData = await loadChunkFromDB(chunkKey);
      }
      if (cancelledChunks.has(chunkKey)) return "CANCELLED";

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
        return "PRISTINE"; // Enter pass1Chunks and wait for neighbors!
      }

      // If NOT in DB/Network, generate Pass 1!
      const pass1Data = await chunkWorkerPool.generatePass1(cx, cz, chunkSeed);
      if (cancelledChunks.has(chunkKey)) {
         inFlightChunks.delete(chunkKey);
         return "CANCELLED";
      }
      
      pass1Cache.set(chunkKey, pass1Data);
      
      inFlightChunks.delete(chunkKey);
      cancelledChunks.delete(chunkKey);
      return "PRISTINE";
    } catch (err) {
      console.error(`[loadChunkAsync] FATAL ERROR loading chunk ${chunkKey}. Deleting corrupted save and forcing regeneration!`, err);
      // Aggressive DB Wipe for Corrupted Chunk
      try {
         const { del } = await import('idb-keyval');
         const prefix = sessionStorage.getItem('saveSlotId') || 'default';
         await del(`${prefix}_chunk_${chunkKey}`);
      } catch(e) {}
      
      inFlightChunks.delete(chunkKey);
      cancelledChunks.delete(chunkKey);
      
      // Return "CANCELLED" to let ChunkManager seamlessly queue it for loading again next frame!
      return "CANCELLED";
    }
  },

  loadChunkPass2Async: async (cx, cz) => {
    const chunkKey = `${cx},${cz}`;
    const pass1Data = pass1Cache.get(chunkKey);
    if (!pass1Data) return "CANCELLED";

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
            if (get().chunks[key] && get().chunks[key].buffer) {
               nBuffer = get().chunks[key].buffer;
            } else if (pass1Cache.has(key)) {
               nBuffer = pass1Cache.get(key).buffer;
            }
            if (nBuffer) {
              neighborBuffers.push({ cx: cx + dx, cz: cz + dz, buffer: nBuffer });
            }
          }
          
          chunkData = pass1Data.chunkData;
          chunkData.meshArrays = await chunkWorkerPool.rebuild(
            chunkData.buffer,
            neighborBuffers,
            cx,
            cz,
            chunkSeed
          );
          
      } else {
          chunkData = await chunkWorkerPool.generatePass2(cx, cz, pass1Data.buffer, pass1Data.getSurfaceHeightMap, chunkSeed);
          
          // CRITICAL FIX: The worker transferred an ArrayBuffer back. We MUST wrap it in a Uint32Array!
          chunkData.buffer = new Uint32Array(chunkData.buffer);
      }
      
      pass1Cache.delete(chunkKey);
      
      if (cancelledChunks.has(chunkKey)) {
          inFlightChunks.delete(chunkKey);
          return "CANCELLED";
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
          const tChunk = get().chunks[tKey];
          if (tChunk) {
              // 1. Target is already DECORATED (meshed and rendered)
              let modified = false;
              for (const b of blocks) {
                  const lx = ((b.x % 16) + 16) % 16;
                  const ly = b.y;
                  const lz = ((b.z % 16) + 16) % 16;
                  if (ly >= -64 && ly <= 255) {
                      const idx = ((ly + 64) * 256) + (lz * 16) + lx;
                      tChunk.buffer[idx] = (b.id & 0xff) | (100 << 8); // Health 100
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
                  const lx = ((b.x % 16) + 16) % 16;
                  const ly = b.y;
                  const lz = ((b.z % 16) + 16) % 16;
                  if (ly >= -64 && ly <= 255) {
                      const idx = ((ly + 64) * 256) + (lz * 16) + lx;
                      pData.buffer[idx] = (b.id & 0xff) | (100 << 8);
                  }
              }
          } else {
              // 3. Target hasn't started generating at all
              set((prev) => {
                  const pending = { ...prev.pendingDeltas };
                  if (!pending[tKey]) pending[tKey] = [];
                  for (const b of blocks) {
                      const lx = ((b.x % 16) + 16) % 16;
                      const ly = b.y;
                      const lz = ((b.z % 16) + 16) % 16;
                      if (ly >= -64 && ly <= 255) {
                         const idx = ((ly + 64) * 256) + (lz * 16) + lx;
                         pending[tKey].push(idx, (b.id & 0xff) | (100 << 8));
                      }
                  }
                  return { pendingDeltas: pending };
              });
          }
      }

      chunkData.rebuildId = 0;
      chunkData.physicsRebuildId = 0;

      const pending = get().pendingDeltas[chunkKey];
      if (pending) {
        for (let i = 0; i < pending.length; i += 2) {
          chunkData.buffer[pending[i]] = pending[i + 1];
        }
        chunkData.isModified = true;
        chunkData.rebuildId = (chunkData.rebuildId || 0) + 1;
        set((prev) => {
          const nextPending = { ...prev.pendingDeltas };
          delete nextPending[chunkKey];
          return { pendingDeltas: nextPending };
        });
        // CRITICAL FIX: Trigger a mesh rebuild to actually show the applied overflow blocks!
        get().requestMeshRebuild(chunkKey);
      }

      const meshArrays = chunkData.meshArrays;
      delete chunkData.meshArrays;

      set((prev) => ({ 
        chunks: { ...prev.chunks, [chunkKey]: chunkData },
        pendingMeshMounts: [...prev.pendingMeshMounts, { chunkKey, meshArrays }]
      }));
      
      inFlightChunks.delete(chunkKey);
      pass1Cache.delete(chunkKey);
      return "DECORATED";
    } catch (err) {
      console.error(`[loadChunkPass2Async] FATAL ERROR for chunk ${cx},${cz}:`, err);
      try {
         const { del } = await import('idb-keyval');
         const prefix = sessionStorage.getItem('saveSlotId') || 'default';
         await del(`${prefix}_chunk_${chunkKey}`);
      } catch(e) {}
      inFlightChunks.delete(chunkKey);
      cancelledChunks.delete(chunkKey);
      pass1Cache.delete(chunkKey);
      return false;
    }
  },

  cancelLoadChunk: (chunkKey) => {
    if (pass1Cache.has(chunkKey)) pass1Cache.delete(chunkKey);
    
    if (inFlightChunks.has(chunkKey)) {
      cancelledChunks.add(chunkKey);
      const [cxStr, czStr] = chunkKey.split(",");
      cancelLoadFromDB(chunkKey); // Immediately rip it out of the database queue!
      chunkWorkerPool.cancelGenerate(+cxStr, +czStr);
    }
  },

  unloadChunk: async (chunkKey) => {
    if (pass1Cache.has(chunkKey)) pass1Cache.delete(chunkKey);

    if (inFlightChunks.has(chunkKey)) {
      cancelledChunks.add(chunkKey);
      return;
    }

    if (meshRebuildTimers[chunkKey]) {
      clearTimeout(meshRebuildTimers[chunkKey]);
      delete meshRebuildTimers[chunkKey];
    }

    const chunkData = get().chunks[chunkKey];
    if (!chunkData) return;

    set((prev) => {
      const newChunks = { ...prev.chunks };
      delete newChunks[chunkKey];

      const newOverflow = prev.overflowChunks.filter(k => k !== chunkKey);

      // Remove flares that belong to this chunk so they don't become floating ghosts
      const [cxStr, czStr] = chunkKey.split(",");
      const cxNum = parseInt(cxStr, 10);
      const czNum = parseInt(czStr, 10);
      const newFlares = prev.placedFlares.filter((f) => {
        const fcx = Math.floor(f.pos[0] / 16);
        const fcz = Math.floor(f.pos[2] / 16);
        return !(fcx === cxNum && fcz === czNum);
      });

      return { chunks: newChunks, placedFlares: newFlares, overflowChunks: newOverflow };
    });

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
    const chunkData = state.chunks[chunkKey];
    if (!chunkData || !chunkData.buffer) return false;

    const lx = ((x % 16) + 16) % 16;
    const lz = ((z % 16) + 16) % 16;
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

    set((prev) => {
      const prevChunkData = prev.chunks[chunkKey] || {
        buffer: new Uint32Array(81920),
        isModified: false,
      };

      const newBuffer = new Uint32Array(prevChunkData.buffer);
      const lx = ((x % 16) + 16) % 16;
      const lz = ((z % 16) + 16) % 16;

      // We resolve tex to ID
      const texName = prev.texture;
      const texId = BlockIds[texName] || 1;

      if (currentTexId !== 0 && BlockKeyById[currentTexId] === "flare") {
        setTimeout(() => get().removeFlare(getBlockKey(x, y, z)), 0);
      }

      const health = BlockRegistry[texName]?.health ?? 100;
      const idx = getIndex(lx, ly, lz);
      setBlock(newBuffer, idx, texId, health, 0, 0);

      const rebuildId = (prevChunkData.rebuildId || 0) + 1;

      const useNetworkStore = getNetworkStore();
      if (useNetworkStore) {
        useNetworkStore
          .getState()
          .broadcastDelta(chunkKey, [idx, newBuffer[idx]]);
      }

      return {
        chunks: {
          ...prev.chunks,
          [chunkKey]: {
            ...prevChunkData,
            buffer: newBuffer,
            isModified: true,
            rebuildId,
          },
        },
      };
    });
    get().consumeActiveItem();
    rebuilds.forEach((ck) => get().requestMeshRebuild(ck));
    wakeFluidsAround(get, set, x, y, z);
    return true;
  },

  bakeCube: (key, pos) => {
    const state = get();
    const debrisBlock = state.debris.find((d) => d.key === key);
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

    const chunkData = state.chunks[chunkKey];
    if (!chunkData || !chunkData.buffer) {
      get().removeDebris(key);
      return;
    }

    const lx = ((Math.round(x) % 16) + 16) % 16;
    const lz = ((Math.round(z) % 16) + 16) % 16;
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

    set((prev) => {
      const prevChunkData = prev.chunks[chunkKey];
      const newBuffer = new Uint32Array(prevChunkData.buffer);

      const texId = BlockIds[debrisBlock.texture] || 1;
      const health = BlockRegistry[debrisBlock.texture]?.health ?? 100;
      const idx = getIndex(lx, ly, lz);

      setBlock(newBuffer, idx, texId, health, 0, 0);

      const rebuildId = (prevChunkData.rebuildId || 0) + 1;

      const useNetworkStore = getNetworkStore();
      if (useNetworkStore) {
        useNetworkStore
          .getState()
          .broadcastDelta(chunkKey, [idx, newBuffer[idx]]);
      }

      return {
        chunks: {
          ...prev.chunks,
          [chunkKey]: {
            ...prevChunkData,
            buffer: newBuffer,
            isModified: true,
            rebuildId,
          },
        },
        debris: prev.debris.filter((d) => d.key !== key),
      };
    });

    rebuilds.forEach((ck) => get().requestMeshRebuild(ck));
    wakeFluidsAround(get, set, Math.round(x), Math.round(y), Math.round(z));
  },

  removeCube: (x, y, z, causedByGravity = false) => {
    const chunkKey = getChunkKey(x, z);
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const ly = Math.floor(y); // Use floor: DDA returns integer block coords; Math.round(y-0.5) is wrong for negative Y
    if (ly < CHUNK_Y_MIN || ly > CHUNK_Y_MAX) return;

    const state = get();
    const chunkData = state.chunks[chunkKey];
    if (!chunkData || !chunkData.buffer) return;

    const lx = ((x % 16) + 16) % 16;
    const lz = ((z % 16) + 16) % 16;
    const val = chunkData.buffer[getIndex(lx, ly, lz)];
    if (val === 0) return; // Block is already air! Abort side effects to prevent multiple drops/lag.

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

    set((prev) => {
      const prevChunkData = prev.chunks[chunkKey];
      if (!prevChunkData) return {};

      const newBuffer = new Uint32Array(prevChunkData.buffer);
      const val = newBuffer[getIndex(lx, ly, lz)];
      if (val === 0) return {};

      const texId = getTextureId(val);
      const texName = BlockKeyById[texId] || "stone";

      if (texName === "flare") {
        setTimeout(() => get().removeFlare(getBlockKey(x, y, z)), 0);
      }

      const newChunks = { ...prev.chunks };
      let droppedItems = [...(prev.droppedItems || [])];

      const newDrops = [];
      const dropKey1 = uuidV4();
      newDrops.push({ key: dropKey1, pos: [x, y, z], texture: texName });

      droppedItems.push(newDrops[0]);
      if (droppedItems.length > 1000) droppedItems = droppedItems.slice(-1000);

      // FIX: Floating Grass (Block Update Cascades)
      const deltas = [];
      const idx = getIndex(lx, ly, lz);

      if (ly + 1 <= CHUNK_Y_MAX) {
        const aboveIdx = getIndex(lx, ly + 1, lz);
        const aboveVal = newBuffer[aboveIdx];
        if (aboveVal !== 0) {
          const aboveTexId = getTextureId(aboveVal);
          const aboveTexName = BlockKeyById[aboveTexId];
          if (BlockById[aboveTexId]?.isFlora || aboveTexName === "flare") {
            setBlock(newBuffer, aboveIdx, 0, 0, 0, 0);
            deltas.push(aboveIdx, 0);

            const dropKey2 = uuidV4();
            newDrops.push({
              key: dropKey2,
              pos: [x, y + 1, z],
              texture: aboveTexName,
            });
            droppedItems.push(newDrops[newDrops.length - 1]);

            if (droppedItems.length > 1000)
              droppedItems = droppedItems.slice(-1000);
            if (aboveTexName === "flare") {
              setTimeout(() => get().removeFlare(getBlockKey(x, y + 1, z)), 0);
            }
          }
        }
      }

      setBlock(newBuffer, idx, 0, 0, 0, 0);
      deltas.push(idx, 0);

      // BFS UNHIDE PROPAGATION:
      // The old code only cleared the hidden bit on 6 immediate neighbors.
      // Cave walls can be several blocks thick — inner layers keep isHidden=true
      // even when fully exposed to air, making them permanently invisible.
      // We BFS outward from the broken block, clearing hidden bits until we
      // reach a block that was already visible or exhaust depth 5.
      {
        const BFS_MAX_DEPTH = 5;
        const bfsQueue = []; // [gx, gy, gz, depth]
        const bfsDirs = [
          [1, 0, 0],
          [-1, 0, 0],
          [0, 1, 0],
          [0, -1, 0],
          [0, 0, 1],
          [0, 0, -1],
        ];
        // Seed: check all 6 neighbors of the broken block
        bfsDirs.forEach(([dx, dy, dz]) =>
          bfsQueue.push([x + dx, ly + dy, z + dz, 1]),
        );
        const bfsVisited = new Set([`${x},${ly},${z}`]); // don't re-visit the broken block

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
          const nlx = ((nx % 16) + 16) % 16;
          const nlz = ((nz % 16) + 16) % 16;

          let targetBuffer;
          let isMainChunk = nChunkKey === chunkKey;
          if (isMainChunk) {
            targetBuffer = newBuffer;
          } else {
            const nChunk = newChunks[nChunkKey] || prev.chunks[nChunkKey];
            if (!nChunk?.buffer) continue;
            // Copy-on-write: only allocate once per cross-chunk neighbor
            if (
              !newChunks[nChunkKey] ||
              newChunks[nChunkKey] === prev.chunks[nChunkKey]
            ) {
              newChunks[nChunkKey] = {
                ...prev.chunks[nChunkKey],
                buffer: new Uint32Array(prev.chunks[nChunkKey].buffer),
                isModified: true,
              };
            }
            targetBuffer = newChunks[nChunkKey].buffer;
          }

          const nIdx = getIndex(nlx, ny, nlz);
          const nVal = targetBuffer[nIdx];

          if (nVal === 0) {
            // Air — propagate through it (don't stop, but don't unhide air)
          } else if (getIsHidden(nVal)) {
            // Hidden solid block — unhide it and keep propagating
            targetBuffer[nIdx] = nVal & ~(1 << 21);
            if (isMainChunk) {
              deltas.push(nIdx, targetBuffer[nIdx]);
            } else {
              const useNetworkStore = getNetworkStore();
              if (useNetworkStore) {
                useNetworkStore
                  .getState()
                  .broadcastDelta(nChunkKey, [nIdx, targetBuffer[nIdx]]);
              }
            }
          } else {
            // Already-visible solid block — stop propagating in this direction
            continue;
          }

          // Propagate further if within depth limit
          if (depth < BFS_MAX_DEPTH) {
            bfsDirs.forEach(([dx, dy, dz]) =>
              bfsQueue.push([nx + dx, ny + dy, nz + dz, depth + 1]),
            );
          }
        }
      }

      const useNetworkStore = getNetworkStore();
      if (useNetworkStore) {
        useNetworkStore.getState().broadcastDelta(chunkKey, deltas);
        newDrops.forEach((drop) => {
          useNetworkStore.getState().broadcastEvent({
            type: "ENTITY_SPAWN_EVENT",
            entityType: "droppedItem",
            ...drop,
          });
        });
      }

      newChunks[chunkKey] = {
        ...prevChunkData,
        buffer: newBuffer,
        isModified: true,
        rebuildId: (prevChunkData.rebuildId || 0) + 1,
      };

      // NOTE: isHidden bits are propagated by the BFS unhide pass above — greedyMesh
      // reads them raw and does NOT re-evaluate them.

      return { chunks: newChunks, droppedItems };
    });
    rebuilds.forEach((ck) => get().requestMeshRebuild(ck));
    wakeFluidsAround(get, set, x, y, z);

    // -- Structural Physics Check --
    // Check the 6 adjacent blocks to see if they lost support
    if (!causedByGravity) {
      setTimeout(() => {
        const dirs = [
          [0, 1, 0],
          [0, -1, 0],
          [1, 0, 0],
          [-1, 0, 0],
          [0, 0, 1],
          [0, 0, -1],
        ];
        for (const [dx, dy, dz] of dirs) {
          const cluster = checkStructuralIntegrity(get, x + dx, y + dy, z + dz);
          if (cluster) {
            // Structure fell! Remove the blocks from the world and turn into physics debris
            const structureId = `fall_${x + dx}_${y + dy}_${z + dz}_${Date.now()}`;

            set((prev) => ({
              fallingStructures: [
                ...prev.fallingStructures,
                { id: structureId, blocks: cluster },
              ],
            }));

            // Remove the blocks from the voxel grid efficiently in bulk
            get().removeCubesBulk(cluster, true);
          }
        }
      }, 50); // Slight delay to allow current removal to finish
    }
  },

  removeCubesBulk: (blocks, causedByGravity = false) => {
    const rebuilds = new Set();
    const chunkDeltas = {};
    const useNetworkStore = getNetworkStore();

    set((prev) => {
      const newChunks = { ...prev.chunks };
      let droppedItems = [...(prev.droppedItems || [])];

      blocks.forEach((b) => {
        const { x, y, z } = b;
        const ly = Math.floor(y); // Use floor: block coords are integers; Math.round(y-0.5) is wrong for negative Y
        if (ly < CHUNK_Y_MIN || ly > CHUNK_Y_MAX) return;

        const lx = ((x % 16) + 16) % 16;
        const lz = ((z % 16) + 16) % 16;
        const cx = Math.floor(x / 16);
        const cz = Math.floor(z / 16);
        const chunkKey = `${cx},${cz}`;

        if (!newChunks[chunkKey] || !newChunks[chunkKey].buffer) return;

        if (newChunks[chunkKey] === prev.chunks[chunkKey]) {
          newChunks[chunkKey] = {
            ...prev.chunks[chunkKey],
            buffer: new Uint32Array(prev.chunks[chunkKey].buffer),
            isModified: true,
            rebuildId: (prev.chunks[chunkKey].rebuildId || 0) + 1,
          };
        }

        const newBuffer = newChunks[chunkKey].buffer;
        const idx = getIndex(lx, ly, lz);
        const val = newBuffer[idx];
        if (val === 0) return; // already air

        setBlock(newBuffer, idx, 0, 0, 0, 0);

        if (!chunkDeltas[chunkKey]) chunkDeltas[chunkKey] = [];
        chunkDeltas[chunkKey].push(idx, 0);
        rebuilds.add(chunkKey);

        const texId = getTextureId(val);
        const texName = BlockKeyById[texId];
        if (texName) {
          const dropKey = uuidV4();
          droppedItems.push({ key: dropKey, pos: [x, y, z], texture: texName });
          if (useNetworkStore) {
            useNetworkStore.getState().broadcastEvent({
              type: "ENTITY_SPAWN_EVENT",
              entityType: "droppedItem",
              key: dropKey,
              pos: [x, y, z],
              texture: texName,
            });
          }
        }
      });

      if (droppedItems.length > 1000) droppedItems = droppedItems.slice(-1000);
      return { chunks: newChunks, droppedItems };
    });

    rebuilds.forEach((ck) => get().requestMeshRebuild(ck));

    if (useNetworkStore) {
      for (const ck in chunkDeltas) {
        useNetworkStore.getState().broadcastDelta(ck, chunkDeltas[ck]);
      }
    }

    blocks.forEach((b) => wakeFluidsAround(get, set, b.x, b.y, b.z));
  },

  damageBlock: (x, y, z, amount) => {
    const chunkKey = getChunkKey(x, z);
    const ly = Math.floor(y); // Use floor: DDA returns integer block coords; Math.round(y-0.5) is wrong for negative Y
    if (ly < CHUNK_Y_MIN || ly > CHUNK_Y_MAX) return;

    const state = get();
    const chunkData = state.chunks[chunkKey];
    if (!chunkData) return;

    const lx = ((x % 16) + 16) % 16;
    const lz = ((z % 16) + 16) % 16;

    const val = chunkData.buffer[getIndex(lx, ly, lz)];
    if (val === 0) return;

    const health = (val >> 8) & 0x1ff;
    if (health === 511) return; // Infinity

    if (health - amount <= 0) {
      setTimeout(() => get().removeCube(x, y, z), 0);
    } else {
      set((prev) => {
        const newChunks = { ...prev.chunks };
        const newBuffer = new Uint32Array(chunkData.buffer);

        // rewrite health
        const newHealth = health - amount;
        const idx = getIndex(lx, ly, lz);
        newBuffer[idx] = (val & ~(0x1ff << 8)) | ((newHealth & 0x1ff) << 8);

        const useNetworkStore = getNetworkStore();
        if (useNetworkStore) {
          useNetworkStore
            .getState()
            .broadcastDelta(chunkKey, [idx, newBuffer[idx]]);
        }

        newChunks[chunkKey] = {
          ...chunkData,
          buffer: newBuffer,
          isModified: true,
        };
        return { chunks: newChunks };
      });
    }
  },

  triggerExplosion: (ex, ey, ez) => {
    const state = get();
    const radius = 4;
    const blocksToDestroy = [];

    const minX = Math.floor(ex - radius);
    const maxX = Math.ceil(ex + radius);
    const minY = Math.floor(ey - radius);
    const maxY = Math.ceil(ey + radius);
    const minZ = Math.floor(ez - radius);
    const maxZ = Math.ceil(ez + radius);

    for (let gx = minX; gx <= maxX; gx++) {
      for (
        let ly = Math.max(CHUNK_Y_MIN, minY);
        ly <= Math.min(CHUNK_Y_MAX, maxY);
        ly++
      ) {
        for (let gz = minZ; gz <= maxZ; gz++) {
          const cx = Math.floor(gx / 16);
          const cz = Math.floor(gz / 16);
          const chunkKey = `${cx},${cz}`;
          const chunk = state.chunks[chunkKey];

          if (!chunk || !chunk.buffer) continue;

          const lx = ((gx % 16) + 16) % 16;
          const lz = ((gz % 16) + 16) % 16;
          const idx = (ly - CHUNK_Y_MIN) * 256 + lz * 16 + lx;
          const val = chunk.buffer[idx];

          if (val === 0) continue;

          const texId = getTextureId(val);
          if (BlockKeyById[texId] === "bedrock") continue;

          const gy = ly + 0.5;
          const dist = Math.sqrt(
            Math.pow(gx - ex, 2) + Math.pow(gy - ey, 2) + Math.pow(gz - ez, 2),
          );
          if (dist <= radius) {
            blocksToDestroy.push({ x: gx, y: gy, z: gz });
          }
        }
      }
    }

    if (blocksToDestroy.length > 0) {
      state.removeCubesBulk(blocksToDestroy);
    }

    if (state.requestAreaDamage) {
      setTimeout(
        () => state.requestAreaDamage([ex, ey, ez], radius + 3, 1000),
        0,
      );
    }

    const blastRadius = 4;
    for (let dx = -blastRadius - 1; dx <= blastRadius + 1; dx++) {
      for (let dy = -blastRadius - 1; dy <= blastRadius + 1; dy++) {
        for (let dz = -blastRadius - 1; dz <= blastRadius + 1; dz++) {
          if (Math.sqrt(dx * dx + dy * dy + dz * dz) <= blastRadius + 1) {
            wakeFluidsAround(
              get,
              set,
              Math.floor(ex + dx),
              Math.floor(ey + dy) + 0.5,
              Math.floor(ez + dz),
            );
          }
        }
      }
    }
  },

  shatterStructure: (structureId, debrisBlocks) =>
    set((prev) => ({
      fallingStructures: prev.fallingStructures.filter(
        (s) => s.id !== structureId,
      ),
      debris: [...prev.debris, ...debrisBlocks],
    })),
  removeDebris: (debrisKey) =>
    set((prev) => ({
      debris: prev.debris.filter((d) => d.key !== debrisKey),
    })),

  saveWorld: async () => {
    if (get().isResetting) return;
    const chunks = get().chunks;
    const chunksToSave = [];

    // FAILSAFE 2: Self-Healing Global State Sweep
    // If any flare or dropped item is caught living inside an unloaded chunk coordinate,
    // it means the entity was orphaned due to a race condition. Delete it.
    set((prev) => {
      let changed = false;

      const validFlares = prev.placedFlares.filter((f) => {
        const cx = Math.floor(f.pos[0] / 16);
        const cz = Math.floor(f.pos[2] / 16);
        const chunkKey = `${cx},${cz}`;
        if (!prev.chunks[chunkKey]) {
          console.warn(
            `[FAILSAFE] Purged orphaned Flare at ${f.pos.join(",")} in unloaded chunk ${chunkKey}`,
          );
          return false;
        }
        return true;
      });

      const validDrops = prev.droppedItems.filter((d) => {
        const cx = Math.floor(d.pos[0] / 16);
        const cz = Math.floor(d.pos[2] / 16);
        const chunkKey = `${cx},${cz}`;
        if (!prev.chunks[chunkKey]) {
          console.warn(
            `[FAILSAFE] Purged orphaned Item at ${d.pos.join(",")} in unloaded chunk ${chunkKey}`,
          );
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
    });

    // 1. Gather all modified chunks and their CURRENT rebuildId
    for (const [key, data] of Object.entries(chunks)) {
      if (data.isModified) {
        chunksToSave.push({ key, data, savedRebuildId: data.rebuildId || 0 });
      }
    }

    if (chunksToSave.length === 0) return;

    // 2. Perform async IndexedDB saves
    await Promise.all(chunksToSave.map((c) => saveChunkToDB(c.key, c.data)));

    // Force WAL to flush immediately so that saveWorld is truly atomic and waits for completion
    await flushWAL();

    // 3. Clear isModified ONLY IF the chunk wasn't modified again during the save
    set((prev) => {
      const newChunks = { ...prev.chunks };
      let changed = false;
      for (const { key, savedRebuildId } of chunksToSave) {
        const current = newChunks[key];
        if (
          current &&
          current.isModified &&
          (current.rebuildId || 0) === savedRebuildId
        ) {
          newChunks[key] = { ...current, isModified: false };
          changed = true;
        }
      }
      return changed ? { chunks: newChunks } : prev;
    });
  },

});

// --- Telemetry Hook ---
setInterval(() => {
  if (window.__DEBUG_STATS__) {
    window.__DEBUG_STATS__.inFlightChunks = inFlightChunks.size;
    window.__DEBUG_STATS__.processingDeltas = processingNetworkDeltas.size;
  }
}, 200);
