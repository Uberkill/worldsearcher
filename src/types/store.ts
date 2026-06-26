import { PlayerState } from './player';
import { WorldEnvironment, ChunkData } from './world';

interface ChunkSlice {
  chunks: Record<string, ChunkData>;
  pendingMeshMounts: any[];
  overflowChunks: any[];
  activePhysicsChunks: any[];
}

interface InventorySlice {
  chests: Record<string, any>;
  droppedItems: Record<string, any>;
  tombstones: Record<string, any>;
  debris: any[];
  fallingStructures: any[];
}

interface FlareSlice {
  placedFlares: Record<string, any>;
}

export interface ChunkOperationsSlice {
  removeCube: (x: number, y: number, z: number, causedByGravity?: boolean, initiatedByPlayerId?: string | null) => void;
  removeCubesBulk: (blocks: any[], causedByGravity?: boolean, initiatedByPlayerId?: string | null) => void;
  damageBlocksBulk: (blocksData: any[]) => void;
  damageBlock: (x: number, y: number, z: number, amount: number, naturalOnly?: boolean) => void;
  requestMeshRebuild: (chunkKey: string) => void;
}

export interface RootState extends PlayerState, WorldEnvironment, ChunkSlice, InventorySlice, FlareSlice, ChunkOperationsSlice {
  isWorldReady: boolean;
  hasLoadedState: boolean;
  isDead: boolean;
  playerPosition: any;
  tickFluids?: () => void;
  unloadDistantChunks?: (pos: any) => void;
  tickGarbageCollection?: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}
