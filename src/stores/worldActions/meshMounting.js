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

// Module-level guard: prevents two concurrent async calls from double-generating
// the same chunk (race condition when the player moves fast).
import {
  inFlightChunks, inFlightPromises, cancelledChunks, processingNetworkDeltas,
  dirtyChunkSet, inFlightRebuildSet, pass1Cache, pendingUnloads, flareLightMap,
  bufferRecycleQueue, worldState, getChunkKey, getBlockKey
} from './sharedState';
import { getCombinedState } from './stranglerInterceptors';

let _executeRebuild = null;

const flushDirtyChunks = (get, rawGet, rawSet) => {
  worldState.rafRebuildHandle = null;
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
    if (_executeRebuild === null) {
      _executeRebuild = (key, g, rg, rs) => g()._executeRebuildInternal(key, g, rg, rs);
    }
    _executeRebuild(chunkKey, get, rawGet, rawSet);
  }
};

const scheduleRafFlush = (get, rawGet, rawSet) => {
  if (worldState.rafRebuildHandle !== null) return; // Already scheduled
  worldState.rafRebuildHandle = requestAnimationFrame(() => flushDirtyChunks(get, rawGet, rawSet));
};

export const createMeshMounting = (rawSet, rawGet) => {
const set = rawSet;
const get = rawGet;
return {
};
};
