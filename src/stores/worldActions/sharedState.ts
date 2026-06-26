// sharedState.js
export const inFlightChunks = new Set<string>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const inFlightPromises = new Map<string, Promise<any>>();
export const cancelledChunks = new Set<string>();
export const processingNetworkDeltas = new Set<string>();
export const dirtyChunkSet = new Set<string>();
export const inFlightRebuildSet = new Set<string>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const pass1Cache = new Map<string, any>();
export const pendingUnloads = new Map<string, number>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const flareLightMap = new Map<string, any>();
export const bufferRecycleQueue: ArrayBuffer[] = [];
export const pendingDeltas = new Map<string, number[]>();

export const worldState = {
  rafRebuildHandle: null as number | null,
  worldReadyForRebuild: false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bufferRecycleTimer: null as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  currentRawGet: null as any
};

export const getChunkKey = (x: number, z: number): string => `${Math.floor(x / 16)},${Math.floor(z / 16)}`;
export const getBlockKey = (x: number, y: number, z: number): string => `${x},${y},${z}`;
