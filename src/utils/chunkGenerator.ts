// @ts-nocheck
/**
 * chunkGenerator.js — Pure chunk generation logic with seeded, deterministic noise.
 *
 * WHY SEEDED NOISE:
 * The old code used `createNoise2D()` with a random seed at module-load time.
 * When we move generation to Web Workers, each worker process is a fresh JS
 * environment and would call Math.random() independently — producing different
 * seeds and therefore different terrain for the same chunk coordinates.
 * Using mulberry32(WORLD_SEED) gives identical results from any thread.
 */

import { createNoise2D, createNoise3D } from 'simplex-noise';
import { getStructuresForChunk } from './structures.js';
import { BlockIds, BlockById, BlockKeyById } from '../registry/BlockRegistry';
import {
  setBlock,
  getIndex,
  CHUNK_VOLUME,
  CHUNK_Y_MIN,
  CHUNK_Y_MAX,
  CHUNK_HEIGHT,
  CHUNK_PAD,
  HALO_SIZE_X,
  HALO_SIZE_Z,
  CHUNK_SIZE_X,
  CHUNK_SIZE_Z,
} from './chunkData';
import { getBiomeAt, getBiomeConfig, getRegionStoryBeat, spatialHash as biomeSpatialHash } from './biomes';

export function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}



// Lazy-loaded noise functions
let tempNoise2D;
let moistNoise2D;
let caveNoise3D;
let islandNoise3D;
let islandDetailNoise3D;



// ── 3D Density Grid Configuration ──
const GRID_STEP = 4;
const DENSITY_GRID_X = Math.ceil(18 / GRID_STEP) + 1; // HALO_SIZE_X / 4
const DENSITY_GRID_Y = Math.ceil(320 / GRID_STEP) + 1; // (CHUNK_Y_MAX - CHUNK_Y_MIN) / 4
const DENSITY_GRID_Z = Math.ceil(18 / GRID_STEP) + 1;
const threadLocalDensityGrid = new Float32Array(DENSITY_GRID_X * DENSITY_GRID_Y * DENSITY_GRID_Z);


// ── Main generation function ─────────────────────────────────────────────────
let cachedWorldSeed = null;

const MAX_SURFACES = 4;

export interface ChunkPass1Result {
  buffer: Uint32Array;
  neighborBlocks: Record<string, { texture: string; level?: number }>;
  isModified: boolean;
  faceOpen: boolean[];
  meshArrays: null;
  cx: number;
  cz: number;
  getSurfaceHeightMap: Int16Array;
}

