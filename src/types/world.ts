export interface MeshGroup {
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
  __physics?: ArrayBuffer | ArrayBufferView;
  _physics?: ArrayBuffer | ArrayBufferView;
  __meta?: ArrayBuffer | ArrayBufferView;
  __flora?: ArrayBuffer | ArrayBufferView;
  [key: string]: MeshGroup | MeshGroup[] | ArrayBuffer | ArrayBufferView | boolean | undefined;
}

export interface ChunkData {
  buffer: Uint32Array;
  isModified?: boolean;
  rebuildId?: number;
  meshArrays?: ChunkMeshArrays;
}

export type ChunkKey = string; // format: "x,z"

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
