const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/utils/greedyMesh.js');
let code = fs.readFileSync(filePath, 'utf-8');

// Replace 4294967296 with 1099511627776 globally (40-bit shift multiplier)
code = code.replace(/4294967296/g, '1099511627776');

// Replace the bitwise decoding in addFace with the new Math.floor decoding
const oldDecodeBlock = `      const v0L = (packedLight >> 18) & 0x3F;
      const v1L = (packedLight >> 12) & 0x3F;
      const v2L = (packedLight >> 6) & 0x3F;
      const v3L = packedLight & 0x3F;

      // Helper to apply AO/Light to vertex color
      const applyLighting = (lightAO) => {
        const light = lightAO & 0xF;
        const ao = (lightAO >> 4) & 0x3;
        
        const aoMultiplier = 0.5 + ao * 0.166;
        const lightBonus = (light / 15.0) * 4.0; // Boost ambient lighting for glowing blocks
        
        return aoMultiplier + lightBonus;
      };

      const l0 = applyLighting(v0L);
      const l1 = applyLighting(v1L);
      const l2 = applyLighting(v2L);
      const l3 = applyLighting(v3L);`;

const newDecodeBlock = `      const v0L = packedLight % 1024;
      const v1L = Math.floor(packedLight / 1024) % 1024;
      const v2L = Math.floor(packedLight / 1048576) % 1024;
      const v3L = Math.floor(packedLight / 1073741824) % 1024;

      // Helper to apply AO/Sunlight/Blocklight to vertex color
      const applyLighting = (lightAO) => {
        const sun = lightAO & 0xF;
        const blk = (lightAO >> 4) & 0xF;
        const ao = (lightAO >> 8) & 0x3;
        
        const aoMultiplier = 0.5 + ao * 0.166;
        const sunBonus = (sun / 15.0) * 1.5;
        const blkBonus = (blk / 15.0) * 3.0; // Torches glow brighter locally
        
        return aoMultiplier + Math.max(sunBonus, blkBonus);
      };

      const l0 = applyLighting(v0L);
      const l1 = applyLighting(v1L);
      const l2 = applyLighting(v2L);
      const l3 = applyLighting(v3L);`;

code = code.replace(oldDecodeBlock, newDecodeBlock);

fs.writeFileSync(filePath, code);
console.log('greedyMesh.js patched!');
