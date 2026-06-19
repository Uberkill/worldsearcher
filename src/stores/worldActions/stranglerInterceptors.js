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
import { worldState } from './sharedState';

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

const getCombinedState = rawGet => {
  currentRawGet = rawGet;
  return staticWorldProxy;
};

export { getCombinedState };
