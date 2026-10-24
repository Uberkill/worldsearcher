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

if (typeof window !== 'undefined') {
  const ds = ((window as any).__DEBUG_STATS__ = (window as any).__DEBUG_STATS__ || {});
  ds.fps = ds.fps ?? 0;
  ds.cpuTime = ds.cpuTime ?? 0;
  ds.gpuTime = ds.gpuTime ?? 0;
  ds.drawCalls = ds.drawCalls ?? 0;
  ds.triangles = ds.triangles ?? 0;
  ds.vertices = ds.vertices ?? 0;
  ds.textureBinds = ds.textureBinds ?? 0;
  ds.vboMemoryBytes = ds.vboMemoryBytes ?? 0;
  ds.totalChunks = ds.totalChunks ?? 0;
  ds.chunksRendered = ds.chunksRendered ?? 0;
  ds.totalEntities = ds.totalEntities ?? 0;
  ds.entitiesRendered = ds.entitiesRendered ?? 0;
  ds.bytesSent = ds.bytesSent ?? 0;
  ds.bytesReceived = ds.bytesReceived ?? 0;
  ds.ping = ds.ping ?? 0;
  ds.packetStats = ds.packetStats ?? { sent: {}, recv: {} };
  ds.errorLog = ds.errorLog ?? [];
}

const g = globalThis.__WORLD_SEARCH_GLOBALS__;
export const playerPosition = g.playerPosition;
export const playerLastSafePosition = g.playerLastSafePosition;
export const playerRotation = g.playerRotation;
export const ServerTickMetrics = g.ServerTickMetrics;
export const shipTransforms = g.shipTransforms;

if (typeof window !== 'undefined') {
  (window as any).playerPosition = g.playerPosition;
  (window as any).playerRotation = g.playerRotation;
  (window as any).shipTransforms = g.shipTransforms;
}
