// pathfinderWorker.js
// Calculates a 3D Vector Flow Field (Dijkstra Map) over a Voxel Grid

const getChunkKey = (cx, cz) => `${cx},${cz}`;

// A simple queue for BFS to avoid Garbage Collection stutter
class FixedQueue {
  constructor(size) {
    this.data = new Int32Array(size * 3);
    this.head = 0;
    this.tail = 0;
  }
  push(x, y, z) {
    this.data[this.tail * 3] = x;
    this.data[this.tail * 3 + 1] = y;
    this.data[this.tail * 3 + 2] = z;
    this.tail++;
  }
  shift() {
    const h = this.head;
    this.head++;
    return [this.data[h * 3], this.data[h * 3 + 1], this.data[h * 3 + 2]];
  }
  isEmpty() {
    return this.head === this.tail;
  }
}

let recycledBuffer = null;

self.onmessage = function (e) {
  if (e.data.recycleBuffer) {
     recycledBuffer = e.data.recycleBuffer;
     return;
  }

  const { origin, radius, chunks } = e.data;
  const startTime = performance.now();

  const originX = Math.floor(origin[0]);
  const originY = Math.floor(origin[1]);
  const originZ = Math.floor(origin[2]);

  const width = radius * 2 + 1;
  const height = radius * 2 + 1;
  const depth = radius * 2 + 1;
  const totalVoxels = width * height * depth;

  // Cost map: 0 = goal, Infinity = unreached, >0 = distance
  const costMap = new Float32Array(totalVoxels);
  costMap.fill(Infinity);

  const getLocalIndex = (lx, ly, lz) => ly * width * depth + lz * width + lx;

  // Fast chunk data lookup
  const isSolid = (wx, wy, wz) => {
    if (wy < -64 || wy > 255) return false;
    
    const cx = Math.floor(wx / 16);
    const cz = Math.floor(wz / 16);
    const chunkBuffer = chunks[getChunkKey(cx, cz)];
    
    if (!chunkBuffer) return true; // Unloaded chunk = solid boundary
    
    const lx = (wx % 16 + 16) % 16;
    const lz = (wz % 16 + 16) % 16;
    const ly = wy + 64; // Chunk index offset
    
    const blockIndex = ly * 256 + lz * 16 + lx;
    const blockVal = chunkBuffer[blockIndex];
    
    // Block Value 0 = Air, >0 = Solid. (Ignoring specific liquid logic for now, water slows you down but isn't solid)
    return blockVal > 0;
  };

  // 1. Dijkstra BFS Flood-Fill
  const queue = new FixedQueue(totalVoxels);
  queue.push(originX, originY, originZ);
  
  const startIndex = getLocalIndex(radius, radius, radius);
  costMap[startIndex] = 0;

  // 26-way neighbors (3D)
  const neighbors = [];
  for(let dx = -1; dx <= 1; dx++) {
     for(let dy = -1; dy <= 1; dy++) {
        for(let dz = -1; dz <= 1; dz++) {
           if (dx !== 0 || dy !== 0 || dz !== 0) neighbors.push([dx, dy, dz]);
        }
     }
  }

  while (!queue.isEmpty()) {
    const [wx, wy, wz] = queue.shift();
    
    const lx = wx - (originX - radius);
    const ly = wy - (originY - radius);
    const lz = wz - (originZ - radius);
    
    const currentIndex = getLocalIndex(lx, ly, lz);
    const currentCost = costMap[currentIndex];

    // Orthogonal neighbors first, diagonal second (for basic A* heuristic weight)
    for (let i = 0; i < neighbors.length; i++) {
       const [dx, dy, dz] = neighbors[i];
       
       const nx = lx + dx;
       const ny = ly + dy;
       const nz = lz + dz;
       
       if (nx < 0 || ny < 0 || nz < 0 || nx >= width || ny >= height || nz >= depth) continue;
       
       const nWorldX = wx + dx;
       const nWorldY = wy + dy;
       const nWorldZ = wz + dz;
       
       if (isSolid(nWorldX, nWorldY, nWorldZ)) continue;
       
       // Allow stepping up 1 block if there is headroom
       if (dy === 1 && isSolid(wx, wy + 1, wz) && isSolid(wx, wy + 2, wz)) continue;
       
       // Calculate weight (1.0 for straight, 1.414 for diagonal, 1.732 for 3D diag)
       const weight = Math.sqrt(dx*dx + dy*dy + dz*dz);
       const newCost = currentCost + weight;
       
       const nextIndex = getLocalIndex(nx, ny, nz);
       if (newCost < costMap[nextIndex]) {
          costMap[nextIndex] = newCost;
          queue.push(nWorldX, nWorldY, nWorldZ);
       }
    }
  }

  // 2. Generate Vector Flow Field (Gradients)
  // 3 floats (XYZ) per voxel
  const vectorField = recycledBuffer ? new Float32Array(recycledBuffer) : new Float32Array(totalVoxels * 3);
  recycledBuffer = null;

  for (let ly = 0; ly < height; ly++) {
    for (let lz = 0; lz < depth; lz++) {
      for (let lx = 0; lx < width; lx++) {
        const i = getLocalIndex(lx, ly, lz);
        if (costMap[i] === Infinity) continue; // Unreachable

        let bestCost = costMap[i];
        let bestDir = [0, 0, 0];

        for (let j = 0; j < neighbors.length; j++) {
           const [dx, dy, dz] = neighbors[j];
           const nx = lx + dx;
           const ny = ly + dy;
           const nz = lz + dz;
           
           if (nx < 0 || ny < 0 || nz < 0 || nx >= width || ny >= height || nz >= depth) continue;
           
           const neighborCost = costMap[getLocalIndex(nx, ny, nz)];
           if (neighborCost < bestCost) {
              bestCost = neighborCost;
              bestDir = [dx, dy, dz];
           }
        }
        
        // Normalize the best direction vector
        const mag = Math.sqrt(bestDir[0]*bestDir[0] + bestDir[1]*bestDir[1] + bestDir[2]*bestDir[2]);
        if (mag > 0) {
           vectorField[i * 3] = bestDir[0] / mag;
           vectorField[i * 3 + 1] = bestDir[1] / mag;
           vectorField[i * 3 + 2] = bestDir[2] / mag;
        }
      }
    }
  }

  const duration = performance.now() - startTime;
  console.log(`[Pathfinder] Flow Field calculated in ${duration.toFixed(2)}ms.`);

  // Pass ownership of the heavy ArrayBuffer directly to main thread (0ms copy)
  self.postMessage(
    { 
       vectorField,
       origin: [originX, originY, originZ],
       radius,
       width, height, depth
    }, 
    [vectorField.buffer]
  );
};
