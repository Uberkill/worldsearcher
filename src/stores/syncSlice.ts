import { create } from 'zustand';

interface PlayerSync {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  name: string;
  ping: number;
}

interface Waypoint {
  id: string;
  x: number;
  y: number;
  z: number;
  color: string;
  timestamp: number;
}

interface SyncSlice {
  players: Record<string, PlayerSync>;  // { id: { x, y, z, rx, ry, rz, name, ping } }
  guestHealthMap: Record<string, number>;
  enemySyncBuffers: Record<string, any>; // TODO(ts-migration): type enemy sync buffers
  queuedDeltas: Record<string, any[]>;  // { [chunkKey]: [deltas] }
  waypoints: Waypoint[];               // { id, x, y, z, color, timestamp }
  worldEpoch: number;
}

export const useSyncStore = create<SyncSlice>((_set) => ({
  players: {},          // { id: { x, y, z, rx, ry, rz, name, ping } }
  guestHealthMap: {},
  enemySyncBuffers: {},
  queuedDeltas: {},     // { [chunkKey]: [deltas] }
  waypoints: [],        // { id, x, y, z, color, timestamp }
  worldEpoch: 0,
}));
