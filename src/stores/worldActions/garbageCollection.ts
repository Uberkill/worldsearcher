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

export const createGarbageCollection = (rawSet, rawGet) => {
  const set = rawSet;
  const get = rawGet;
  return {
unloadDistantChunks: playerPosition => {
  const renderDistance = get().renderDistance || 8;
  const chunks = useChunkStore.getState().chunks;
  const unmountDistance = renderDistance + 2;
  const unmountSq = unmountDistance * unmountDistance;
  const playerCx = Math.floor(playerPosition[0] / 16);
  const playerCz = Math.floor(playerPosition[2] / 16);
  for (const chunkKey of Object.keys(chunks)) {
    const [cxStr, czStr] = chunkKey.split(',');
    const dx = parseInt(cxStr, 10) - playerCx;
    const dz = parseInt(czStr, 10) - playerCz;
    if (dx * dx + dz * dz > unmountSq) {
      if (!pendingUnloads.has(chunkKey)) {
        pendingUnloads.set(chunkKey, Date.now());
      }
    } else {
      pendingUnloads.delete(chunkKey);
    }
  }
},
tickGarbageCollection: () => {
  const now = Date.now();
  for (const [chunkKey, timestamp] of pendingUnloads.entries()) {
    if (now - timestamp > 15000) {
      get().unloadChunk(chunkKey);
      pendingUnloads.delete(chunkKey);
    }
  }
},
queueBuffersForRecycling: buffers => {
  if (!buffers || buffers.length === 0) return;
  for (let i = 0; i < buffers.length; i++) {
    if (buffers[i] && buffers[i].byteLength > 0) {
      bufferRecycleQueue.push(buffers[i]);
    }
  }
  if (!worldState.bufferRecycleTimer) {
    worldState.bufferRecycleTimer = setTimeout(() => {
      flushBufferRecycleQueue();
      worldState.bufferRecycleTimer = null;
    }, 50);
  }
},
recycleChunkDataInternal: chunkData => {
  if (!chunkData) return;
  const buffersToRecycle = [];
  if (chunkData.buffer) {
    const ab = chunkData.buffer.buffer || chunkData.buffer;
    if (ab && ab.byteLength > 0) buffersToRecycle.push(ab);
  }
  if (chunkData.meshArrays) {
    for (const group of Object.values(chunkData.meshArrays)) {
      if (!group) continue;
      if (Array.isArray(group)) {
        for (const sub of group) {
          ['pos', 'norm', 'color', 'uv', 'packed', 'matrices', 'heightmap'].forEach(attr => {
            if (sub[attr] && sub[attr].buffer) {
              const ab = sub[attr].buffer.buffer || sub[attr].buffer;
              if (ab && ab.byteLength > 0) buffersToRecycle.push(ab);
            }
          });
          if (sub.idx && sub.idx.buffer) {
            const ab = sub.idx.buffer.buffer || sub.idx.buffer;
            if (ab && ab.byteLength > 0) buffersToRecycle.push(ab);
          }
        }
      } else {
        ['pos', 'norm', 'color', 'uv', 'packed', 'matrices', 'heightmap'].forEach(attr => {
          if (group[attr] && group[attr].buffer) {
            const ab = group[attr].buffer.buffer || group[attr].buffer;
            if (ab && ab.byteLength > 0) buffersToRecycle.push(ab);
          }
        });
        if (group.idx && group.idx.buffer) {
          const ab = group.idx.buffer.buffer || group.idx.buffer;
          if (ab && ab.byteLength > 0) buffersToRecycle.push(ab);
        }
      }
    }
  }
  if (buffersToRecycle.length > 0) {
    rawGet().queueBuffersForRecycling(buffersToRecycle);
  }
},
  };
};
