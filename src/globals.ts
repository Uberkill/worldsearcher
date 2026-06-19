import { Vector3, Euler } from 'three';

interface WorldSearchGlobals {
  playerPosition: Vector3;
  playerLastSafePosition: Vector3;
  playerRotation: Euler;
  ServerTickMetrics: { tps: number; mspt: number };
  shipTransforms: Map<string, { position: Vector3; rotation: Euler }>;
}

declare global {
  var __WORLD_SEARCH_GLOBALS__: WorldSearchGlobals;
}

// Ensure globals survive React Fast Refresh (HMR)
if (!globalThis.__WORLD_SEARCH_GLOBALS__) {
  globalThis.__WORLD_SEARCH_GLOBALS__ = {
    playerPosition: new Vector3(0, 260, 0),
    playerLastSafePosition: new Vector3(0, 260, 0),
    playerRotation: new Euler(),
    ServerTickMetrics: { tps: 20, mspt: 0 },
    shipTransforms: new Map(),
  };
}

const g = globalThis.__WORLD_SEARCH_GLOBALS__;
export const playerPosition = g.playerPosition;
export const playerLastSafePosition = g.playerLastSafePosition;
export const playerRotation = g.playerRotation;
export const ServerTickMetrics = g.ServerTickMetrics;
export const shipTransforms = g.shipTransforms;
