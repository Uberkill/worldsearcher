import { createGarbageCollection } from './garbageCollection';
import { createFluidSimulation } from './fluidSimulation';
import { createMeshMounting } from './meshMounting';
import { createChunkOperations } from './chunkOperations';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const worldActions = (set: any, get: any): Record<string, any> => ({
  ...createGarbageCollection(set, get),
  ...createFluidSimulation(set, get),
  ...createMeshMounting(set, get),
  ...createChunkOperations(set, get)
});
export { pass1Cache } from './sharedState';
