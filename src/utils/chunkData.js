/**
 * chunkData.js — High-performance ECS bit-packing memory helpers for chunks.
 *
 * A single Chunk contains 16 x 320 x 16 = 81,920 blocks.
 * Instead of 81,920 Javascript Objects, a chunk is a single Uint32Array(81920).
 *
 * Bit Layout (32 bits per block):
 * - Bits 0-7 (8 bits): Texture ID (0-255). 0 = Air.
 * - Bits 8-16 (9 bits): Health (0-511). 511 = Indestructible (Bedrock).
 * - Bits 17-20 (4 bits): Fluid Level (0-15).
 * - Bit 21 (1 bit): isHidden (0 or 1) - Used for occlusion culling.
 * - Bits 22-25 (4 bits): Block Light (0-15).
 * - Bits 26-29 (4 bits): Sunlight (0-15).
 * - Bits 30-31 (2 bits): Unused.
 */

import { BlockRegistry } from '../registry/BlockRegistry';

export const CHUNK_SIZE_X = 16;
export const CHUNK_SIZE_Z = 16;
export const CHUNK_Y_MIN = -64;
export const CHUNK_Y_MAX = 255;
export const CHUNK_HEIGHT = CHUNK_Y_MAX - CHUNK_Y_MIN + 1; // 320
export const CHUNK_VOLUME = CHUNK_SIZE_X * CHUNK_HEIGHT * CHUNK_SIZE_Z; // 81920

/**
 * Converts 3D chunk-local coordinates into a 1D Array index.
 * @param {number} lx - Local X (0 to 15)
 * @param {number} y - Absolute Y (-64 to 255)
 * @param {number} lz - Local Z (0 to 15)
 */
export const getIndex = (lx, y, lz) => {
  const yOffset = y - CHUNK_Y_MIN;
  // Index formula: (Y * 256) + (Z * 16) + X
  return (yOffset * 256) + (lz * 16) + lx;
};

/**
 * Returns true if the coordinates are strictly inside the chunk boundaries.
 */
export const isInsideChunk = (lx, y, lz) => {
  return lx >= 0 && lx < 16 && lz >= 0 && lz < 16 && y >= CHUNK_Y_MIN && y <= CHUNK_Y_MAX;
};

/**
 * Bit-packs block metadata into the ECS buffer.
 */
export const setBlock = (buffer, index, textureId, health, isHidden, level = 0, blockLight = 0, sunLight = 0) => {
  const h = health === Infinity ? 511 : Math.min(Math.max(health, 0), 510);
  buffer[index] = (textureId & 0xFF) | 
                  ((h & 0x1FF) << 8) | 
                  ((level & 0xF) << 17) | 
                  ((isHidden ? 1 : 0) << 21) |
                  ((blockLight & 0xF) << 22) |
                  ((sunLight & 0xF) << 26);
};

export const setLight = (buffer, index, blockLight, sunLight) => {
  const val = buffer[index];
  buffer[index] = (val & ~(0xFF << 22)) | ((blockLight & 0xF) << 22) | ((sunLight & 0xF) << 26);
};

export const setBlockLight = (buffer, index, blockLight) => {
  const val = buffer[index];
  buffer[index] = (val & ~(0xF << 22)) | ((blockLight & 0xF) << 22);
};

export const setSunlight = (buffer, index, sunLight) => {
  const val = buffer[index];
  buffer[index] = (val & ~(0xF << 26)) | ((sunLight & 0xF) << 26);
};

// --- Fast ECS Readers ---
export const getTextureId = (val) => val & 0xFF;

export const getHealth = (val) => {
  const h = (val >> 8) & 0x1FF;
  return h === 511 ? Infinity : h;
};

export const getLevel = (val) => (val >> 17) & 0xF;

export const getIsHidden = (val) => ((val >> 21) & 1) === 1;

export const getBlockLight = (val) => (val >> 22) & 0xF;

export const getSunlight = (val) => (val >> 26) & 0xF;

/**
 * Helper to safely query a global coordinate across the main chunk and its neighbors.
 * Useful for lighting and greedy meshing.
 */
