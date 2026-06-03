import { getIndex, getTextureId, CHUNK_Y_MIN, CHUNK_Y_MAX } from './chunkData';
import { BlockKeyById, BlockRegistry } from '../registry/BlockRegistry';

const MAX_SEARCH_DEPTH = 15; // Max distance a block can be from the ground before it falls

export const checkStructuralIntegrity = (get, sx, sy, sz) => {
  if (sy <= CHUNK_Y_MIN) return null; // Can't fall if already at bedrock

  const state = get();
  
  // Helper to read voxel efficiently
  const getBlockTex = (gx, gy, gz) => {
    if (gy < CHUNK_Y_MIN || gy > CHUNK_Y_MAX) return null;
    const cx = Math.floor(gx / 16);
    const cz = Math.floor(gz / 16);
    const chunk = state.chunks[`${cx},${cz}`];
    if (!chunk || !chunk.buffer) return null;
    
    const lx = (gx % 16 + 16) % 16;
    const lz = (gz % 16 + 16) % 16;
    const val = chunk.buffer[getIndex(lx, gy, lz)];
    if (val === 0) return null;
    
    const texName = BlockKeyById[getTextureId(val)];
    if (!texName) return null;
    return texName;
  };

  // Only check solid blocks
  const tex = getBlockTex(sx, sy, sz);
  if (!tex || !BlockRegistry[tex] || BlockRegistry[tex].isFlora || BlockRegistry[tex].isLiquid) return null;
  if (BlockRegistry[tex].isPassable) return null;

  // BFS Queue
  const queue = [{ x: sx, y: sy, z: sz, depth: 0 }];
  const visited = new Set([`${sx},${sy},${sz}`]);
  const cluster = [];
  
  let isAnchored = false;

  const neighbors = [[0,-1,0], [1,0,0], [-1,0,0], [0,0,1], [0,0,-1], [0,1,0]];

  while (queue.length > 0) {
    const { x, y, z, depth } = queue.shift();
    cluster.push({ x, y, z, texture: getBlockTex(x, y, z) });

    if (depth >= MAX_SEARCH_DEPTH) {
      isAnchored = true; // Assume anchored if it stretches beyond max depth (e.g. a large mountain)
      break;
    }

    // If we hit bedrock or a natural ground level (e.g. Y <= 0), consider it anchored
    // For a more robust check, we assume anything below Y=0 is ground
    if (y <= 0) {
      isAnchored = true;
      break;
    }

    for (const [dx, dy, dz] of neighbors) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      const key = `${nx},${ny},${nz}`;

      if (!visited.has(key)) {
        visited.add(key);
        const nTex = getBlockTex(nx, ny, nz);
        
        // If the neighbor is a solid block, it can transmit support
        if (nTex && BlockRegistry[nTex] && !BlockRegistry[nTex].isFlora && !BlockRegistry[nTex].isLiquid && !BlockRegistry[nTex].isPassable) {
          queue.push({ x: nx, y: ny, z: nz, depth: depth + 1 });
        }
      }
    }
  }

  if (isAnchored) {
    return null; // Structure is safe
  }

  return cluster; // Structure falls
};
