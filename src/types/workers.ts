// Chunk Worker Messages
export type ChunkWorkerRequest =
  | { type: 'INIT_REGISTRY'; solidBuffer: ArrayBuffer; fluidBuffer: ArrayBuffer; textureBuffer: ArrayBuffer; floraBuffer: ArrayBuffer; transparentBuffer: ArrayBuffer }
  | { type: 'generatePass1'; cx: number; cz: number; seed: number }
  | { type: 'generatePass2'; cx: number; cz: number; buffer: ArrayBuffer; getSurfaceHeightMap: ArrayBuffer; seed: number; neighborBuffers: Array<{cx: number, cz: number, buffer: Uint32Array}> }
  | { type: 'rebuild'; cx: number; cz: number; packedBuffer: Uint32Array; neighborBuffers: Array<{cx: number, cz: number, buffer: Uint32Array}>; removedLights?: Array<number> }
  | { type: 'RECYCLE'; buffers: ArrayBuffer[] }
  | { type: 'PING' };

export type ChunkWorkerResponse =
  | { type: 'PONG' }
  | { type: 'error'; message: string }
  | { type: 'CORRUPTED_SAVE'; chunkKey: string }
  | { type: 'generatePass1'; cx: number; cz: number; chunkData: any; recycledBuffers?: ArrayBuffer[] } // TODO: Type chunkData
  | { type: 'generatePass2'; cx: number; cz: number; buffer: ArrayBuffer; recycledBuffers?: ArrayBuffer[] }
  | { type: 'rebuild'; cx: number; cz: number; meshArrays: Record<string, Float32Array | Uint32Array>; lightOverflow: any; buffer: ArrayBuffer; recycledBuffers: ArrayBuffer[] };

// Database Worker Messages
export type DBWorkerRequest =
  | { type: 'COMPRESS'; id: number; payload: { buffer: ArrayBuffer | Uint32Array } }
  | { type: 'DECOMPRESS'; id: number; payload: { rleBuffer: ArrayBuffer | Uint32Array } }
  | { type: 'SAVE_CHUNK'; id: number; payload: { chunkKey: string; slotPrefix: string; buffer: ArrayBuffer | Uint32Array; seed: number } }
  | { type: 'LOAD_CHUNK'; id: number; payload: { chunkKey: string; slotPrefix: string; seed: number } }
  | { type: 'DELETE_CHUNK'; id: number; payload: { chunkKey: string; slotPrefix: string; seed: number } }
  | { type: 'CLEAR_DB'; id: number; payload: { slotId: string | number; isSlotPrefix?: boolean } }
  | { type: 'FLUSH_WAL'; id: number; payload?: any };

export type DBWorkerResponse = {
  id: number;
  result?: any;
  error?: string;
};

// Pathfinder Worker Messages
export type PathfinderRequest =
  | { type: 'REQUEST_PATH'; id: number; sequenceID: number; start: number[]; end: number[] }
  | { type: 'UPDATE_CHUNK'; chunkKey: string; buffer: Uint32Array }
  | { type: 'REMOVE_CHUNK'; chunkKey: string };

export type PathfinderResponse =
  | { type: 'PATH_RESULT'; id: number; sequenceID: number; pathBuffer: Float32Array; length: number };

// Ship Worker Messages
export type ShipWorkerRequest =
  | { type: 'FULL_BUFFER'; shipId: string; jobId: number; bounds: any; buffer: ArrayBuffer }
  | { type: 'VOXEL_UPDATE'; shipId: string; jobId: number; bounds: any; x: number; y: number; z: number; val: number }
  | { shipId: string; jobId: number; bounds: any; buffer?: Uint32Array }; // Legacy

export type ShipWorkerResponse = {
  shipId: string;
  volumes: any[];
  jobId: number;
  bounds: any;
};