export const getGlobalBlockVal = (cx, cz, buffer, neighborBuffers, gx, gy, gz) => {
  // If Y is entirely out of bounds, return Air
  if (gy < CHUNK_Y_MIN || gy > CHUNK_Y_MAX) return 0;

  // If inside the main chunk
  if (gx >= cx * 16 && gx < cx * 16 + 16 && gz >= cz * 16 && gz < cz * 16 + 16) {
    const lx = (gx % 16 + 16) % 16;
    const lz = (gz % 16 + 16) % 16;
    return buffer[getIndex(lx, gy, lz)];
  }

  // It's in a neighbor chunk. Find which one.
  const ncx = Math.floor(gx / 16);
  const ncz = Math.floor(gz / 16);

  if (neighborBuffers) {
    for (let i = 0; i < neighborBuffers.length; i++) {
      const nb = neighborBuffers[i];
      if (nb.cx === ncx && nb.cz === ncz) {
        const lx = (gx % 16 + 16) % 16;
        const lz = (gz % 16 + 16) % 16;
        return nb.buffer[getIndex(lx, gy, lz)];
      }
    }
  }

  return 0; // Unloaded / Air
};

export const getGlobalBlockTex = (cx, cz, buffer, neighborBuffers, neighborObj, gx, gy, gz) => {
  if (gy < CHUNK_Y_MIN || gy > CHUNK_Y_MAX) return 0;
  
  if (gx >= cx * 16 && gx < cx * 16 + 16 && gz >= cz * 16 && gz < cz * 16 + 16) {
    const lx = (gx % 16 + 16) % 16;
    const lz = (gz % 16 + 16) % 16;
    return getTextureId(buffer[getIndex(lx, gy, lz)]);
  }

  if (neighborBuffers) {
    const ncx = Math.floor(gx / 16);
    const ncz = Math.floor(gz / 16);
    for (let i = 0; i < neighborBuffers.length; i++) {
      if (neighborBuffers[i].cx === ncx && neighborBuffers[i].cz === ncz) {
        const lx = (gx % 16 + 16) % 16;
        const lz = (gz % 16 + 16) % 16;
        return getTextureId(neighborBuffers[i].buffer[getIndex(lx, gy, lz)]);
      }
    }
  }

  if (neighborObj) {
    const nb = neighborObj[`${gx},${gy},${gz}`];
    const nbLegacy = neighborObj[`${gx},${gy+0.5},${gz}`];
    const b = nb || nbLegacy;
    return b ? (typeof b.texture === 'number' ? b.texture : (BlockRegistry[b.texture]?.id || 1)) : 0;
  }

  return 0;
};

export const getGlobalBlockLevel = (cx, cz, buffer, neighborBuffers, neighborObj, gx, gy, gz) => {
  if (gy < CHUNK_Y_MIN || gy > CHUNK_Y_MAX) return 0;
  
  if (gx >= cx * 16 && gx < cx * 16 + 16 && gz >= cz * 16 && gz < cz * 16 + 16) {
    const lx = (gx % 16 + 16) % 16;
    const lz = (gz % 16 + 16) % 16;
    return getLevel(buffer[getIndex(lx, gy, lz)]);
  }

  if (neighborBuffers) {
    const ncx = Math.floor(gx / 16);
    const ncz = Math.floor(gz / 16);
    for (let i = 0; i < neighborBuffers.length; i++) {
      if (neighborBuffers[i].cx === ncx && neighborBuffers[i].cz === ncz) {
        const lx = (gx % 16 + 16) % 16;
        const lz = (gz % 16 + 16) % 16;
        return getLevel(neighborBuffers[i].buffer[getIndex(lx, gy, lz)]);
      }
    }
  }

  if (neighborObj) {
    const nb = neighborObj[`${gx},${gy},${gz}`];
    const nbLegacy = neighborObj[`${gx},${gy+0.5},${gz}`];
    const b = nb || nbLegacy;
    return b ? (b.level || 0) : 0;
  }

  return 0;
};

export const getGlobalBlockLight = (cx, cz, buffer, neighborBuffers, neighborObj, gx, gy, gz) => {
  if (gy < CHUNK_Y_MIN || gy > CHUNK_Y_MAX) return 15; // Max sunlight above/below
  
  if (gx >= cx * 16 && gx < cx * 16 + 16 && gz >= cz * 16 && gz < cz * 16 + 16) {
    const lx = (gx % 16 + 16) % 16;
    const lz = (gz % 16 + 16) % 16;
    return buffer[getIndex(lx, gy, lz)]; // Return RAW block data so mesher can extract sun/blk!
  }

  if (neighborBuffers) {
    const ncx = Math.floor(gx / 16);
    const ncz = Math.floor(gz / 16);
    for (let i = 0; i < neighborBuffers.length; i++) {
      if (neighborBuffers[i].cx === ncx && neighborBuffers[i].cz === ncz) {
        const lx = (gx % 16 + 16) % 16;
        const lz = (gz % 16 + 16) % 16;
        return neighborBuffers[i].buffer[getIndex(lx, gy, lz)]; // Return RAW block data!
      }
    }
  }

  return 15; // Fallback to max sunlight if neighbor is missing, prevents pitch black holes!
};
