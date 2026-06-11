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
import { getStructuresForChunk } from './structures';
import { BlockIds, BlockById, BlockKeyById } from '../registry/BlockRegistry';
import {
  setBlock,
  getIndex,
  CHUNK_VOLUME,
  CHUNK_Y_MIN,
  CHUNK_Y_MAX,
  CHUNK_HEIGHT,
  SEA_LEVEL,
  CHUNK_PAD,
  HALO_SIZE_X,
  HALO_SIZE_Z,
  CHUNK_SIZE_X,
  CHUNK_SIZE_Z,
} from './chunkData';
import { getBiomeAt, getBiomeConfig } from './biomes';

export function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// Spatial Hash Function (MurmurHash3-inspired mix)
export function spatialHash(worldSeed, cx, cz) {
  let h = worldSeed | 0;
  h = Math.imul(h ^ cx, 0x85ebca6b);
  h = Math.imul(h ^ cz, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h;
}

// Lazy-loaded noise functions
let noise2D;
let tempNoise2D;
let moistNoise2D;
let caveNoise3D;



// ── fBm Noise Configuration ──
const OCTAVES = 4;

const LACUNARITY = 2.0;
const PERSISTENCE = 0.5;


// ── Main generation function ─────────────────────────────────────────────────
let cachedWorldSeed = null;

export const generateChunkPass1 = (cx, cz, worldSeed) => {
  if (worldSeed !== cachedWorldSeed) {
    cachedWorldSeed = worldSeed;
    // CRITICAL FIX: The Simplex noise functions MUST be seeded by the global worldSeed,
    // NOT the chunkSeed! If you re-seed the noise per chunk, you completely destroy
    // the mathematical continuity of the noise, creating random sheer cliffs at every boundary.
    noise2D = createNoise2D(mulberry32(worldSeed));
    tempNoise2D = createNoise2D(mulberry32(worldSeed + 1));
    moistNoise2D = createNoise2D(mulberry32(worldSeed + 2));
    caveNoise3D = createNoise3D(mulberry32(worldSeed + 3));
  }

  // Pass 1: Base Terrain Flat Buffer
  const haloBuffer = new Uint16Array(HALO_SIZE_X * CHUNK_HEIGHT * HALO_SIZE_Z);
  const getHaloIndex = (lx, y, lz) =>
    (y - CHUNK_Y_MIN) * (HALO_SIZE_X * HALO_SIZE_Z) + lz * HALO_SIZE_X + lx;
  const getSurfaceHeightMap = new Float32Array(HALO_SIZE_X * HALO_SIZE_Z);

  for (let lx = 0; lx < HALO_SIZE_X; lx++) {
    for (let lz = 0; lz < HALO_SIZE_Z; lz++) {
      const x = cx * CHUNK_SIZE_X - CHUNK_PAD + lx;
      const z = cz * CHUNK_SIZE_Z - CHUNK_PAD + lz;

      // Calculate max terrain height purely from 2D noise first
      // Calculate max terrain height using Fractal Brownian Motion (fBm) for jagged, organic detail
      // Octave 1: Massive continent shapes (base layout)
      const n1 = noise2D(x * 0.002, z * 0.002);
      // Octave 2: Medium hills and valleys (adds the "ups and downs")
      const n2 = noise2D(x * 0.01, z * 0.01) * 0.5;
      // Octave 3: Small jagged details, cliffs, and ridges (removes the "smooth and round" look)
      const n3 = noise2D(x * 0.03, z * 0.03) * 0.25;

      // Determine the biome first so we can apply Dynamic Noise (Roughness)
      const worldX = x; // x is already calculated globally relative to seed
      const worldZ = z; // z is already calculated globally relative to seed
      const biomeId = getBiomeAt(
        worldX,
        worldZ,
        tempNoise2D,
        moistNoise2D,
        worldSeed
      );
      const biomeData = getBiomeConfig(biomeId);
      const roughness =
        biomeData.roughness !== undefined ? biomeData.roughness : 1.0;

      // Octave 4: Micro-details, scaled by biome roughness
      const n4 = noise2D(x * 0.08, z * 0.08) * (0.125 * roughness);
      // Octave 5: Extremely fine gravel/bumpy texture, scaled by biome roughness
      const n5 = noise2D(x * 0.15, z * 0.15) * (0.0625 * roughness);

      // Combine octaves and normalize roughly back to -1 to 1 range
      const raw2D =
        (n1 + n2 + n3 + n4 + n5) /
        (1.75 + 0.125 * roughness + 0.0625 * roughness);

      const distFromCenter = Math.sqrt(x * x + z * z);

      // 1. Base values at spawn (100% safe, dry, rolling hills)
      let amplitude = 30;
      let baseHeight = 65;

      // 2. MOUNTAIN OVERLOAD (200 to 500 blocks)
      // As amplitude stretches, we push baseHeight UP equally.
      // This forces the valleys to stay above SEA_LEVEL (30), preventing oceans, while peaks shoot up to 155!
      if (distFromCenter > 200 && distFromCenter <= 500) {
        const mountainGrowth = Math.min(30, (distFromCenter - 200) * 0.1); // Grows from 0 to 30
        amplitude += mountainGrowth;
        baseHeight += mountainGrowth;
      }
      // 3. OCEAN OVERLOAD (500+ blocks)
      // Mountains are fully grown. Now we let the baseHeight plummet from 95 down to 45.
      // This sinks the valleys deep below sea level, creating massive oceans in the far distance.
      else if (distFromCenter > 500) {
        amplitude = 60;
        baseHeight = 95 - Math.min(50, (distFromCenter - 500) * 0.1);
      }

      const maxSurfaceHeight = Math.floor(baseHeight + raw2D * amplitude);

      // Determine surface biome textures (biomeData is already calculated above)
      const surfaceTex = BlockIds[biomeData.surface];
      const subTex = BlockIds[biomeData.subsurface];

      let highestSolidY = CHUNK_Y_MIN;

      for (let y = CHUNK_Y_MIN; y <= CHUNK_Y_MAX; y++) {
        if (y <= CHUNK_Y_MIN + 3) {
          haloBuffer[getHaloIndex(lx, y, lz)] = BlockIds['bedrock'];
          highestSolidY = Math.max(highestSolidY, y);
          continue;
        }

        let isSolid;

        if (y > maxSurfaceHeight) {
          isSolid = false;
        } else {
          isSolid = true; // Base terrain is solid below maxSurfaceHeight
        }

        // --- STEP 1: Surface Water & Lava (Before Caves) ---
        // If it's empty space below Y=30, fill it with water (oceans/lakes)
        let isWater = false;
        let isLava = false;

        if (!isSolid) {
          if (y <= SEA_LEVEL) {
            isWater = true;
          }
        }

        // Deep lava oceans at the absolute bottom
        if (y < CHUNK_Y_MIN + 8) {
          isLava = true;
          isSolid = false;
          isWater = false;
        }

        // --- STEP 2: Cave Carving (After Surface Definition) ---
        // HYBRID TERRAIN: Only carve caves if we are near the surface to create overhangs
        // Or if we want deep caves, we use 3D noise. But for performance, we only evaluate
        // 3D noise if we are within 20 blocks of the max surface height.
        if (isSolid && y < maxSurfaceHeight && y > maxSurfaceHeight - 20) {
          const depthFactor = Math.min(1.0, (maxSurfaceHeight - y) / 20.0);
          const noiseValue = caveNoise3D(x * 0.03, y * 0.06, z * 0.03);

          // Carve out an overhang/cave
          if (Math.abs(noiseValue) < 0.12 * depthFactor) {
            isSolid = false;
          }
        }

        // --- STEP 3: Texture Assignment ---
        if (isSolid) {
          highestSolidY = Math.max(highestSolidY, y);

          // Assign Textures based on depth
          if (y < maxSurfaceHeight - 3) {
            haloBuffer[getHaloIndex(lx, y, lz)] = BlockIds['stone'];
          } else {
            haloBuffer[getHaloIndex(lx, y, lz)] = subTex; // Will be replaced by surfaceTex at the very top
          }
        } else if (isWater) {
          haloBuffer[getHaloIndex(lx, y, lz)] = BlockIds['water'];
        } else if (isLava) {
          haloBuffer[getHaloIndex(lx, y, lz)] = BlockIds['lava'];
        }
      }

      // Cap the highest solid block with the surface texture (if not underwater)
      if (highestSolidY > SEA_LEVEL) {
        haloBuffer[getHaloIndex(lx, highestSolidY, lz)] = surfaceTex;
      }

      getSurfaceHeightMap[lz * HALO_SIZE_X + lx] = highestSolidY;
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
export const generateChunkPass2 = (
  cx,
  cz,
  buffer,
  getSurfaceHeightMap,
  worldSeed
) => {
  if (worldSeed !== cachedWorldSeed) {
    cachedWorldSeed = worldSeed;
    noise2D = createNoise2D(mulberry32(worldSeed));
    tempNoise2D = createNoise2D(mulberry32(worldSeed + 1));
    moistNoise2D = createNoise2D(mulberry32(worldSeed + 2));
    caveNoise3D = createNoise3D(mulberry32(worldSeed + 3));
  }
  const overflow = [];
  const getSurfaceHeight = (x, z) => {
    const lx = x - (cx * CHUNK_SIZE_X - CHUNK_PAD);
    const lz = z - (cz * CHUNK_SIZE_Z - CHUNK_PAD);
    if (lx >= 0 && lx < HALO_SIZE_X && lz >= 0 && lz < HALO_SIZE_Z)
      return getSurfaceHeightMap[lz * HALO_SIZE_X + lx];
    return undefined; // We only stamp structures if we know the surface height
  };

  const structures = getStructuresForChunk(
    cx,
    cz,
    getSurfaceHeight,
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
        const localSurfaceY = getSurfaceHeight(gx, gz);
        if (localSurfaceY !== undefined && localSurfaceY < gy - 1) {
          // The terrain here is LOWER than the structure root.
          // We must build a pillar down to the local surface!
          for (let downY = localSurfaceY + 1; downY < gy; downY++) {
            if (lx >= 0 && lx < CHUNK_SIZE_X && lz >= 0 && lz < CHUNK_SIZE_Z) {
              setBlock(
                buffer,
                getIndex(lx, downY, lz),
                bTex,
                BlockById[bTex]?.health || 100,
                false,
                0
              );
            } else {
              overflow.push({ x: gx, y: downY, z: gz, id: bTex });
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
