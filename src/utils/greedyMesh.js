import { CHUNK_SIZE_X, CHUNK_SIZE_Z, CHUNK_Y_MIN, CHUNK_Y_MAX, getIndex, getGlobalBlockVal, getTextureId, getIsHidden, getBlockLight, getSunlight, getGlobalBlockLight } from './chunkData.js';
import { BlockRegistry, BlockById, FaceMappings } from '../registry/BlockRegistry.js';

export const buildGreedyArrays = (buffer, cx, cz, neighborBuffers) => {
  // We use pooledBuffers if provided, else create new arrays
  let sPos = [], sNorm = [], sColor = [], sUv = [], sIdx = [];
  let tPos = [], tNorm = [], tColor = [], tUv = [], tIdx = [];
  let pPos = [], pIdx = [];
  let floraArr = [];
  
  let sIndexOffset = 0;
  let tIndexOffset = 0;
  let pIndexOffset = 0;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  const pushFace = (x, y, z, nx, ny, nz, texId, isTrans, isPassable, sun, blk, ao0, ao1, ao2, ao3, isAnimated = false) => {
    // packedData: Bits 0-3 (Sun), Bits 4-7 (Blk), Bits 8-9 (AO), Bits 10-17 (TexId), Bit 18 (isAnimated)
    const p0 = (sun & 15) | ((blk & 15) << 4) | ((ao0 & 3) << 8) | ((texId & 255) << 10) | ((isAnimated ? 1 : 0) << 18);
    const p1 = (sun & 15) | ((blk & 15) << 4) | ((ao1 & 3) << 8) | ((texId & 255) << 10) | ((isAnimated ? 1 : 0) << 18);
    const p2 = (sun & 15) | ((blk & 15) << 4) | ((ao2 & 3) << 8) | ((texId & 255) << 10) | ((isAnimated ? 1 : 0) << 18);
    const p3 = (sun & 15) | ((blk & 15) << 4) | ((ao3 & 3) << 8) | ((texId & 255) << 10) | ((isAnimated ? 1 : 0) << 18);
    
    // The x, y, z arguments are ALREADY global coordinates! Do not double-apply cx/cz!
    const wx = x;
    const wy = y;
    const wz = z;

    if (wx < minX) minX = wx; if (wy < minY) minY = wy; if (wz < minZ) minZ = wz;
    if (wx > maxX) maxX = wx; if (wy > maxY) maxY = wy; if (wz > maxZ) maxZ = wz;

    let pArr = isTrans ? tPos : sPos;
    let nArr = isTrans ? tNorm : sNorm;
    let cArr = isTrans ? tColor : sColor;
    let uArr = isTrans ? tUv : sUv;
    let iArr = isTrans ? tIdx : sIdx;
    let offset = isTrans ? tIndexOffset : sIndexOffset;

    // A simple quad
    let v0, v1, v2, v3;
    let uv0, uv1, uv2, uv3;

    if (ny === 1) { // Top
      v0 = [wx, wy+1, wz+1]; v1 = [wx+1, wy+1, wz+1]; v2 = [wx+1, wy+1, wz]; v3 = [wx, wy+1, wz];
      uv0 = [0, 0]; uv1 = [1, 0]; uv2 = [1, 1]; uv3 = [0, 1];
    } else if (ny === -1) { // Bottom
      v0 = [wx, wy, wz]; v1 = [wx+1, wy, wz]; v2 = [wx+1, wy, wz+1]; v3 = [wx, wy, wz+1];
      uv0 = [0, 0]; uv1 = [1, 0]; uv2 = [1, 1]; uv3 = [0, 1];
    } else if (nx === 1) { // Right
      v0 = [wx+1, wy, wz+1]; v1 = [wx+1, wy, wz]; v2 = [wx+1, wy+1, wz]; v3 = [wx+1, wy+1, wz+1];
      uv0 = [0, 0]; uv1 = [1, 0]; uv2 = [1, 1]; uv3 = [0, 1];
    } else if (nx === -1) { // Left
      v0 = [wx, wy, wz]; v1 = [wx, wy, wz+1]; v2 = [wx, wy+1, wz+1]; v3 = [wx, wy+1, wz];
      uv0 = [0, 0]; uv1 = [1, 0]; uv2 = [1, 1]; uv3 = [0, 1];
    } else if (nz === 1) { // Front
      v0 = [wx, wy, wz+1]; v1 = [wx+1, wy, wz+1]; v2 = [wx+1, wy+1, wz+1]; v3 = [wx, wy+1, wz+1];
      uv0 = [0, 0]; uv1 = [1, 0]; uv2 = [1, 1]; uv3 = [0, 1];
    } else if (nz === -1) { // Back
      v0 = [wx+1, wy, wz]; v1 = [wx, wy, wz]; v2 = [wx, wy+1, wz]; v3 = [wx+1, wy+1, wz];
      uv0 = [0, 0]; uv1 = [1, 0]; uv2 = [1, 1]; uv3 = [0, 1];
    }

    pArr.push(...v0, ...v1, ...v2, ...v3);
    nArr.push(nx,ny,nz, nx,ny,nz, nx,ny,nz, nx,ny,nz);
    cArr.push(p0, p1, p2, p3);
    uArr.push(...uv0, ...uv1, ...uv2, ...uv3);
    iArr.push(offset, offset+1, offset+2, offset, offset+2, offset+3);
    
    if (!isPassable) {
      pPos.push(...v0, ...v1, ...v2, ...v3);
      pIdx.push(pIndexOffset, pIndexOffset+1, pIndexOffset+2, pIndexOffset, pIndexOffset+2, pIndexOffset+3);
      pIndexOffset += 4;
    }

    if (isTrans) tIndexOffset += 4; else sIndexOffset += 4;
  };

  const getBlock = (x, y, z) => {
    if (x < 0 || x > 15 || z < 0 || z > 15 || y < CHUNK_Y_MIN || y > CHUNK_Y_MAX) {
      return getGlobalBlockVal(cx, cz, buffer, neighborBuffers, cx * 16 + x, y, cz * 16 + z);
    }
    return buffer[getIndex(x, y, z)];
  };

  const isSolid = (x, y, z, dx, dy, dz) => {
      const v = getBlock(x + dx, y + dy, z + dz);
      const id = getTextureId(v);
      if (id === 0) return 0;
      const d = BlockById[id];
      return (d && !d.isTransparent) ? 1 : 0;
  };

  const calcAO = (x, y, z, dx1, dy1, dz1, dx2, dy2, dz2, dx3, dy3, dz3) => {
      const s1 = isSolid(x, y, z, dx1, dy1, dz1);
      const s2 = isSolid(x, y, z, dx2, dy2, dz2);
      const c = isSolid(x, y, z, dx3, dy3, dz3);
      if (s1 === 1 && s2 === 1) return 0;
      return 3 - (s1 + s2 + c);
  };

  // Naive Meshing for now
  for (let y = CHUNK_Y_MIN; y <= CHUNK_Y_MAX; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const val = buffer[getIndex(x, y, z)];
        const blockId = getTextureId(val); // This actually returns the Block ID, not Texture ID!
        if (blockId === 0) continue; // Air

        const isHidden = getIsHidden(val);
        if (isHidden) continue; // Occlusion culled

        const sun = getSunlight(val);
        const blk = getBlockLight(val);

        const blockDef = BlockById[blockId];

        if (blockDef?.isFlora) {
            // InstancedMesh Flora extraction (skip Greedy Cube meshing!)
            const globalLight = getGlobalBlockLight(cx, cz, buffer, neighborBuffers, null, cx * 16 + x, y, cz * 16 + z);
            const nSun = getSunlight(globalLight);
            const nBlk = getBlockLight(globalLight);
            floraArr.push(cx * 16 + x, y, cz * 16 + z, blockId, nSun, nBlk); // Use world coordinates!
            continue;
        }

        const isTrans = blockDef ? !!blockDef.isTransparent : false;
        const isPassable = blockDef ? !!blockDef.isPassable : false;
        
        // Check 6 neighbors
        const neighbors = [
          { nx: 0, ny: 1, nz: 0 },
          { nx: 0, ny: -1, nz: 0 },
          { nx: 1, ny: 0, nz: 0 },
          { nx: -1, ny: 0, nz: 0 },
          { nx: 0, ny: 0, nz: 1 },
          { nx: 0, ny: 0, nz: -1 }
        ];

        for (let n of neighbors) {
          const nVal = getBlock(x + n.nx, y + n.ny, z + n.nz);
          const nBlockId = getTextureId(nVal); // getTextureId returns Block ID
          
          let drawFace = false;
          if (nBlockId === 0) drawFace = true;
          else {
              const nBlockDef = BlockById[nBlockId];
              const nIsTrans = nBlockDef ? !!nBlockDef.isTransparent : false;
              if (nIsTrans && !isTrans) drawFace = true;
              else if (isTrans && nIsTrans && blockId !== nBlockId) drawFace = true;
          }

          if (drawFace) {
             const nSun = getSunlight(nVal) || sun;
             let faceTexId = blockId;
             if (blockDef && blockDef.textures) {
                if (n.ny === 1) faceTexId = FaceMappings[blockId].top;
                else if (n.ny === -1) faceTexId = FaceMappings[blockId].bottom;
                else faceTexId = FaceMappings[blockId].side;
             }

             // Get lighting for the block IN FRONT of the face
             const gx = cx * 16 + x + n.nx;
             const gy = y + n.ny;
             const gz = cz * 16 + z + n.nz;
             let globalLight = getGlobalBlockLight(cx, cz, buffer, neighborBuffers, null, gx, gy, gz);
             
             let faceSun = getSunlight(globalLight);
             let faceBlk = getBlockLight(globalLight);

             // If neighbor is fully opaque, we use OUR light so it's not pitch black (failsafe)
             const nDef = BlockById[nBlockId];
             if (nBlockId !== 0 && nDef && !nDef.isTransparent) {
                const selfLight = getGlobalBlockLight(cx, cz, buffer, neighborBuffers, null, cx * 16 + x, y, cz * 16 + z);
                faceSun = getSunlight(selfLight);
                faceBlk = getBlockLight(selfLight);
             }
             
             const isAnimated = blockId === 18 || blockId === 19; // Water (18) and Lava (19)
             const isPassable = blockDef ? !!blockDef.isPassable : false;
             
             let ao0 = 3, ao1 = 3, ao2 = 3, ao3 = 3;
             if (n.ny === 1) {
                 ao0 = calcAO(x, y, z, -1, 1, 0, 0, 1, 1, -1, 1, 1);
                 ao1 = calcAO(x, y, z, 1, 1, 0, 0, 1, 1, 1, 1, 1);
                 ao2 = calcAO(x, y, z, 1, 1, 0, 0, 1, -1, 1, 1, -1);
                 ao3 = calcAO(x, y, z, -1, 1, 0, 0, 1, -1, -1, 1, -1);
             } else if (n.ny === -1) {
                 ao0 = calcAO(x, y, z, -1, -1, 0, 0, -1, -1, -1, -1, -1);
                 ao1 = calcAO(x, y, z, 1, -1, 0, 0, -1, -1, 1, -1, -1);
                 ao2 = calcAO(x, y, z, 1, -1, 0, 0, -1, 1, 1, -1, 1);
                 ao3 = calcAO(x, y, z, -1, -1, 0, 0, -1, 1, -1, -1, 1);
             } else if (n.nx === 1) {
                 ao0 = calcAO(x, y, z, 1, 0, 1, 1, -1, 0, 1, -1, 1);
                 ao1 = calcAO(x, y, z, 1, 0, -1, 1, -1, 0, 1, -1, -1);
                 ao2 = calcAO(x, y, z, 1, 0, -1, 1, 1, 0, 1, 1, -1);
                 ao3 = calcAO(x, y, z, 1, 0, 1, 1, 1, 0, 1, 1, 1);
             } else if (n.nx === -1) {
                 ao0 = calcAO(x, y, z, -1, 0, -1, -1, -1, 0, -1, -1, -1);
                 ao1 = calcAO(x, y, z, -1, 0, 1, -1, -1, 0, -1, -1, 1);
                 ao2 = calcAO(x, y, z, -1, 0, 1, -1, 1, 0, -1, 1, 1);
                 ao3 = calcAO(x, y, z, -1, 0, -1, -1, 1, 0, -1, 1, -1);
             } else if (n.nz === 1) {
                 ao0 = calcAO(x, y, z, -1, 0, 1, 0, -1, 1, -1, -1, 1);
                 ao1 = calcAO(x, y, z, 1, 0, 1, 0, -1, 1, 1, -1, 1);
                 ao2 = calcAO(x, y, z, 1, 0, 1, 0, 1, 1, 1, 1, 1);
                 ao3 = calcAO(x, y, z, -1, 0, 1, 0, 1, 1, -1, 1, 1);
             } else if (n.nz === -1) {
                 ao0 = calcAO(x, y, z, 1, 0, -1, 0, -1, -1, 1, -1, -1);
                 ao1 = calcAO(x, y, z, -1, 0, -1, 0, -1, -1, -1, -1, -1);
                 ao2 = calcAO(x, y, z, -1, 0, -1, 0, 1, -1, -1, 1, -1);
                 ao3 = calcAO(x, y, z, 1, 0, -1, 0, 1, -1, 1, 1, -1);
             }

             pushFace(cx * 16 + x, y, cz * 16 + z, n.nx, n.ny, n.nz, faceTexId, isTrans, isPassable, faceSun, faceBlk, ao0, ao1, ao2, ao3, isAnimated);
          }
        }
      }
    }
  }

  return {
    solid: {
      pos: new Float32Array(sPos),
      norm: new Float32Array(sNorm),
      color: new Float32Array(sColor),
      uv: new Float32Array(sUv),
      idx: new Uint32Array(sIdx)
    },
    transparent: {
      pos: new Float32Array(tPos),
      norm: new Float32Array(tNorm),
      color: new Float32Array(tColor),
      uv: new Float32Array(tUv),
      idx: new Uint32Array(tIdx)
    },
    __physics: {
      pos: new Float32Array(pPos),
      idx: new Uint32Array(pIdx)
    },
    __flora: new Float32Array(floraArr),
    __meta: {
      boundingBox: minX === Infinity ? null : { min: [minX, minY, minZ], max: [maxX+1, maxY+1, maxZ+1] }
    }
  };
};
