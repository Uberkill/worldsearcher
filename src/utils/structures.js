// src/utils/structures.js

import treeBlueprint from '../prefabs/tree.json';
import shopBlueprint from '../prefabs/shop.json';
import ruinsBlueprint from '../prefabs/ruins.json';
import crystalSpireBlueprint from '../prefabs/crystal_spire.json';
import meteorBlueprint from '../prefabs/meteor.json';
import { spatialHash, mulberry32 } from './chunkGenerator';

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
            texture: palette[char]
          });
        }
      }
    });
  });
  
  return blocks;
};

export const ShopStructure = compilePrefab(shopBlueprint);
export const TreeStructure = compilePrefab(treeBlueprint);
export const RuinsStructure = compilePrefab(ruinsBlueprint);
export const CrystalSpireStructure = compilePrefab(crystalSpireBlueprint);
export const MeteorStructure = compilePrefab(meteorBlueprint);

const hash = (x, z, seed = 0) => {
  const h = spatialHash(seed, x, z);
  return mulberry32(h)();
};

export const getStructuresForChunk = (targetCx, targetCz, getSurfaceHeight, seed) => {
  const structureBlocks = [];
  
  for (let cx = targetCx - 1; cx <= targetCx + 1; cx++) {
    for (let cz = targetCz - 1; cz <= targetCz + 1; cz++) {
      
      const dist = Math.sqrt((cx * 16)**2 + (cz * 16)**2);
      
      // 1. Crater / Meteor Anomaly (2% chance per chunk everywhere outside pure abstraction)
      if (dist < 700 && hash(cx, cz, seed + 99) < 0.02) {
        const worldX = cx * 16 + 8;
        const worldZ = cz * 16 + 8;
        const surfaceY = getSurfaceHeight(worldX, worldZ);
        if (surfaceY !== undefined && surfaceY > 0) {
          // The crater carves down by 6 blocks, so the meteor sits 5 blocks below surface
          structureBlocks.push({ template: MeteorStructure, rootX: worldX, rootY: surfaceY - 5, rootZ: worldZ });
        }
        continue; // Don't spawn other structures inside a crater center!
      }
      
      // 1.5. Labyrinth Arena Center (0.5% chance, Fracture zone)
      if (dist >= 200 && dist < 700 && hash(cx, cz, seed + 101) < 0.005) {
        const worldX = cx * 16 + 8;
        const worldZ = cz * 16 + 8;
        
        // The arena floor is flat at Y=0, so rootY = 1.
        structureBlocks.push({ template: CrystalSpireStructure, rootX: worldX, rootY: 1, rootZ: worldZ });
        structureBlocks.push({ template: CrystalSpireStructure, rootX: worldX + 4, rootY: 1, rootZ: worldZ + 4 });
        structureBlocks.push({ template: CrystalSpireStructure, rootX: worldX - 4, rootY: 1, rootZ: worldZ - 4 });
        structureBlocks.push({ template: CrystalSpireStructure, rootX: worldX + 4, rootY: 1, rootZ: worldZ - 4 });
        structureBlocks.push({ template: CrystalSpireStructure, rootX: worldX - 4, rootY: 1, rootZ: worldZ + 4 });
        
        continue; // Skip generic spawns in the arena center!
      }

      // 2. Sanctuary Zone (0 - 200 blocks)
      if (dist < 200) {
        // Ruins (3% chance per chunk)
        if (hash(cx, cz, seed + 55) < 0.03) {
          const worldX = cx * 16 + Math.floor(hash(cx, cz, seed + 56) * 12) + 2;
          const worldZ = cz * 16 + Math.floor(hash(cx, cz, seed + 57) * 12) + 2;
          const surfaceY = getSurfaceHeight(worldX, worldZ);
          if (surfaceY !== undefined && surfaceY > 0) {
            structureBlocks.push({ template: RuinsStructure, rootX: worldX, rootY: surfaceY, rootZ: worldZ }); // Sunken 1 block
          }
        }
        
        // Shop (5% chance)
        if (hash(cx, cz, seed + 42) < 0.05) {
          const worldX = cx * 16 + Math.floor(hash(cx, cz, seed + 43) * 12) + 2;
          const worldZ = cz * 16 + Math.floor(hash(cx, cz, seed + 44) * 12) + 2;
          const surfaceY = getSurfaceHeight(worldX, worldZ);
          if (surfaceY !== undefined && surfaceY > 0) {
            structureBlocks.push({ template: ShopStructure, rootX: worldX, rootY: surfaceY + 1, rootZ: worldZ });
          }
        }
        
        // Trees
        for (let tx = 2; tx < 14; tx += 4) {
          for (let tz = 2; tz < 14; tz += 4) {
            if (hash(cx + tx, cz + tz, seed + 10) < 0.15) {
              const worldX = cx * 16 + tx;
              const worldZ = cz * 16 + tz;
              const surfaceY = getSurfaceHeight(worldX, worldZ);
              if (surfaceY !== undefined && surfaceY > 0) {
                structureBlocks.push({ template: TreeStructure, rootX: worldX, rootY: surfaceY + 1, rootZ: worldZ });
              }
            }
          }
        }
      }

      // 3. Fracture Zone (200 - 700 blocks)
      if (dist >= 200 && dist < 700) {
        // Crystal Spires (10% chance per chunk)
        if (hash(cx, cz, seed + 66) < 0.10) {
          const worldX = cx * 16 + Math.floor(hash(cx, cz, seed + 67) * 12) + 2;
          const worldZ = cz * 16 + Math.floor(hash(cx, cz, seed + 68) * 12) + 2;
          const surfaceY = getSurfaceHeight(worldX, worldZ);
          if (surfaceY !== undefined && surfaceY > 0) {
            structureBlocks.push({ template: CrystalSpireStructure, rootX: worldX, rootY: surfaceY + 1, rootZ: worldZ });
          }
        }
      }

      // 4. Global Flora (Grass & Flowers everywhere)
      for (let fx = 0; fx < 16; fx += 2) {
        for (let fz = 0; fz < 16; fz += 2) {
           const fHash = hash(cx + fx, cz + fz, seed + 20);
           if (fHash < 0.3) {
              const worldX = cx * 16 + fx;
              const worldZ = cz * 16 + fz;
              const surfaceY = getSurfaceHeight(worldX, worldZ);
              if (surfaceY !== undefined && surfaceY > 0) {
                 let tex = 'tall_grass';
                 if (fHash < 0.02) tex = 'red_flower';
                 else if (fHash < 0.05) tex = 'yellow_flower';
                 
                 structureBlocks.push({ 
                     template: [{ dx: 0, dy: 0, dz: 0, texture: tex }], 
                     rootX: worldX, 
                     rootY: surfaceY + 1, 
                     rootZ: worldZ 
                 });
              }
           }
        }
      }

    }
  }
  
  return structureBlocks;
};
