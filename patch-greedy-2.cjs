const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/utils/greedyMesh.js');
let code = fs.readFileSync(filePath, 'utf-8');

// 1. Change scratchColor to Uint32Array
code = code.replace(
  "const scratchColor = new Float32Array(MAX_FACES * 12);",
  "const scratchColor = new Uint32Array(MAX_FACES * 4);"
);

// 2. Change the addFace packing logic
const oldAddFaceColor = `      // Helper to apply AO/Sunlight/Blocklight to vertex color
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
      const l3 = applyLighting(v3L);

    scratchPos[p] = v0[0]; scratchPos[p+1] = v0[1]; scratchPos[p+2] = v0[2];
    scratchPos[p+3] = v1[0]; scratchPos[p+4] = v1[1]; scratchPos[p+5] = v1[2];
    scratchPos[p+6] = v2[0]; scratchPos[p+7] = v2[1]; scratchPos[p+8] = v2[2];
    scratchPos[p+9] = v3[0]; scratchPos[p+10] = v3[1]; scratchPos[p+11] = v3[2];

    const cp = faceCount * 12;
    scratchColor[cp] = l0;   scratchColor[cp+1] = texId; scratchColor[cp+2] = 1;
    scratchColor[cp+3] = l1; scratchColor[cp+4] = texId; scratchColor[cp+5] = 1;
    scratchColor[cp+6] = l2; scratchColor[cp+7] = texId; scratchColor[cp+8] = 1;
    scratchColor[cp+9] = l3; scratchColor[cp+10] = texId; scratchColor[cp+11] = 1;`;

const newAddFaceColor = `      // Helper to pack vertex data: Light (10-bit), TexId (8-bit)
      const packVertex = (lightAO, texId) => {
          return (lightAO & 0x3FF) | ((texId & 0xFF) << 10);
      };

    scratchPos[p] = v0[0]; scratchPos[p+1] = v0[1]; scratchPos[p+2] = v0[2];
    scratchPos[p+3] = v1[0]; scratchPos[p+4] = v1[1]; scratchPos[p+5] = v1[2];
    scratchPos[p+6] = v2[0]; scratchPos[p+7] = v2[1]; scratchPos[p+8] = v2[2];
    scratchPos[p+9] = v3[0]; scratchPos[p+10] = v3[1]; scratchPos[p+11] = v3[2];

    const cp = faceCount * 4; // 4 ints per face now!
    scratchColor[cp] = packVertex(v0L, texId);
    scratchColor[cp+1] = packVertex(v1L, texId);
    scratchColor[cp+2] = packVertex(v2L, texId);
    scratchColor[cp+3] = packVertex(v3L, texId);`;

code = code.replace(oldAddFaceColor, newAddFaceColor);

// 3. Update the mesh builder buffer sizes and typed arrays
const oldMeshBuilder = `       const colorBuf = getBuf(pb.color);
       colorBuffer = (colorBuf && colorBuf.byteLength >= faces * 48) ? colorBuf : new ArrayBuffer(faces * 48);
       const uvBuf = getBuf(pb.uv);
       uvBuffer = (uvBuf && uvBuf.byteLength >= faces * 32) ? uvBuf : new ArrayBuffer(faces * 32);
       const idxBuf = getBuf(pb.idx);
       idxBuffer = (idxBuf && idxBuf.byteLength >= faces * 24) ? idxBuf : new ArrayBuffer(faces * 24);
    } else {
       posBuffer = new ArrayBuffer(faces * 48);
       normBuffer = new ArrayBuffer(faces * 12);
       colorBuffer = new ArrayBuffer(faces * 48);
       uvBuffer = new ArrayBuffer(faces * 32);
       idxBuffer = new ArrayBuffer(faces * 24);
    }

    const pos = new Float32Array(posBuffer, 0, faces * 12);
    const norm = new Int8Array(normBuffer, 0, faces * 12);
    const color = new Float32Array(colorBuffer, 0, faces * 12);
    const uv = new Float32Array(uvBuffer, 0, faces * 8);
    const idx = new Uint32Array(idxBuffer, 0, faces * 6);

    for (let outFace = 0; outFace < count; outFace++) {
      const fi = indices[outFace];

      const srcP = fi * 12;
      const dstP = outFace * 12;
      pos.set(scratchPos.subarray(srcP, srcP + 12), dstP);
      norm.set(scratchNorm.subarray(srcP, srcP + 12), dstP);
      color.set(scratchColor.subarray(srcP, srcP + 12), dstP);`;

const newMeshBuilder = `       const colorBuf = getBuf(pb.color);
       colorBuffer = (colorBuf && colorBuf.byteLength >= faces * 16) ? colorBuf : new ArrayBuffer(faces * 16);
       const uvBuf = getBuf(pb.uv);
       uvBuffer = (uvBuf && uvBuf.byteLength >= faces * 32) ? uvBuf : new ArrayBuffer(faces * 32);
       const idxBuf = getBuf(pb.idx);
       idxBuffer = (idxBuf && idxBuf.byteLength >= faces * 24) ? idxBuf : new ArrayBuffer(faces * 24);
    } else {
       posBuffer = new ArrayBuffer(faces * 48);
       normBuffer = new ArrayBuffer(faces * 12);
       colorBuffer = new ArrayBuffer(faces * 16);
       uvBuffer = new ArrayBuffer(faces * 32);
       idxBuffer = new ArrayBuffer(faces * 24);
    }

    const pos = new Float32Array(posBuffer, 0, faces * 12);
    const norm = new Int8Array(normBuffer, 0, faces * 12);
    const color = new Uint32Array(colorBuffer, 0, faces * 4);
    const uv = new Float32Array(uvBuffer, 0, faces * 8);
    const idx = new Uint32Array(idxBuffer, 0, faces * 6);

    for (let outFace = 0; outFace < count; outFace++) {
      const fi = indices[outFace];

      const srcP = fi * 12;
      const dstP = outFace * 12;
      pos.set(scratchPos.subarray(srcP, srcP + 12), dstP);
      norm.set(scratchNorm.subarray(srcP, srcP + 12), dstP);
      
      const cSrcP = fi * 4;
      const cDstP = outFace * 4;
      color.set(scratchColor.subarray(cSrcP, cSrcP + 4), cDstP);`;

code = code.replace(oldMeshBuilder, newMeshBuilder);

fs.writeFileSync(filePath, code);
console.log('greedyMesh.js patched to Uint32 packed attributes!');
