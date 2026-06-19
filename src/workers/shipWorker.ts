import type { ShipWorkerRequest, ShipWorkerResponse } from '../types/workers';

const SHIP_SIZE = 32;
const SHIP_CENTER = Math.floor(SHIP_SIZE / 2);

const visited = new Uint8Array(SHIP_SIZE * SHIP_SIZE * SHIP_SIZE);
const getIdx = (x: number, y: number, z: number) => y * (SHIP_SIZE * SHIP_SIZE) + z * SHIP_SIZE + x;

// Map to hold persistent buffers for N ships
const internalBuffers = new Map<string, Uint32Array>();

// Debounce map for meshing
const meshTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

const runMeshing = (shipId: string, buffer: Uint32Array, bounds: any, jobId: number) => {
  visited.fill(0);
  const volumes = [];
  const { startX, startY, startZ, endX, endY, endZ } = bounds;
  
  // Greedy Meshing Algorithm (X -> Z -> Y)
  for (let y = startY; y < endY; y++) {
     for (let z = startZ; z < endZ; z++) {
        for (let x = startX; x < endX; x++) {
           const idx = getIdx(x, y, z);
           if (visited[idx]) continue;
           
           const val = buffer[idx];
           if ((val & 0xFF) === 0) continue; // Skip air
           
           // Expand along X
           let w = 1;
           while (x + w < endX && (buffer[getIdx(x + w, y, z)] & 0xFF) !== 0 && !visited[getIdx(x + w, y, z)]) {
              w++;
           }
           
           // Expand along Z
           let d = 1;
           let canExtendZ = true;
           while (z + d < endZ && canExtendZ) {
              for (let i = 0; i < w; i++) {
                 if ((buffer[getIdx(x + i, y, z + d)] & 0xFF) === 0 || visited[getIdx(x + i, y, z + d)]) {
                    canExtendZ = false;
                    break;
                 }
              }
              if (canExtendZ) d++;
           }
           
           // Expand along Y
           let h = 1;
           let canExtendY = true;
           while (y + h < endY && canExtendY) {
              for (let j = 0; j < d; j++) {
                 for (let i = 0; i < w; i++) {
                    if ((buffer[getIdx(x + i, y + h, z + j)] & 0xFF) === 0 || visited[getIdx(x + i, y + h, z + j)]) {
                       canExtendY = false;
                       break;
                    }
                 }
                 if (!canExtendY) break;
              }
              if (canExtendY) h++;
           }
           
           // Mark volume as visited
           for (let k = 0; k < h; k++) {
              for (let j = 0; j < d; j++) {
                 for (let i = 0; i < w; i++) {
                    visited[getIdx(x + i, y + k, z + j)] = 1;
                 }
              }
           }
           
           // Calculate physics center and half-extents
           const cx = (x - SHIP_CENTER) + (w - 1) / 2;
           const cy = (y - SHIP_CENTER) + (h - 1) / 2;
           const cz = (z - SHIP_CENTER) + (d - 1) / 2;
           
           volumes.push([
              [cx, cy, cz],           // Position
              [w / 2, h / 2, d / 2]   // Half-extents for Rapier CuboidCollider
           ]);
        }
     }
  }
  
  self.postMessage({ shipId, volumes, jobId, bounds });
};

self.onmessage = function(e: MessageEvent<ShipWorkerRequest>) {
  const payload = e.data as any;
  const shipId = payload.shipId || 'default';
  const jobId = payload.jobId || 0;
  const bounds = payload.bounds || { startX: 0, startY: 0, startZ: 0, endX: 32, endY: 32, endZ: 32 };

  if (payload.type === 'FULL_BUFFER') {
      const buffer = new Uint32Array(payload.buffer); // Copy from transferable
      internalBuffers.set(shipId, buffer);
      
      // Cancel pending debounce for this ship
      if (meshTimeouts.has(shipId)) clearTimeout(meshTimeouts.get(shipId));
      
      // Run meshing instantly for full buffer
      runMeshing(shipId, buffer, bounds, jobId);
  } else if (payload.type === 'VOXEL_UPDATE') {
      let buffer = internalBuffers.get(shipId);
      if (!buffer) {
          buffer = new Uint32Array(32768);
          internalBuffers.set(shipId, buffer);
      }
      
      const idx = getIdx(payload.x, payload.y, payload.z);
      buffer[idx] = payload.val;
      
      // Debounce meshing for delta updates (50ms)
      if (meshTimeouts.has(shipId)) clearTimeout(meshTimeouts.get(shipId));
      meshTimeouts.set(shipId, setTimeout(() => {
          runMeshing(shipId, buffer, bounds, jobId);
      }, 50));
  } else {
      // Legacy fallback
      const buffer = payload.buffer || payload;
      if (!buffer || buffer.length !== 32768) {
          self.postMessage({ shipId, volumes: [], jobId, bounds });
          return;
      }
      runMeshing(shipId, buffer, bounds, jobId);
  }
};
