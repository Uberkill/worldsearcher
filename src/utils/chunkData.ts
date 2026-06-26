// @ts-nocheck
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
import type { NeighborBuffer } from '../types/world';

export const CHUNK_SIZE_X = 16;
export const CHUNK_SIZE_Z = 16;
export const CHUNK_Y_MIN = -32;
export const CHUNK_Y_MAX = 255;
export const CHUNK_HEIGHT = CHUNK_Y_MAX - CHUNK_Y_MIN + 1; // 288
export const CHUNK_VOLUME = CHUNK_SIZE_X * CHUNK_HEIGHT * CHUNK_SIZE_Z; // 73728

// Dynamic World Scaling Constants
export const CHUNK_PAD = 1;
export const HALO_SIZE_X = CHUNK_SIZE_X + CHUNK_PAD * 2;
export const HALO_SIZE_Z = CHUNK_SIZE_Z + CHUNK_PAD * 2;

/**
 * Converts 3D chunk-local coordinates into a 1D Array index.
 * @param {number} lx - Local X (0 to 15)
 * @param {number} y - Absolute Y (-64 to 255)
 * @param {number} lz - Local Z (0 to 15)
 */
export const getIndex = (lx: number, y: number, lz: number): number => {
  const yOffset = y - CHUNK_Y_MIN;
  // Index formula: (Y * 256) + (Z * 16) + X
  return yOffset * 256 + lz * 16 + lx;
};



/**
 * Bit-packs block metadata into the ECS buffer.
 */
export const setBlock = (
  buffer: Uint32Array,
  index: number,
  textureId: number,
  health: number,
  isHidden: boolean | number,
  level = 0,
  blockLight = 0,
  sunLight = 0
): void => {
  const h = (health === Infinity || health >= 9999) ? 511 : Math.min(Math.max(health, 0), 510);
  buffer[index] =
    (textureId & 0xff) |
    ((h & 0x1ff) << 8) |
    ((level & 0xf) << 17) |
    ((isHidden ? 1 : 0) << 21) |
    ((blockLight & 0xf) << 22) |
    ((sunLight & 0xf) << 26);
};

// --- Fast ECS Readers ---
export const getTextureId = (val: number): number => val & 0xff;

export const getHealth = (val: number): number => {
  const h = (val >> 8) & 0x1ff;
  return h === 511 ? Infinity : h;
};

export const getLevel = (val: number): number => (val >> 17) & 0xf;

export const getIsHidden = (val: number): boolean => ((val >> 21) & 1) === 1;

export const getBlockLight = (val: number): number => (val >> 22) & 0xf;

export const getSunlight = (val: number): number => (val >> 26) & 0xf;

/**
 * Helper to safely query a global coordinate across the main chunk and its neighbors.
 * Returns -2 if out of Y bounds, -1 if out of X/Z bounds (neighbor not found), otherwise returns the raw 32-bit block.
 */
const getGlobalRawBlock = (cx: number, cz: number, buffer: Uint32Array, neighborBuffers: NeighborBuffer[] | null | undefined, gx: number, gy: number, gz: number): number => {
  if (gy < CHUNK_Y_MIN || gy > CHUNK_Y_MAX) return -2;

  if (gx >= cx * 16 && gx < cx * 16 + 16 && gz >= cz * 16 && gz < cz * 16 + 16) {
    const lx = gx & 15;
    const lz = gz & 15;
    return buffer[getIndex(lx, gy, lz)];
  }

  if (neighborBuffers) {
    const ncx = Math.floor(gx / 16);
    const ncz = Math.floor(gz / 16);
    for (let i = 0; i < neighborBuffers.length; i++) {
      if (neighborBuffers[i].cx === ncx && neighborBuffers[i].cz === ncz) {
        const lx = gx & 15;
        const lz = gz & 15;
        return neighborBuffers[i].buffer[getIndex(lx, gy, lz)];
      }
    }
  }

  return -1;
};

export const getGlobalBlockVal = (cx: number, cz: number, buffer: Uint32Array, neighborBuffers: NeighborBuffer[] | null | undefined, gx: number, gy: number, gz: number): number => {
  const val = getGlobalRawBlock(cx, cz, buffer, neighborBuffers, gx, gy, gz);
  return val < 0 ? 0 : val;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getGlobalBlockTex = (cx: number, cz: number, buffer: Uint32Array, neighborBuffers: NeighborBuffer[] | null | undefined, neighborObj: Record<string, any> | null | undefined, gx: number, gy: number, gz: number): number => {
  const val = getGlobalRawBlock(cx, cz, buffer, neighborBuffers, gx, gy, gz);
  if (val >= 0) return getTextureId(val);

  if (val === -1 && neighborObj) {
    const nb = neighborObj[`${gx},${gy},${gz}`] || neighborObj[`${gx},${gy + 0.5},${gz}`];
    return nb ? (typeof nb.texture === 'number' ? nb.texture : BlockRegistry[nb.texture]?.id || 1) : 0;
  }

  return 0;
};



// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getGlobalBlockLight = (cx: number, cz: number, buffer: Uint32Array, neighborBuffers: NeighborBuffer[] | null | undefined, neighborObj: Record<string, any> | null | undefined, gx: number, gy: number, gz: number): number => {
  const val = getGlobalRawBlock(cx, cz, buffer, neighborBuffers, gx, gy, gz);
    if (val === -2) return 15 << 26; // Out of Y bounds (Max sunlight packed)
    if (val === -1) return 15 << 26; // Out of bounds / fallback
    return val;                      // Raw block data containing packed light
};
