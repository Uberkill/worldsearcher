import { PlayerState } from './player';
import { WorldEnvironment, ChunkData } from './world';

export interface RootState extends PlayerState, WorldEnvironment {
  chunks: Record<string, ChunkData>;
  // Additional slices will be merged here as they are typed
}
