import { createGarbageCollection } from './garbageCollection';
import { createFluidSimulation } from './fluidSimulation';
import { createMeshMounting } from './meshMounting';
import { createChunkOperations } from './chunkOperations';

export const worldActions = (set: any, get: any): Record<string, any> => ({
  ...createGarbageCollection(set, get),
  ...createFluidSimulation(set, get),
  ...createMeshMounting(set, get),
  ...createChunkOperations(set, get)
});
export { pass1Cache } from './sharedState';