export const generateChunkPass1 = (cx: number, cz: number, worldSeed: number): ChunkPass1Result => {
  if (worldSeed !== cachedWorldSeed) {
    cachedWorldSeed = worldSeed;
    // CRITICAL FIX: The Simplex noise functions MUST be seeded by the global worldSeed,
    // NOT the chunkSeed! If you re-seed the noise per chunk, you completely destroy
    // the mathematical continuity of the noise, creating random sheer cliffs at every boundary.
    // noise2D = createNoise2D(mulberry32(worldSeed)); // unused
    tempNoise2D = createNoise2D(mulberry32(worldSeed + 1));
    moistNoise2D = createNoise2D(mulberry32(worldSeed + 2));
    caveNoise3D = createNoise3D(mulberry32(worldSeed + 3));
    islandNoise3D = createNoise3D(mulberry32(worldSeed + 4));
    islandDetailNoise3D = createNoise3D(mulberry32(worldSeed + 5));
  }

  // Pass 1: Base Terrain Flat Buffer
  const haloBuffer = new Uint16Array(HALO_SIZE_X * CHUNK_HEIGHT * HALO_SIZE_Z);
  const getHaloIndex = (lx, y, lz) =>
    (y - CHUNK_Y_MIN) * (HALO_SIZE_X * HALO_SIZE_Z) + lz * HALO_SIZE_X + lx;
  const getSurfaceHeightMap = new Int16Array(HALO_SIZE_X * HALO_SIZE_Z * MAX_SURFACES);
  getSurfaceHeightMap.fill(-999);

  // Pre-calculate Jigsaw Contexts for the chunk's region + 8 neighbors
  const regionContexts = [];
  const chunkCenterX = cx * CHUNK_SIZE_X + CHUNK_SIZE_X / 2;
  const chunkCenterZ = cz * CHUNK_SIZE_Z + CHUNK_SIZE_Z / 2;
  const baseRegionX = Math.floor(chunkCenterX / 2000);
  const baseRegionZ = Math.floor(chunkCenterZ / 2000);
  for (let rx = -1; rx <= 1; rx++) {
    for (let rz = -1; rz <= 1; rz++) {
      const rX = baseRegionX + rx;
      const rZ = baseRegionZ + rz;
      const storyBeat = getRegionStoryBeat(rX, rZ, worldSeed);
      if (storyBeat) {
        const hx = biomeSpatialHash(worldSeed, rX, rZ);
        const hz = biomeSpatialHash(worldSeed + 1, rX, rZ);
        regionContexts.push({
          anchorX: rX * 2000 + hx * 2000,
          anchorZ: rZ * 2000 + hz * 2000,
          storyBeat
        });
      }
    }
  }

  // Pre-calculate 3D density grid at 4x4x4 intervals
  for (let gx = 0; gx < DENSITY_GRID_X; gx++) {
    for (let gz = 0; gz < DENSITY_GRID_Z; gz++) {
      const worldX = cx * CHUNK_SIZE_X - CHUNK_PAD + (gx * GRID_STEP);
      const worldZ = cz * CHUNK_SIZE_Z - CHUNK_PAD + (gz * GRID_STEP);
      
      for (let gy = 0; gy < DENSITY_GRID_Y; gy++) {
        const worldY = CHUNK_Y_MIN + (gy * GRID_STEP);
        
        let finalDensity = -1; // Default to air
        
        // Purely 3D Sky Islands everywhere (Lower, Middle, Higher)
        const islandBase = islandNoise3D(worldX * 0.005, worldY * 0.008, worldZ * 0.005);
        const islandDetail = islandDetailNoise3D(worldX * 0.02, worldY * 0.02, worldZ * 0.02) * 0.5;
        // Mask to make them rare
        const islandMask = islandBase + islandDetail;
        
        if (islandMask > 0.6) {
           // Use cave noise for inner topology of the island
           let density = caveNoise3D(worldX * 0.015, worldY * 0.02, worldZ * 0.015);
           finalDensity = density + (islandMask - 0.6) * 2.0; 
        }
        
        const gridIdx = gy * (DENSITY_GRID_X * DENSITY_GRID_Z) + gz * DENSITY_GRID_X + gx;
        threadLocalDensityGrid[gridIdx] = finalDensity;
      }
    }
  }

  // Interpolate Density and Fill Voxel Buffer
  for (let lx = 0; lx < HALO_SIZE_X; lx++) {
    for (let lz = 0; lz < HALO_SIZE_Z; lz++) {
      const x = cx * CHUNK_SIZE_X - CHUNK_PAD + lx;
      const z = cz * CHUNK_SIZE_Z - CHUNK_PAD + lz;
      
      const biomeId = getBiomeAt(x, z, tempNoise2D, moistNoise2D, regionContexts);
      const biomeData = getBiomeConfig(biomeId);
      const surfaceTex = BlockIds[biomeData.surface];
      const subTex = BlockIds[biomeData.subsurface];
      
      let numSurfaces = 0;
      let wasSolid = false; // Start from void (air)
      
      const gx = Math.floor(lx / GRID_STEP);
      const gz = Math.floor(lz / GRID_STEP);
      const tx = (lx % GRID_STEP) / GRID_STEP;
      const tz = (lz % GRID_STEP) / GRID_STEP;

      for (let y = CHUNK_Y_MIN; y <= CHUNK_Y_MAX; y++) {
        const gy = Math.floor((y - CHUNK_Y_MIN) / GRID_STEP);
        const ty = ((y - CHUNK_Y_MIN) % GRID_STEP) / GRID_STEP;
        
        // Trilinear Interpolation of the 8 grid corners
        const strideY = DENSITY_GRID_X * DENSITY_GRID_Z;
        const strideZ = DENSITY_GRID_X;
        
        const idx000 = gy * strideY + gz * strideZ + gx;
        const v000 = threadLocalDensityGrid[idx000];
        const v100 = threadLocalDensityGrid[idx000 + 1];
        const v010 = threadLocalDensityGrid[idx000 + strideZ];
        const v110 = threadLocalDensityGrid[idx000 + strideZ + 1];
        
        const idx001 = (gy + 1) * strideY + gz * strideZ + gx;
        const v001 = threadLocalDensityGrid[idx001];
        const v101 = threadLocalDensityGrid[idx001 + 1];
        const v011 = threadLocalDensityGrid[idx001 + strideZ];
        const v111 = threadLocalDensityGrid[idx001 + strideZ + 1];
        
        // Interpolate along X
        const i1 = v000 * (1 - tx) + v100 * tx;
        const i2 = v010 * (1 - tx) + v110 * tx;
        const i3 = v001 * (1 - tx) + v101 * tx;
        const i4 = v011 * (1 - tx) + v111 * tx;
        
        // Interpolate along Z
        const j1 = i1 * (1 - tz) + i2 * tz;
        const j2 = i3 * (1 - tz) + i4 * tz;
        
        // Interpolate along Y
        const finalDensity = j1 * (1 - ty) + j2 * ty;
        
        const isSolid = finalDensity > 0;
        
        // Surface transition: From solid to air
        if (wasSolid && !isSolid) {
           // The block below (y - 1) is a surface!
           haloBuffer[getHaloIndex(lx, y - 1, lz)] = surfaceTex;
           if (numSurfaces < MAX_SURFACES) {
             getSurfaceHeightMap[(lz * HALO_SIZE_X + lx) * MAX_SURFACES + numSurfaces] = y - 1;
             numSurfaces++;
           }
        }
        
        if (isSolid) {
           haloBuffer[getHaloIndex(lx, y, lz)] = subTex;
        }
        
        wasSolid = isSolid;
      }
      
      // If we ended the column still solid, cap the very top
      if (wasSolid) {
         haloBuffer[getHaloIndex(lx, CHUNK_Y_MAX, lz)] = surfaceTex;
         if (numSurfaces < MAX_SURFACES) {
           getSurfaceHeightMap[(lz * HALO_SIZE_X + lx) * MAX_SURFACES + numSurfaces] = CHUNK_Y_MAX;
         }
      }
    }
  }

  // Pass 3: Structure Stamping has been moved to generateChunkPass2
  // Pass 4: Visibility Culling & Output Extraction
  const neighborBlocks = {};
  const buffer = new Uint32Array(CHUNK_VOLUME);

  const isOpaque = (lx, y, lz) => {
    const tex = haloBuffer[getHaloIndex(lx, y, lz)];
    return tex !== 0 && !BlockById[tex]?.isTransparent;
  };

  const faceOpen = [false, false, true, true, false, false];

  for (let lx = 0; lx < HALO_SIZE_X; lx++) {
    for (let lz = 0; lz < HALO_SIZE_Z; lz++) {
      // Full chunk height
      for (let y = CHUNK_Y_MIN; y <= CHUNK_Y_MAX; y++) {
        const tex = haloBuffer[getHaloIndex(lx, y, lz)];
        if (tex === 0) continue;

        if (
          lx === 0 ||
          lx === HALO_SIZE_X - 1 ||
          lz === 0 ||
          lz === HALO_SIZE_Z - 1
        ) {
          const gx = cx * CHUNK_SIZE_X - CHUNK_PAD + lx;
          const gz = cz * CHUNK_SIZE_Z - CHUNK_PAD + lz;
          neighborBlocks[`${gx},${y},${gz}`] = {
            texture: BlockKeyById[tex],
            level: BlockById[tex]?.isLiquid ? 7 : undefined,
          };
          continue;
        }

        const hidden =
          y > CHUNK_Y_MIN &&
          y < CHUNK_Y_MAX &&
          isOpaque(lx, y + 1, lz) &&
          isOpaque(lx, y - 1, lz) &&
          isOpaque(lx - 1, y, lz) &&
          isOpaque(lx + 1, y, lz) &&
          isOpaque(lx, y, lz + 1) &&
          isOpaque(lx, y, lz - 1);

        const health = BlockById[tex]?.health || 100;
        const level = BlockById[tex]?.isLiquid ? 7 : 0;

        setBlock(
          buffer,
          getIndex(lx - 1, y, lz - 1),
          tex,
          health,
          hidden,
          level
        );

        if (lx === CHUNK_SIZE_X && !isOpaque(lx + 1, y, lz)) faceOpen[0] = true;
        if (lx === 1 && !isOpaque(lx - 1, y, lz)) faceOpen[1] = true;
        if (lz === CHUNK_SIZE_Z && !isOpaque(lx, y, lz + 1)) faceOpen[4] = true;
        if (lz === 1 && !isOpaque(lx, y, lz - 1)) faceOpen[5] = true;
      }
    }
  }

  // ── Pass 6: Greedy mesh arrays (computed in worker to keep main thread free) ──
  // Meshing has been moved to chunkWorker.js because it requires the Light Map.

  return {
    buffer,
    neighborBlocks,
    isModified: false,
    faceOpen,
    meshArrays: null,
    cx,
    cz,
    getSurfaceHeightMap,
  };
};

