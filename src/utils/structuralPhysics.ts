// @ts-nocheck
import { getIndex, getTextureId, CHUNK_Y_MIN, CHUNK_Y_MAX } from './chunkData';
import { BlockKeyById, BlockRegistry } from '../registry/BlockRegistry';
import { useChunkStore } from '../stores/chunkSlice';

const MAX_SEARCH_DEPTH = 15; // Max distance a block can be from the ground before it falls

export const checkStructuralIntegrity = (get, sx, sy, sz) => {
  if (sy <= CHUNK_Y_MIN) return null; // Can't fall if already at bedrock

  // state not needed here

  // Helper to read voxel efficiently
  const getBlockTex = (gx, gy, gz) => {
    if (gy < CHUNK_Y_MIN || gy > CHUNK_Y_MAX) return null;
    const cx = Math.floor(gx / 16);
    const cz = Math.floor(gz / 16);
    const chunk = useChunkStore.getState().chunks[`${cx},${cz}`];
    if (!chunk || !chunk.buffer) return 'UNLOADED';

    const lx = ((gx % 16) + 16) % 16;
    const lz = ((gz % 16) + 16) % 16;
    const val = chunk.buffer[getIndex(lx, gy, lz)];
    if (val === 0) return null;

    const texName = BlockKeyById[getTextureId(val)];
    if (!texName) return null;
    return texName;
  };

  // Only check solid blocks
  const tex = getBlockTex(sx, sy, sz);
  if (tex === 'UNLOADED') return null; // Can't evaluate if the source block itself is in an unloaded chunk
  if (
    !tex ||
    !BlockRegistry[tex] ||
    BlockRegistry[tex].isFlora ||
    BlockRegistry[tex].isLiquid
  )
    return null;
  if (BlockRegistry[tex].isPassable) return null;

  // Trees are isolated structures that don't bleed into terrain, so they can have a massive search depth
  const isSourceTree = tex === 'wood' || tex === 'leaves';
  const effectiveMaxDepth = isSourceTree ? 200 : MAX_SEARCH_DEPTH;

  // BFS Queue
  const queue = [{ x: sx, y: sy, z: sz, depth: 0, tex }];
  const visited = new Set([`${sx},${sy},${sz}`]);
  const cluster = [];

  let isAnchored = false;

  const neighbors = [
    [0, -1, 0],
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
    [0, 1, 0],
  ];

  let qi = 0;
  while (qi < queue.length) {
    const { x, y, z, depth, tex: curTex } = queue[qi++];
    cluster.push({ x, y, z, texture: curTex });

    if (depth >= effectiveMaxDepth) {
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

        if (nTex === 'UNLOADED') {
          isAnchored = true;
          break;
        }

        // If the neighbor is a solid block, it can transmit support
        if (
          nTex &&
          BlockRegistry[nTex] &&
          !BlockRegistry[nTex].isFlora &&
          !BlockRegistry[nTex].isLiquid &&
          !BlockRegistry[nTex].isPassable
        ) {
          const isCurrentTree = curTex === 'wood' || curTex === 'leaves';
          const isNeighborTree = nTex === 'wood' || nTex === 'leaves';

          if (isCurrentTree && !isNeighborTree) {
            // A tree block touching a non-tree block.
            // It is only supported if the non-tree block is directly underneath it!
            if (dy === -1) {
              isAnchored = true;
            }
            // Do NOT add non-tree walls to the tree's cluster queue
          } else {
            queue.push({ x: nx, y: ny, z: nz, depth: depth + 1, tex: nTex });
          }
        }
      }
    }

    if (isAnchored) break;
  }

  if (isAnchored) {
    return null; // Structure is safe
  }

  return cluster; // Structure falls
};
