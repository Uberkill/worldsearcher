import { getNetworkStore } from '../storeLinker';
import { useEnvironmentStore } from '../environmentSlice';
import { useFlareStore } from '../flareSlice';
import { useChunkStore } from '../chunkSlice';
import { useInventoryStore } from '../inventorySlice';
import { saveChunkToDB, loadChunkFromDB, clearDB, cancelLoadFromDB, flushWAL } from '../../utils/db';
import { BlockRegistry, BlockById, BlockKeyById, BlockIds } from '../../registry/BlockRegistry';
import { setBlock, getIndex, getTextureId, CHUNK_Y_MIN, CHUNK_Y_MAX, getIsHidden, getHealth } from '../../utils/chunkData';
import { chunkWorkerPool } from '../../utils/workerPool';
import { getSeed } from '../../worldSeed';
import { tickFluids, wakeFluidsAround } from '../../utils/fluidSystem';
import { EventBus } from '../../utils/EventBus';
import { pendingRenderKeys } from '../../utils/chunkRenderSignal';
import {
  inFlightChunks, inFlightPromises, cancelledChunks, processingNetworkDeltas,
  dirtyChunkSet, inFlightRebuildSet, pass1Cache, pendingUnloads, flareLightMap,
  bufferRecycleQueue, worldState, getChunkKey, getBlockKey
} from './sharedState';
import { getCombinedState } from './stranglerInterceptors';

// mirrors isWorldReady — set below once store is live

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
const flushBufferRecycleQueue = () => {
  if (bufferRecycleQueue.length > 0) {
    const validBuffers = new Set();
    for (let i = 0; i < bufferRecycleQueue.length; i++) {
      if (bufferRecycleQueue[i] && bufferRecycleQueue[i].byteLength > 0) {
        validBuffers.add(bufferRecycleQueue[i]);
      }
    }
    if (validBuffers.size > 0) {
      chunkWorkerPool.recycleBuffers(Array.from(validBuffers));
    }
    bufferRecycleQueue.length = 0;
  }
};

export const createMeshMounting = (rawSet, rawGet) => {
  const set = rawSet;
  const get = rawGet;
  return {
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
    } else {
      // Chunk exists! But if it's out of visual range, ChunkRenderer won't dispose it.
      // We must add the overwritten mesh arrays to the recycle queue!
      if (existingChunk.meshArrays) {
        const isVisual = useChunkStore.getState().overflowChunks.includes(nextMount.chunkKey);
        if (!isVisual || !existingChunk.meshArrays._isMounted) {
          for (const [key, group] of Object.entries(existingChunk.meshArrays)) {
            if (group && !group._isCached) toRecycle[`${nextMount.chunkKey}_${key}_old`] = group;
          }
        }
      }
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
    const existingChunkData = useChunkStore.getState().chunks[nextMount.chunkKey] || {};
    nextChunks[nextMount.chunkKey] = {
      ...existingChunkData,
      meshArrays: tightMeshArrays,
      rebuildId: nextMount.rebuildId ?? (existingChunkData.rebuildId || 0)
    };
    // Signal ChunkRenderer.useFrame: this chunk has fresh meshArrays
    pendingRenderKeys.add(nextMount.chunkKey);
  }
  const buffersToRecycle = [];
  for (const group of Object.values(toRecycle)) {
    if (!group) continue;
    if (Array.isArray(group)) {
      for (const sub of group) {
        ['pos', 'norm', 'color', 'uv', 'packed', 'matrices', 'heightmap'].forEach(attr => {
          if (sub[attr] && sub[attr].buffer && sub[attr].buffer.byteLength > 0) {
            buffersToRecycle.push(sub[attr].buffer);
          }
        });
        if (sub.idx && sub.idx.buffer && sub.idx.buffer.byteLength > 0) {
          buffersToRecycle.push(sub.idx.buffer);
        }
      }
    } else {
      ['pos', 'norm', 'color', 'uv', 'packed', 'matrices', 'heightmap'].forEach(attr => {
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
  };
};
