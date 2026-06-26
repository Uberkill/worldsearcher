// @ts-nocheck
// pathfinderWorker.ts
// A* Pathfinding Worker for Voxel Environments
import type { PathfinderRequest } from '../types/workers';

const getChunkKey = (cx: number, cz: number) => `${cx},${cz}`;

// Binary Heap for A* Priority Queue
class MinHeap {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public heap: any[];
  constructor() {
    this.heap = [];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  push(node: any) {
    this.heap.push(node);
    this.bubbleUp(this.heap.length - 1);
  }
  pop() {
    const min = this.heap[0];
    const end = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = end;
      this.sinkDown(0);
    }
    return min;
  }
  isEmpty() {
    return this.heap.length === 0;
  }
  bubbleUp(n: number) {
    const element = this.heap[n];
    while (n > 0) {
      let parentN = Math.floor((n + 1) / 2) - 1;
      let parent = this.heap[parentN];
      if (element.fScore >= parent.fScore) break;
      this.heap[parentN] = element;
      this.heap[n] = parent;
      n = parentN;
    }
  }
  sinkDown(n: number) {
    const length = this.heap.length;
    const element = this.heap[n];
    while (true) {
      let child2N = (n + 1) * 2;
      let child1N = child2N - 1;
      let swap = null;
      if (child1N < length) {
        let child1 = this.heap[child1N];
        if (child1.fScore < element.fScore) swap = child1N;
      }
      if (child2N < length) {
        let child2 = this.heap[child2N];
        if (
          child2.fScore < (swap === null ? element.fScore : this.heap[child1N].fScore)
        ) {
          swap = child2N;
        }
      }
      if (swap === null) break;
      this.heap[n] = this.heap[swap];
      this.heap[swap] = element;
      n = swap;
    }
  }
}

// Map for quick closed-set lookups
const hashNode = (x: number, y: number, z: number) => `${x},${y},${z}`;

// Heuristic: 3D Euclidean Distance
const heuristic = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2 + (z1 - z2) ** 2);
};

const chunkCache = new Map<string, Uint32Array>();

self.onmessage = function (e: MessageEvent<PathfinderRequest>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = e.data as any; // Temporary cast to deal with union
  const type = data.type || 'REQUEST_PATH';

  if (type === 'UPDATE_CHUNK') {
    const { chunkKey, buffer } = data;
    chunkCache.set(chunkKey, buffer);
    return;
  }

  if (type === 'REMOVE_CHUNK') {
    const { chunkKey } = data;
    chunkCache.delete(chunkKey);
    return;
  }

  if (type !== 'REQUEST_PATH') return;

  const { id, sequenceID, start, end } = data;
  
  if (!start || !end) return;

  const startX = Math.floor(start[0]);
  const startY = Math.floor(start[1]);
  const startZ = Math.floor(start[2]);

  const endX = Math.floor(end[0]);
  const endY = Math.floor(end[1]);
  const endZ = Math.floor(end[2]);

  // Fast chunk data lookup using the worker-local chunk cache
  const isSolid = (wx: number, wy: number, wz: number) => {
    if (wy < -32 || wy > 255) return false;

    const cx = Math.floor(wx / 16);
    const cz = Math.floor(wz / 16);
    const chunkBuffer = chunkCache.get(getChunkKey(cx, cz));

    if (!chunkBuffer) return true; // Unloaded chunk = solid boundary

    const lx = ((wx % 16) + 16) % 16;
    const lz = ((wz % 16) + 16) % 16;
    const ly = wy + 32; // Chunk index offset (Y_MIN is -32)

    const blockIndex = ly * 256 + lz * 16 + lx;
    const blockVal = chunkBuffer[blockIndex];

    return blockVal !== undefined && (blockVal & 0xFF) > 0;
  };

  // 26-way neighbors (3D)
  const neighbors: [number, number, number][] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx !== 0 || dy !== 0 || dz !== 0) neighbors.push([dx, dy, dz]);
      }
    }
  }

  const openSet = new MinHeap();
  const closedSet = new Set<string>();
  const cameFrom = new Map();
  const gScore = new Map();

  const startHash = hashNode(startX, startY, startZ);
  gScore.set(startHash, 0);
  
  openSet.push({
    x: startX,
    y: startY,
    z: startZ,
    fScore: heuristic(startX, startY, startZ, endX, endY, endZ),
  });

  let nodesEvaluated = 0;
  const MAX_NODES = 2000; // Strict limit to prevent "Pit of Despair" hangs
  let closestNode = { x: startX, y: startY, z: startZ };
  let minH = Infinity;

  while (!openSet.isEmpty()) {
    const current = openSet.pop();
    const currentHash = hashNode(current.x, current.y, current.z);
    
    if (closedSet.has(currentHash)) continue;
    closedSet.add(currentHash);

    // Goal reached
    if (current.x === endX && current.y === endY && current.z === endZ) {
      closestNode = current;
      break;
    }

    nodesEvaluated++;
    if (nodesEvaluated > MAX_NODES) {
      break; // Abort and return partial path to closest node
    }

    const currentG = gScore.get(currentHash);

    for (let i = 0; i < neighbors.length; i++) {
      const [dx, dy, dz] = neighbors[i];
      const nx = current.x + dx;
      const ny = current.y + dy;
      const nz = current.z + dz;

      // Distance limit to prevent infinite searches
      if (Math.abs(nx - startX) > 64 || Math.abs(nz - startZ) > 64) continue;

      if (isSolid(nx, ny, nz)) continue;
      
      // Prevent diagonal clipping through solid blocks
      if (dx !== 0 && dz !== 0) {
        if (isSolid(current.x + dx, current.y, current.z) && isSolid(current.x, current.y, current.z + dz)) continue;
      }

      // Check headroom (2 blocks high)
      if (isSolid(nx, ny + 1, nz)) continue;

      // Cost calculation
      let stepCost = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dy > 0) stepCost += 2.0; // Jump penalty to prefer walking
      if (dy < 0) stepCost += 0.5; // Fall preference

      const tentativeG = currentG + stepCost;
      const nHash = hashNode(nx, ny, nz);

      if (!gScore.has(nHash) || tentativeG < gScore.get(nHash)) {
        cameFrom.set(nHash, current);
        gScore.set(nHash, tentativeG);
        
        const h = heuristic(nx, ny, nz, endX, endY, endZ);
        if (h < minH) {
          minH = h;
          closestNode = { x: nx, y: ny, z: nz };
        }

        openSet.push({
          x: nx,
          y: ny,
          z: nz,
          fScore: tentativeG + h,
        });
      }
    }
  }

  // Reconstruct path
  const path = [];
  let curr = closestNode;
  while (curr) {
    path.push(curr);
    curr = cameFrom.get(hashNode(curr.x, curr.y, curr.z));
  }
  path.reverse(); // Start to End

  // Convert to Transferable Float32Array (Memory Leak fix)
  // Format: [x1, y1, z1, x2, y2, z2, ...]
  const pathBuffer = new Float32Array(path.length * 3);
  for (let i = 0; i < path.length; i++) {
    pathBuffer[i * 3] = path[i].x + 0.5; // Center of voxel
    pathBuffer[i * 3 + 1] = path[i].y;   // Bottom of voxel
    pathBuffer[i * 3 + 2] = path[i].z + 0.5;
  }

  self.postMessage(
    {
      type: 'PATH_RESULT',
      id,
      sequenceID,
      pathBuffer,
      length: path.length,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [pathBuffer.buffer] as any[] // Transfer ownership! Zero GC allocation!
  );
};
