// src/utils/structures.js

import treeThickBlueprint from '../prefabs/tree_thick.json';
import treeSkinnyBlueprint from '../prefabs/tree_skinny.json';
import treeNormalBlueprint from '../prefabs/tree_normal.json';
import treeMushroomBlueprint from '../prefabs/tree_mushroom.json';
import treeGlassBlueprint from '../prefabs/tree_glass.json';
import treeArchBlueprint from '../prefabs/tree_arch.json';
import shopBlueprint from '../prefabs/shop.json';
import ruinsBlueprint from '../prefabs/ruins.json';
import crystalSpireBlueprint from '../prefabs/crystal_spire.json';
import meteorBlueprint from '../prefabs/meteor.json';
import { getBiomeAt, getBiomeConfig } from './biomes';
import { SEA_LEVEL, CHUNK_SIZE_X, CHUNK_SIZE_Z } from './chunkData';

const compilePrefab = (blueprint) => {
  const blocks = [];
  const { palette, layers } = blueprint;

  let maxX = 0;
  let maxZ = 0;
  for (const layer of layers) {
    maxZ = Math.max(maxZ, layer.length);
    for (const row of layer) {
      maxX = Math.max(maxX, row.length);
    }
  }

  const cx = Math.floor(maxX / 2);
  const cz = Math.floor(maxZ / 2);

  layers.forEach((layer, y) => {
    layer.forEach((row, z) => {
      for (let x = 0; x < row.length; x++) {
        const char = row[x];
        if (char !== ' ' && palette[char]) {
          blocks.push({
            dx: x - cx,
            dy: y,
            dz: z - cz,
            texture: palette[char],
          });
        }
      }
    });
  });

  return blocks;
};

export const ShopStructure = compilePrefab(shopBlueprint);
export const TreeThickStructure = compilePrefab(treeThickBlueprint);
export const TreeSkinnyStructure = compilePrefab(treeSkinnyBlueprint);
export const TreeNormalStructure = compilePrefab(treeNormalBlueprint);
export const TreeMushroomStructure = compilePrefab(treeMushroomBlueprint);
export const TreeGlassStructure = compilePrefab(treeGlassBlueprint);
export const TreeArchStructure = compilePrefab(treeArchBlueprint);
export const RuinsStructure = compilePrefab(ruinsBlueprint);
export const CrystalSpireStructure = compilePrefab(crystalSpireBlueprint);
export const MeteorStructure = compilePrefab(meteorBlueprint);

