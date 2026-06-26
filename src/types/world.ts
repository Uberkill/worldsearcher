interface MeshGroup {
  pos?: { buffer: ArrayBuffer | ArrayBufferView };
  norm?: { buffer: ArrayBuffer | ArrayBufferView };
  color?: { buffer: ArrayBuffer | ArrayBufferView };
  uv?: { buffer: ArrayBuffer | ArrayBufferView };
  idx?: { buffer: ArrayBuffer | ArrayBufferView };
  packed?: { buffer: ArrayBuffer | ArrayBufferView };
  matrices?: { buffer: ArrayBuffer | ArrayBufferView };
  heightmap?: { buffer: ArrayBuffer | ArrayBufferView };
  _isCached?: boolean;
}

export interface ChunkMeshArrays {
  _isMounted?: boolean;
  __physics?: Array<{ pos: Float32Array; idx: Uint32Array }>;
  _physics?: ArrayBuffer | ArrayBufferView; // Legacy physics array (deprecation warning)
  __meta?: { heightmap?: Uint8Array; [key: string]: unknown };
  __flora?: { matrices: Float32Array; packed: Uint32Array; [key: string]: unknown };
  [key: string]: unknown;
}

export interface ChunkData {
  buffer: Uint32Array;
  isModified?: boolean;
  rebuildId?: number;
  physicsRebuildId?: number;
  meshArrays?: ChunkMeshArrays;
}

type ChunkKey = string; // format: "x,z"

export interface NeighborBuffer {
  cx: number;
  cz: number;
  buffer: Uint32Array;
}


export interface WorldEnvironment {
  worldTime: number;
  currentDay: number;
  isNightTime: boolean;
  isRaining: boolean;
  skyColor: string;
  fogDensity: number;
}
