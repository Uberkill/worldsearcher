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

export const createFluidSimulation = (rawSet, rawGet) => {
  const set = rawSet;
  const get = rawGet;
  return {
tickFluids: () => tickFluids(rawGet, rawSet),
  };
};