function spatialHash(seed, x, y) {
  let h = seed | 0;
  h = Math.imul(h ^ x, 0x85ebca6b);
  h = Math.imul(h ^ y, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h;
}

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const hash = (x, z, seed = 0) => {
  const h = spatialHash(seed, x, z);
  return mulberry32(h)();
};

export const getStructuresForChunk = (
  targetCx,
  targetCz,
  getSurfaceHeight,
  seed,
  tempNoiseFunc,
  moistNoiseFunc
) => {
  const floraBlocks = [];
  const treeBlocks = [];
  const majorBlocks = [];
  const anomalyBlocks = [];

  for (let cx = targetCx - 1; cx <= targetCx + 1; cx++) {
    for (let cz = targetCz - 1; cz <= targetCz + 1; cz++) {
      const dist = Math.sqrt(
        (cx * CHUNK_SIZE_X) ** 2 + (cz * CHUNK_SIZE_Z) ** 2
      );

      // 1. Crater / Meteor Anomaly (2% chance per chunk everywhere outside pure abstraction)
      if (dist < 700 && hash(cx, cz, seed + 99) < 0.02) {
        const worldX = cx * CHUNK_SIZE_X + Math.floor(CHUNK_SIZE_X / 2);
        const worldZ = cz * CHUNK_SIZE_Z + Math.floor(CHUNK_SIZE_Z / 2);
        const surfaceY = getSurfaceHeight(worldX, worldZ);
        if (surfaceY !== undefined && surfaceY > 0) {
          // The crater carves down by 6 blocks, so the meteor sits 5 blocks below surface
          anomalyBlocks.push({
            template: MeteorStructure,
            rootX: worldX,
            rootY: surfaceY - 5,
            rootZ: worldZ,
          });
        }
        continue; // Don't spawn other structures inside a crater center!
      }

      // Get the dominant biome for this chunk center
      const chunkWorldX = cx * CHUNK_SIZE_X + Math.floor(CHUNK_SIZE_X / 2);
      const chunkWorldZ = cz * CHUNK_SIZE_Z + Math.floor(CHUNK_SIZE_Z / 2);
      const chunkBiomeId = getBiomeAt(
        chunkWorldX,
        chunkWorldZ,
        tempNoiseFunc,
        moistNoiseFunc,
        seed
      );
      const chunkBiomeConfig = getBiomeConfig(chunkBiomeId);

      // Labyrinth Arena Center overrides the biome dynamically via getBiomeAt,
      // but if we are in the boss arena, we can spawn specific structures!
      if (chunkBiomeId === 'boss_arena') {
        if (hash(cx, cz, seed + 101) < 0.5) {
          // Very high chance if you are actually in the arena
          // Spawn Crystal Spires around the arena
          const surfaceY = getSurfaceHeight(chunkWorldX, chunkWorldZ);
          if (surfaceY !== undefined && surfaceY > 0) {
            majorBlocks.push({
              template: CrystalSpireStructure,
              rootX: chunkWorldX,
              rootY: surfaceY + 1,
              rootZ: chunkWorldZ,
            });
          }
        }
        continue; // Skip generic spawns in boss areas!
      }

      // 2. Sanctuary Zone (0 - 200 blocks)
      if (dist < 200) {
        // Ruins (3% chance per chunk)
        if (
          hash(cx, cz, seed + 55) < 0.03 &&
          chunkBiomeConfig.structures.includes('Ruins')
        ) {
          const worldX =
            cx * CHUNK_SIZE_X + Math.floor(hash(cx, cz, seed + 56) * 12) + 2;
          const worldZ =
            cz * CHUNK_SIZE_Z + Math.floor(hash(cx, cz, seed + 57) * 12) + 2;
          const surfaceY = getSurfaceHeight(worldX, worldZ);
          if (surfaceY !== undefined && surfaceY > 0) {
            majorBlocks.push({
              template: RuinsStructure,
              rootX: worldX,
              rootY: surfaceY,
              rootZ: worldZ,
            }); // Sunken 1 block
          }
        }

        // Shop (5% chance)
        if (hash(cx, cz, seed + 42) < 0.05) {
          const worldX =
            cx * CHUNK_SIZE_X + Math.floor(hash(cx, cz, seed + 43) * 12) + 2;
          const worldZ =
            cz * CHUNK_SIZE_Z + Math.floor(hash(cx, cz, seed + 44) * 12) + 2;
          const surfaceY = getSurfaceHeight(worldX, worldZ);
          if (surfaceY !== undefined && surfaceY > SEA_LEVEL) {
            majorBlocks.push({
              template: ShopStructure,
              rootX: worldX,
              rootY: surfaceY + 1,
              rootZ: worldZ,
            });
          }
        }
      }

      // 3. Dynamic Biome Tree Spawning
      // Trees (Organic Jittered Grid)
      for (let tx = 0; tx < CHUNK_SIZE_X; tx += 8) {
        for (let tz = 0; tz < CHUNK_SIZE_Z; tz += 8) {
          // 20% chance to spawn a tree in this 8x8 cell
          if (
            hash(cx * CHUNK_SIZE_X + tx, cz * CHUNK_SIZE_Z + tz, seed + 10) <
            0.2
          ) {
            const offsetX = Math.floor(
              hash(cx * CHUNK_SIZE_X + tx, cz * CHUNK_SIZE_Z + tz, seed + 11) *
                8
            );
            const offsetZ = Math.floor(
              hash(cx * CHUNK_SIZE_X + tx, cz * CHUNK_SIZE_Z + tz, seed + 12) *
                8
            );
            const worldX = cx * CHUNK_SIZE_X + tx + offsetX;
            const worldZ = cz * CHUNK_SIZE_Z + tz + offsetZ;
            const surfaceY = getSurfaceHeight(worldX, worldZ);

            if (surfaceY !== undefined && surfaceY > SEA_LEVEL) {
              const biomeId = getBiomeAt(
                worldX,
                worldZ,
                tempNoiseFunc,
                moistNoiseFunc,
                seed
              );
              const biomeConfig = getBiomeConfig(biomeId);

              if (biomeConfig.structures.length > 0) {
                const typeHash = hash(worldX, worldZ, seed + 13);
                let template = null;

                // Select tree type based on what the biome allows
                if (
                  biomeConfig.structures.includes('TreeNormal') &&
                  typeHash < 0.5
                )
                  template = TreeNormalStructure;
                else if (
                  biomeConfig.structures.includes('TreeThick') &&
                  typeHash < 0.7
                )
                  template = TreeThickStructure;
                else if (biomeConfig.structures.includes('TreeSkinny'))
                  template = TreeSkinnyStructure;
                else if (biomeConfig.structures.includes('TreeMushroom'))
                  template = TreeMushroomStructure;
                else if (biomeConfig.structures.includes('TreeGlass'))
                  template = TreeGlassStructure;
                else if (biomeConfig.structures.includes('TreeArch'))
                  template = TreeArchStructure;

                // Fallback to the first allowed structure if none matched random weights
                if (!template && biomeConfig.structures.includes('TreeNormal'))
                  template = TreeNormalStructure;
                if (!template && biomeConfig.structures.includes('TreeSkinny'))
                  template = TreeSkinnyStructure;

                if (template) {
                  treeBlocks.push({
                    template,
                    rootX: worldX,
                    rootY: surfaceY + 1,
                    rootZ: worldZ,
                  });
                }
              }
            }
          }
        }
      }

      // 4. Fracture Zone (200 - 700 blocks)
      if (dist >= 200 && dist < 700) {
        // Crystal Spires (10% chance per chunk)
        if (
          hash(cx, cz, seed + 66) < 0.1 &&
          chunkBiomeConfig.structures.includes('CrystalSpire')
        ) {
          const worldX =
            cx * CHUNK_SIZE_X + Math.floor(hash(cx, cz, seed + 67) * 12) + 2;
          const worldZ =
            cz * CHUNK_SIZE_Z + Math.floor(hash(cx, cz, seed + 68) * 12) + 2;
          const surfaceY = getSurfaceHeight(worldX, worldZ);
          if (surfaceY !== undefined && surfaceY > 0) {
            majorBlocks.push({
              template: CrystalSpireStructure,
              rootX: worldX,
              rootY: surfaceY + 1,
              rootZ: worldZ,
            });
          }
        }
      }

      // 5. Dynamic Biome Flora
      // Iterating every block, using continuous noise to create organic patches and clumps
      for (let fx = 0; fx < CHUNK_SIZE_X; fx++) {
        for (let fz = 0; fz < CHUNK_SIZE_Z; fz++) {
          const worldX = cx * CHUNK_SIZE_X + fx;
          const worldZ = cz * CHUNK_SIZE_Z + fz;

          // Simplex noise gives smooth waves between -1 and 1. We scale the coordinates so patches are around 10-20 blocks wide.
          const patchNoise = tempNoiseFunc(worldX * 0.1, worldZ * 0.1);

          // If noise > 0.2, we are inside a lush patch!
          if (patchNoise > 0.2) {
            // Still use hash to add a bit of organic randomness/spacing inside the clump
            const fHash = hash(worldX, worldZ, seed + 20);

            // 60% chance to spawn on a block inside a patch
            if (fHash < 0.6) {
              const surfaceY = getSurfaceHeight(worldX, worldZ);
              if (surfaceY !== undefined && surfaceY > SEA_LEVEL) {
                const biomeId = getBiomeAt(
                  worldX,
                  worldZ,
                  tempNoiseFunc,
                  moistNoiseFunc,
                  seed
                );
                const biomeConfig = getBiomeConfig(biomeId);

                // If the biome allows flora
                if (biomeConfig.flora && biomeConfig.flora.length > 0) {
                  let tex = biomeConfig.flora[0];

                  if (biomeConfig.flora.length > 1 && fHash < 0.05) {
                    // 0.00 to 0.05 = Rare flowers (inside the patch)
                    const floraIndex =
                      1 +
                      Math.floor(
                        (fHash / 0.05) * (biomeConfig.flora.length - 1)
                      );
                    tex = biomeConfig.flora[floraIndex];
                  }

                  floraBlocks.push({
                    template: [{ dx: 0, dy: 0, dz: 0, texture: tex }],
                    rootX: worldX,
                    rootY: surfaceY + 1,
                    rootZ: worldZ,
                  });
                }
              }
            }
          }
        }
      }
    }
  }

  return [...floraBlocks, ...treeBlocks, ...majorBlocks, ...anomalyBlocks];
};
