import { create } from 'zustand';

export const useSyncStore = create((_set) => ({
  players: {}, // { id: { x, y, z, rx, ry, rz, name, ping } }
  guestHealthMap: {}, 
  enemySyncBuffers: {},
  queuedDeltas: {}, // { [chunkKey]: [deltas] }
  waypoints: [], // { id, x, y, z, color, timestamp }
}));
