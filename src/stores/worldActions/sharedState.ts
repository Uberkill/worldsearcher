// sharedState.js
export const inFlightChunks = new Set();
export const inFlightPromises = new Map();
export const cancelledChunks = new Set();
export const processingNetworkDeltas = new Set();
export const dirtyChunkSet = new Set();
export const inFlightRebuildSet = new Set();
export const pass1Cache = new Map();
export const pendingUnloads = new Map();
export const flareLightMap = new Map();
export const bufferRecycleQueue = [];

export const worldState = {
  rafRebuildHandle: null,
  worldReadyForRebuild: false,
  bufferRecycleTimer: null,
  currentRawGet: null
};

export const getChunkKey = (x: number, z: number): string => `${Math.floor(x / 16)},${Math.floor(z / 16)}`;
export const getBlockKey = (x: number, y: number, z: number): string => `${x},${y},${z}`;
