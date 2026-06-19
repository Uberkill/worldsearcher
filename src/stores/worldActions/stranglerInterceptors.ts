import { useChunkStore } from '../chunkSlice';
import { useInventoryStore } from '../inventorySlice';
import { useEnvironmentStore } from '../environmentSlice';
import { useFlareStore } from '../flareSlice';
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
