import { createGarbageCollection } from './garbageCollection';
import { createFluidSimulation } from './fluidSimulation';
import { createMeshMounting } from './meshMounting';
import { createChunkOperations } from './chunkOperations';
import { getCombinedState } from './stranglerInterceptors';

export const worldActions = (rawSet, rawGet) => ({
  ...createGarbageCollection(rawSet, rawGet),
  ...createFluidSimulation(rawSet, rawGet),
  ...createMeshMounting(rawSet, rawGet),
  ...createChunkOperations(rawSet, rawGet)
});
export { pass1Cache } from './sharedState';