// ── Pass 2: Decorators & Overflow ────────────────────────────────────────────
export interface ChunkPass2Result {
  buffer: Uint32Array;
  overflow: Array<{ x: number; y: number; z: number; id: number }>;
}

export const generateChunkPass2 = (
  cx: number,
  cz: number,
  buffer: Uint32Array,
  getSurfaceHeightMap: Int16Array | Float32Array,
  worldSeed: number
): ChunkPass2Result => {
  if (worldSeed !== cachedWorldSeed) {
    cachedWorldSeed = worldSeed;
    // noise2D = createNoise2D(mulberry32(worldSeed)); // unused
    tempNoise2D = createNoise2D(mulberry32(worldSeed + 1));
    moistNoise2D = createNoise2D(mulberry32(worldSeed + 2));
    caveNoise3D = createNoise3D(mulberry32(worldSeed + 3));
    islandNoise3D = createNoise3D(mulberry32(worldSeed + 4));
    islandDetailNoise3D = createNoise3D(mulberry32(worldSeed + 5));
  }
  const overflow = [];
  const getSurfaceHeights = (x, z) => {
    const lx = x - (cx * CHUNK_SIZE_X - CHUNK_PAD);
    const lz = z - (cz * CHUNK_SIZE_Z - CHUNK_PAD);
    if (lx >= 0 && lx < HALO_SIZE_X && lz >= 0 && lz < HALO_SIZE_Z) {
      const baseIdx = (lz * HALO_SIZE_X + lx) * MAX_SURFACES;
      const heights = [];
      for (let i = 0; i < MAX_SURFACES; i++) {
        const h = getSurfaceHeightMap[baseIdx + i];
        if (h !== -999) heights.push(h);
      }
      return heights;
    }
    return []; // Empty array if out of bounds
  };

  const structures = getStructuresForChunk(
    cx,
    cz,
    getSurfaceHeights,
    worldSeed,
    tempNoise2D,
    moistNoise2D
  );
  for (const s of structures) {
    for (const block of s.template) {
      const gx = s.rootX + block.dx;
      const gy = s.rootY + block.dy;
      const gz = s.rootZ + block.dz;

      const lx = gx - cx * CHUNK_SIZE_X;
      const lz = gz - cz * CHUNK_SIZE_Z;

      const bTex = BlockIds[block.texture];
      if (bTex === undefined) continue;

      // ROOTING LOGIC: If this is the bottom of the structure, extend it down to local terrain
      if (block.dy === 0) {
        const localSurfaces = getSurfaceHeights(gx, gz);
        // Find the highest valid surface that is strictly below the structure root
        let localSurfaceY = undefined;
        for (const y of localSurfaces) {
           if (y < gy && (localSurfaceY === undefined || y > localSurfaceY)) {
               localSurfaceY = y;
           }
        }
        
        if (localSurfaceY !== undefined && localSurfaceY < gy - 1) {
          // The terrain here is LOWER than the structure root.
          // Cap the maximum pillar depth to prevent massive pillars dropping to lower islands!
          const maxDepth = 5;
          const targetY = Math.max(localSurfaceY + 1, gy - maxDepth);
          
          // We must build a pillar down to the local surface or maxDepth!
          for (let downY = targetY; downY < gy; downY++) {
            if (lx >= 0 && lx < CHUNK_SIZE_X && lz >= 0 && lz < CHUNK_SIZE_Z) {
              setBlock(
                buffer,
                getIndex(lx, downY, lz),
                bTex,
                100,
                false,
                0
              );
            } else {
              overflow.push({
                x: gx,
                y: downY,
                z: gz,
                id: bTex,
              });
            }
          }
        }
      }

      if (lx >= 0 && lx < CHUNK_SIZE_X && lz >= 0 && lz < CHUNK_SIZE_Z) {
        // Inside local chunk!
        const bDef = BlockById[bTex];
        const idx = getIndex(lx, gy, lz);
        const existingTex = buffer[idx] & 0x7f; // Texture is the lowest 7 bits
        const existingDef = BlockById[existingTex];

        // Safety Check: Never let a passable structure block (like grass) overwrite a solid existing block
        if (bDef && bDef.isPassable && existingTex !== 0 && existingDef && !existingDef.isPassable) {
           continue; 
        }

        setBlock(
          buffer,
          idx,
          bTex,
          bDef?.health || 100,
          false,
          0
        );
      } else {
        // Decorator Overflow! Goes to neighboring chunk!
        overflow.push({ x: gx, y: gy, z: gz, id: bTex });
      }
    }
  }

  return { buffer, overflow };
};
