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
import { setBlock, getIndex, CHUNK_VOLUME } from './chunkData';

export function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
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
let biomeNoise2D;
let caveNoise3D;
let currentSeed = null;

const norm = (n) => (n + 1) / 2;
// ── fBm Noise Configuration ──
const OCTAVES = 4;
const BASE_FREQ = 0.015;
const LACUNARITY = 2.0;
const PERSISTENCE = 0.5;
const BASE_HEIGHT = 64.0;
const HEIGHT_SCALE = 32.0;

// ── Main generation function ─────────────────────────────────────────────────
let cachedWorldSeed = null;

export const generateChunkPass1 = (cx, cz, worldSeed) => {
  if (worldSeed !== cachedWorldSeed) {
    cachedWorldSeed = worldSeed;
    // CRITICAL FIX: The Simplex noise functions MUST be seeded by the global worldSeed, 
    // NOT the chunkSeed! If you re-seed the noise per chunk, you completely destroy
    // the mathematical continuity of the noise, creating random sheer cliffs at every boundary.
    noise2D = createNoise2D(mulberry32(worldSeed));
    biomeNoise2D = createNoise2D(mulberry32(worldSeed + 1));
    caveNoise3D = createNoise3D(mulberry32(worldSeed + 2));
  }

  // Pass 1: Base Terrain (18x18x320 Flat Buffer)
  const haloBuffer = new Uint16Array(18 * 320 * 18);
  const getHaloIndex = (lx, y, lz) => (y + 64) * 324 + lz * 18 + lx;
  const getSurfaceHeightMap = new Float32Array(18 * 18);

  for (let lx = 0; lx < 18; lx++) {
    for (let lz = 0; lz < 18; lz++) {
      const x = cx * 16 - 1 + lx;
      const z = cz * 16 - 1 + lz;
      
      // OPTIMIZATION TRICK: 2D Base Height
      // Calculate max terrain height purely from 2D noise first
      const raw2D = norm(noise2D(x * 0.005, z * 0.005));
      const maxSurfaceHeight = Math.floor(BASE_HEIGHT + (raw2D * 2 - 1) * HEIGHT_SCALE * 1.5);
      
      // Determine surface biome textures
      const biomeVal = norm(biomeNoise2D(x * 0.005, z * 0.005));
      let surfaceTex = BlockIds['grass'];
      let subTex = BlockIds['dirt'];
      if (biomeVal < 0.2) { surfaceTex = BlockIds['alien_sand']; subTex = BlockIds['alien_sand']; }
      else if (biomeVal > 0.8) { surfaceTex = BlockIds['snow']; subTex = BlockIds['stone']; }

      let highestSolidY = -64;

      for (let y = -64; y <= 255; y++) {
        if (y === -64) { haloBuffer[getHaloIndex(lx, y, lz)] = BlockIds['bedrock']; highestSolidY = Math.max(highestSolidY, y); continue; }
        
        let isSolid = false;
        
        // 3D Noise Optimization Rule
        if (y > maxSurfaceHeight + 20) {
            // Instantly Output AIR
            isSolid = false;
        } else if (y < maxSurfaceHeight - 20) {
            // Fast Cave Carving Optimization (1-Octave Spaghetti Caves)
            const cv = caveNoise3D(x * 0.03, y * 0.03, z * 0.03);
            isSolid = Math.abs(cv) > 0.15;
        } else {
            // The Transition Zone: Run expensive fBm
            let amplitude = 1.0;
            let frequency = BASE_FREQ;
            let noiseValue = 0.0;
            let maxAmplitude = 0.0;

            for (let i = 0; i < OCTAVES; i++) {
                noiseValue += caveNoise3D(x * frequency, y * frequency, z * frequency) * amplitude;
                maxAmplitude += amplitude;
                amplitude *= PERSISTENCE;
                frequency *= LACUNARITY;
            }
            noiseValue /= maxAmplitude;
            
            const density = noiseValue - ((y - BASE_HEIGHT) / HEIGHT_SCALE);
            isSolid = density > 0;
        }

        if (isSolid) {
            highestSolidY = Math.max(highestSolidY, y);
            
            // Assign Textures based on depth
            if (y < maxSurfaceHeight - 3) {
                haloBuffer[getHaloIndex(lx, y, lz)] = BlockIds['stone'];
            } else {
                haloBuffer[getHaloIndex(lx, y, lz)] = subTex; // Will be replaced by surfaceTex at the very top
            }
        } else {
            // Only fill with water if we are near the surface (surface lakes/oceans)
            // Do NOT flood deep underground caves!
            if (y <= 30 && y > maxSurfaceHeight - 15) {
                haloBuffer[getHaloIndex(lx, y, lz)] = BlockIds['water'];
            } else if (y < -60) {
                haloBuffer[getHaloIndex(lx, y, lz)] = BlockIds['lava']; // Deep lava!
            }
        }
      }
      
      // Cap the highest solid block with the surface texture (if not underwater)
      if (highestSolidY > 30) {
          haloBuffer[getHaloIndex(lx, highestSolidY, lz)] = surfaceTex;
      }
      
      getSurfaceHeightMap[lz * 18 + lx] = highestSolidY;
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

   for (let lx = 0; lx < 18; lx++) {
     for (let lz = 0; lz < 18; lz++) {
       // Full chunk height: -64 (bedrock) to 255 (build limit)
       for (let y = -64; y <= 255; y++) {
          const tex = haloBuffer[getHaloIndex(lx, y, lz)];
          if (tex === 0) continue;
          
          if (lx === 0 || lx === 17 || lz === 0 || lz === 17) {
             const gx = cx * 16 - 1 + lx;
             const gz = cz * 16 - 1 + lz;
             neighborBlocks[`${gx},${y},${gz}`] = { texture: BlockKeyById[tex], level: BlockById[tex]?.isLiquid ? 7 : undefined };
             continue;
          }
          
          const hidden =
            (y > -64 && y < 255) &&
            isOpaque(lx, y + 1, lz) &&
            isOpaque(lx, y - 1, lz) &&
            isOpaque(lx - 1, y, lz) &&
            isOpaque(lx + 1, y, lz) &&
            isOpaque(lx, y, lz + 1) &&
            isOpaque(lx, y, lz - 1);

          const health = BlockById[tex]?.health || 100;
          const level = BlockById[tex]?.isLiquid ? 7 : 0;
          
          setBlock(buffer, getIndex(lx - 1, y, lz - 1), tex, health, hidden, level);
          
          if (lx === 16 && !isOpaque(lx + 1, y, lz)) faceOpen[0] = true;
          if (lx === 1 && !isOpaque(lx - 1, y, lz)) faceOpen[1] = true;
          if (lz === 16 && !isOpaque(lx, y, lz + 1)) faceOpen[4] = true;
          if (lz === 1 && !isOpaque(lx, y, lz - 1)) faceOpen[5] = true;
       }
     }
   }

  // ── Pass 6: Greedy mesh arrays (computed in worker to keep main thread free) ──
  // Meshing has been moved to chunkWorker.js because it requires the Light Map.
  
  return { buffer, neighborBlocks, isModified: false, faceOpen, meshArrays: null, cx, cz, getSurfaceHeightMap };
};

// ── Pass 2: Decorators & Overflow ────────────────────────────────────────────
export const generateChunkPass2 = (cx, cz, buffer, getSurfaceHeightMap, worldSeed) => {
   const overflow = [];
   const getSurfaceHeight = (x, z) => {
     const lx = x - (cx * 16 - 1);
     const lz = z - (cz * 16 - 1);
     if (lx >= 0 && lx < 18 && lz >= 0 && lz < 18) return getSurfaceHeightMap[lz * 18 + lx];
     return undefined; // We only stamp structures if we know the surface height
   };

   const structures = getStructuresForChunk(cx, cz, getSurfaceHeight, worldSeed);
   for (const s of structures) {
     for (const block of s.template) {
       const gx = s.rootX + block.dx;
       const gy = s.rootY + block.dy;
       const gz = s.rootZ + block.dz;
       
       const lx = gx - (cx * 16);
       const lz = gz - (cz * 16);
       
       const bTex = BlockIds[block.texture];
       if (!bTex) continue;

       if (lx >= 0 && lx < 16 && lz >= 0 && lz < 16) {
          // Inside local chunk!
          setBlock(buffer, getIndex(lx, gy, lz), bTex, BlockById[bTex]?.health || 100, false, 0);
       } else {
          // Decorator Overflow! Goes to neighboring chunk!
          overflow.push({ x: gx, y: gy, z: gz, id: bTex });
       }
     }
   }

   return { buffer, overflow };
};
