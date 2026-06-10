import { Vector3, Euler } from 'three';

// Ensure globals survive React Fast Refresh (HMR)
if (!globalThis.__WORLD_SEARCH_GLOBALS__) {
  globalThis.__WORLD_SEARCH_GLOBALS__ = {
    playerPosition: new Vector3(0, 260, 0),
    playerLastSafePosition: new Vector3(0, 260, 0),
    playerRotation: new Euler(),
    ServerTickMetrics: { tps: 20, mspt: 0 },
    lasers: [],
    visualProjectiles: []
  };
}

const g = globalThis.__WORLD_SEARCH_GLOBALS__;
export const playerPosition = g.playerPosition;
export const playerLastSafePosition = g.playerLastSafePosition;
export const playerRotation = g.playerRotation;
export const ServerTickMetrics = g.ServerTickMetrics;

export const getLasers = () => g.lasers;
export const addLaser = (start, end) => {
  const id = Date.now() + Math.random();
  g.lasers.push({ id, start, end });
  setTimeout(() => {
    g.lasers = g.lasers.filter((l) => l.id !== id);
  }, 150);
};

export const getVisualProjectiles = () => g.visualProjectiles;
export const spawnVisualProjectile = (data) => {
  const p = {
    id: data.id,
    pos: [...data.origin],
    vel: [...data.velocity],
    createdAt: performance.now(),
  };
  g.visualProjectiles.push(p);
};
export const destroyVisualProjectile = (id) => {
  g.visualProjectiles = g.visualProjectiles.filter((p) => p.id !== id);
};

export const clearGlobals = () => {
  g.playerPosition.set(0, 260, 0);
  g.playerLastSafePosition.set(0, 260, 0);
  g.playerRotation.set(0, 0, 0);
  g.lasers = [];
  g.visualProjectiles = [];
};
