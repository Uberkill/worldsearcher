import {
  CHUNK_Y_MIN,
  CHUNK_Y_MAX,
  CHUNK_SIZE_X,
  CHUNK_SIZE_Z,
  getIndex,
  getGlobalBlockVal,
  getTextureId,
  getIsHidden,
  getBlockLight,
  getGlobalBlockLight,
} from './chunkData';
import type { NeighborBuffer, ChunkMeshArrays } from '../types/world';

const NEIGHBORS = [
  { nx: 0, ny: 1, nz: 0 },
  { nx: 0, ny: -1, nz: 0 },
  { nx: 1, ny: 0, nz: 0 },
  { nx: -1, ny: 0, nz: 0 },
  { nx: 0, ny: 0, nz: 1 },
  { nx: 0, ny: 0, nz: -1 },
] as const;

const NEIGHBOR_OFFSETS = [
  256,  // Top: ny = 1
  -256, // Bottom: ny = -1
  1,    // Right: nx = 1
  -1,   // Left: nx = -1
  16,   // Front: nz = 1
  -16,  // Back: nz = -1
] as const;

// Pre-allocated static buffers (60k faces max per sub-chunk, drastically reduces memory!)
const MAX_FACES = 60000;
const sPosBuffer = new Float32Array(MAX_FACES * 12);
const sNormBuffer = new Float32Array(MAX_FACES * 12);
const sColorBuffer = new Float32Array(MAX_FACES * 4);
const sUvBuffer = new Float32Array(MAX_FACES * 8);
const sIdxBuffer = new Uint32Array(MAX_FACES * 6);

const tPosBuffer = new Float32Array(MAX_FACES * 12);
const tNormBuffer = new Float32Array(MAX_FACES * 12);
const tColorBuffer = new Float32Array(MAX_FACES * 4);
const tUvBuffer = new Float32Array(MAX_FACES * 8);
const tIdxBuffer = new Uint32Array(MAX_FACES * 6);

const pPosBuffer = new Float32Array(MAX_FACES * 12);
const pIdxBuffer = new Uint32Array(MAX_FACES * 6);

const floraMatricesBuffer = new Float32Array(MAX_FACES * 16);
const floraPackedBuffer = new Float32Array(MAX_FACES);

export const buildGreedyArrays = (buffer: Uint32Array, cx: number, cz: number, neighborBuffers: NeighborBuffer[] | null | undefined, recycledBufferBuckets: Record<number, ArrayBuffer[]> | null = null, SolidLookup: Uint8Array, FluidLookup: Uint8Array, TextureLookup: Uint16Array, FloraLookup: Uint8Array, TransparentLookup: Uint8Array): ChunkMeshArrays => {
  const result = {
    solid: [],
    transparent: [],
    __physics: [],
    __flora: null,
    __meta: { boundingBox: null }
  };

  let sPosIndex = 0, sNormIndex = 0, sColorIndex = 0, sUvIndex = 0, sIdxIndex = 0;
  let tPosIndex = 0, tNormIndex = 0, tColorIndex = 0, tUvIndex = 0, tIdxIndex = 0;
  let pPosIndex = 0, pIdxIndex = 0;
  let floraMatricesIndex = 0, floraPackedIndex = 0;

  let sIndexOffset = 0, tIndexOffset = 0, pIndexOffset = 0;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  const createFaceNode = () => ({ active: false, x: 0, y: 0, z: 0, w: 0, p0: 0, texId: 0, isAnimated: false, isPassable: false, posIndex: 0, uvIndex: 0, pPosIndex: 0 });
  const lastFaces = {
    solid: { top: createFaceNode(), bottom: createFaceNode(), front: createFaceNode(), back: createFaceNode() },
    transparent: { top: createFaceNode(), bottom: createFaceNode(), front: createFaceNode(), back: createFaceNode() }
  };
  const resetLastFaces = () => {
    lastFaces.solid.top.active = false; lastFaces.solid.bottom.active = false; lastFaces.solid.front.active = false; lastFaces.solid.back.active = false;
    lastFaces.transparent.top.active = false; lastFaces.transparent.bottom.active = false; lastFaces.transparent.front.active = false; lastFaces.transparent.back.active = false;
  };

  const copyToBuffer = (staticArray, count, TypedArrayClass) => {
    const bytesNeeded = count * TypedArrayClass.BYTES_PER_ELEMENT;
    if (count === 0) return new TypedArrayClass(0);
    
    let sizeBytes = 256;
    while (sizeBytes < bytesNeeded) sizeBytes <<= 1;
    
    let buf = null;
    if (recycledBufferBuckets) {
       let pow = 256;
       while (pow < sizeBytes) pow <<= 1;
       
       while (pow <= 16777216) {
          if (recycledBufferBuckets[pow] && recycledBufferBuckets[pow].length > 0) {
             buf = recycledBufferBuckets[pow].pop();
             break;
          }
          pow <<= 1;
       }
    }
    
    if (!buf) buf = new ArrayBuffer(sizeBytes);
    
    const view = new TypedArrayClass(buf, 0, count);
    view.set(staticArray.subarray(0, count));
    return view;
  };

  const flushBuffers = () => {
    if (sPosIndex > 0) {
      result.solid.push({
        pos: copyToBuffer(sPosBuffer, sPosIndex, Float32Array),
        norm: copyToBuffer(sNormBuffer, sNormIndex, Float32Array),
        color: copyToBuffer(sColorBuffer, sColorIndex, Float32Array),
        uv: copyToBuffer(sUvBuffer, sUvIndex, Float32Array),
        idx: copyToBuffer(sIdxBuffer, sIdxIndex, Uint32Array),
      });
      sPosIndex = 0; sNormIndex = 0; sColorIndex = 0; sUvIndex = 0; sIdxIndex = 0; sIndexOffset = 0;
    }
    if (tPosIndex > 0) {
      result.transparent.push({
        pos: copyToBuffer(tPosBuffer, tPosIndex, Float32Array),
        norm: copyToBuffer(tNormBuffer, tNormIndex, Float32Array),
        color: copyToBuffer(tColorBuffer, tColorIndex, Float32Array),
        uv: copyToBuffer(tUvBuffer, tUvIndex, Float32Array),
        idx: copyToBuffer(tIdxBuffer, tIdxIndex, Uint32Array),
      });
      tPosIndex = 0; tNormIndex = 0; tColorIndex = 0; tUvIndex = 0; tIdxIndex = 0; tIndexOffset = 0;
    }
    if (pPosIndex > 0) {
      result.__physics.push({
        pos: copyToBuffer(pPosBuffer, pPosIndex, Float32Array),
        idx: copyToBuffer(pIdxBuffer, pIdxIndex, Uint32Array),
      });
      pPosIndex = 0; pIdxIndex = 0; pIndexOffset = 0;
    }
    
    const keys = ['top', 'bottom', 'front', 'back'];
    for (let i = 0; i < keys.length; i++) {
      lastFaces.solid[keys[i]].active = false;
      lastFaces.transparent[keys[i]].active = false;
    }
  };


  /**
   * [ARCHITECTURAL CONSTRAINT: DO NOT TOUCH]
   * Why is this "Naive" meshing instead of True Greedy Meshing (merging faces)?
   *
   * True greedy meshing merges adjacent block faces into large quads to reduce vertices.
   * However, this engine bakes Sunlight (4 bits), BlockLight (4 bits), and Ambient Occlusion (2 bits)
   * into a single 32-bit integer per vertex (p0, p1, p2, p3).
   *
   * If faces were merged across multiple blocks, the shader would linearly interpolate the lighting
   * across the giant quad, completely erasing per-block shadow steps and AO gradients.
   * To support per-vertex AO and block-level lighting without dynamic VRAM texture atlases,
   * Naive Meshing (with backface culling) is the *only* mathematically correct approach here.
   */
  const pushFace = (
    x,
    y,
    z,
    nx,
    ny,
    nz,
    texId,
    isTrans,
    isPassable,
    sun,
    blk,
    ao0,
    ao1,
    ao2,
    ao3,
    isAnimated = false,
    customY0 = 1,
    customY1 = 1,
    customY2 = 1,
    customY3 = 1
  ) => {
    // packedData: Bits 0-3 (Sun), Bits 4-7 (Blk), Bits 8-9 (AO), Bits 10-17 (TexId), Bit 18 (isAnimated)
    const p0 =
      (sun & 15) |
      ((blk & 15) << 4) |
      ((ao0 & 3) << 8) |
      ((texId & 255) << 10) |
      ((isAnimated ? 1 : 0) << 18);
    const p1 =
      (sun & 15) |
      ((blk & 15) << 4) |
      ((ao1 & 3) << 8) |
      ((texId & 255) << 10) |
      ((isAnimated ? 1 : 0) << 18);
    const p2 =
      (sun & 15) |
      ((blk & 15) << 4) |
      ((ao2 & 3) << 8) |
      ((texId & 255) << 10) |
      ((isAnimated ? 1 : 0) << 18);
    const p3 =
      (sun & 15) |
      ((blk & 15) << 4) |
      ((ao3 & 3) << 8) |
      ((texId & 255) << 10) |
      ((isAnimated ? 1 : 0) << 18);

    // The x, y, z arguments are ALREADY global coordinates! Do not double-apply cx/cz!
    const wx = x;
    const wy = y;
    const wz = z;

    if (wx < minX) minX = wx;
    if (wy < minY) minY = wy;
    if (wz < minZ) minZ = wz;
    if (wx > maxX) maxX = wx;
    if (wy > maxY) maxY = wy;
    if (wz > maxZ) maxZ = wz;

    // --- STRICT GREEDY MESHING (Run-Length Encoding along X) ---
    const isMergeable = (p0 === p1 && p1 === p2 && p2 === p3) && (customY0 === 1 && customY1 === 1 && customY2 === 1 && customY3 === 1);
    const faceKey = (ny === 1 ? 'top' : ny === -1 ? 'bottom' : nz === 1 ? 'front' : nz === -1 ? 'back' : null) as 'top' | 'bottom' | 'front' | 'back' | null;
    const arrayGroup = isTrans ? lastFaces.transparent : lastFaces.solid;

    if (isMergeable && faceKey) {
      const prev = arrayGroup[faceKey];
      if (prev.active && prev.y === wy && prev.z === wz && prev.x + prev.w === wx && prev.p0 === p0 && prev.texId === texId && prev.isAnimated === isAnimated && prev.isPassable === isPassable) {
        // MATCH! Extend the quad along X
        prev.w += 1;
        const w = prev.w;
        
        // Update vertices in buffers directly!
        const sPosBuf = isTrans ? tPosBuffer : sPosBuffer;
        const sUvBuf = isTrans ? tUvBuffer : sUvBuffer;
        
        if (ny === 1 || ny === -1 || nz === 1) {
          sPosBuf[prev.posIndex + 3] = wx + 1;
          sPosBuf[prev.posIndex + 6] = wx + 1;
        } else if (nz === -1) {
          sPosBuf[prev.posIndex + 0] = wx + 1;
          sPosBuf[prev.posIndex + 9] = wx + 1;
        }
        
        if (ny === 1 || ny === -1 || nz === 1) {
          sUvBuf[prev.uvIndex + 2] = w;
          sUvBuf[prev.uvIndex + 4] = w;
        } else if (nz === -1) {
          sUvBuf[prev.uvIndex + 0] = 1 - w;
          sUvBuf[prev.uvIndex + 6] = 1 - w;
        }
        
        if (!isPassable && prev.pPosIndex !== -1) {
          if (ny === 1 || ny === -1 || nz === 1) {
            pPosBuffer[prev.pPosIndex + 3] = wx + 1;
            pPosBuffer[prev.pPosIndex + 6] = wx + 1;
          } else if (nz === -1) {
            pPosBuffer[prev.pPosIndex + 0] = wx + 1;
            pPosBuffer[prev.pPosIndex + 9] = wx + 1;
          }
        }
        
        return; // Skip the rest of pushFace!
      }
    }

    // A simple quad - direct array pushing to avoid GC allocations
    let px0, py0, pz0, px1, py1, pz1, px2, py2, pz2, px3, py3, pz3;

    if (ny === 1) {
      // Top
      px0 = wx;
      py0 = wy + customY0;
      pz0 = wz + 1;
      px1 = wx + 1;
      py1 = wy + customY1;
      pz1 = wz + 1;
      px2 = wx + 1;
      py2 = wy + customY2;
      pz2 = wz;
      px3 = wx;
      py3 = wy + customY3;
      pz3 = wz;
    } else if (ny === -1) {
      // Bottom
      px0 = wx;
      py0 = wy;
      pz0 = wz;
      px1 = wx + 1;
      py1 = wy;
      pz1 = wz;
      px2 = wx + 1;
      py2 = wy;
      pz2 = wz + 1;
      px3 = wx;
      py3 = wy;
      pz3 = wz + 1;
    } else if (nx === 1) {
      // Right
      px0 = wx + 1;
      py0 = wy;
      pz0 = wz + 1;
      px1 = wx + 1;
      py1 = wy;
      pz1 = wz;
      px2 = wx + 1;
      py2 = wy + 1;
      pz2 = wz;
      px3 = wx + 1;
      py3 = wy + 1;
      pz3 = wz + 1;
    } else if (nx === -1) {
      // Left
      px0 = wx;
      py0 = wy;
      pz0 = wz;
      px1 = wx;
      py1 = wy;
      pz1 = wz + 1;
      px2 = wx;
      py2 = wy + 1;
      pz2 = wz + 1;
      px3 = wx;
      py3 = wy + 1;
      pz3 = wz;
    } else if (nz === 1) {
      // Front
      px0 = wx;
      py0 = wy;
      pz0 = wz + 1;
      px1 = wx + 1;
      py1 = wy;
      pz1 = wz + 1;
      px2 = wx + 1;
      py2 = wy + 1;
      pz2 = wz + 1;
      px3 = wx;
      py3 = wy + 1;
      pz3 = wz + 1;
    } else if (nz === -1) {
      // Back
      px0 = wx + 1;
      py0 = wy;
      pz0 = wz;
      px1 = wx;
      py1 = wy;
      pz1 = wz;
      px2 = wx;
      py2 = wy + 1;
      pz2 = wz;
      px3 = wx + 1;
      py3 = wy + 1;
      pz3 = wz;
    }

    if (isTrans) {
      if (tPosIndex >= MAX_FACES * 12) return; // Safeguard
      tPosBuffer[tPosIndex++] = px0;
      tPosBuffer[tPosIndex++] = py0;
      tPosBuffer[tPosIndex++] = pz0;
      tPosBuffer[tPosIndex++] = px1;
      tPosBuffer[tPosIndex++] = py1;
      tPosBuffer[tPosIndex++] = pz1;
      tPosBuffer[tPosIndex++] = px2;
      tPosBuffer[tPosIndex++] = py2;
      tPosBuffer[tPosIndex++] = pz2;
      tPosBuffer[tPosIndex++] = px3;
      tPosBuffer[tPosIndex++] = py3;
      tPosBuffer[tPosIndex++] = pz3;

      tNormBuffer[tNormIndex++] = nx;
      tNormBuffer[tNormIndex++] = ny;
      tNormBuffer[tNormIndex++] = nz;
      tNormBuffer[tNormIndex++] = nx;
      tNormBuffer[tNormIndex++] = ny;
      tNormBuffer[tNormIndex++] = nz;
      tNormBuffer[tNormIndex++] = nx;
      tNormBuffer[tNormIndex++] = ny;
      tNormBuffer[tNormIndex++] = nz;
      tNormBuffer[tNormIndex++] = nx;
      tNormBuffer[tNormIndex++] = ny;
      tNormBuffer[tNormIndex++] = nz;

      tColorBuffer[tColorIndex++] = p0;
      tColorBuffer[tColorIndex++] = p1;
      tColorBuffer[tColorIndex++] = p2;
      tColorBuffer[tColorIndex++] = p3;

      tUvBuffer[tUvIndex++] = 0;
      tUvBuffer[tUvIndex++] = 0;
      tUvBuffer[tUvIndex++] = 1;
      tUvBuffer[tUvIndex++] = 0;
      tUvBuffer[tUvIndex++] = 1;
      tUvBuffer[tUvIndex++] = 1;
      tUvBuffer[tUvIndex++] = 0;
      tUvBuffer[tUvIndex++] = 1;

      tIdxBuffer[tIdxIndex++] = tIndexOffset;
      tIdxBuffer[tIdxIndex++] = tIndexOffset + 1;
      tIdxBuffer[tIdxIndex++] = tIndexOffset + 2;
      tIdxBuffer[tIdxIndex++] = tIndexOffset;
      tIdxBuffer[tIdxIndex++] = tIndexOffset + 2;
      tIdxBuffer[tIdxIndex++] = tIndexOffset + 3;

      tIndexOffset += 4;
    } else {
      if (sPosIndex >= MAX_FACES * 12) return; // Safeguard
      sPosBuffer[sPosIndex++] = px0;
      sPosBuffer[sPosIndex++] = py0;
      sPosBuffer[sPosIndex++] = pz0;
      sPosBuffer[sPosIndex++] = px1;
      sPosBuffer[sPosIndex++] = py1;
      sPosBuffer[sPosIndex++] = pz1;
      sPosBuffer[sPosIndex++] = px2;
      sPosBuffer[sPosIndex++] = py2;
      sPosBuffer[sPosIndex++] = pz2;
      sPosBuffer[sPosIndex++] = px3;
      sPosBuffer[sPosIndex++] = py3;
      sPosBuffer[sPosIndex++] = pz3;

      sNormBuffer[sNormIndex++] = nx;
      sNormBuffer[sNormIndex++] = ny;
      sNormBuffer[sNormIndex++] = nz;
      sNormBuffer[sNormIndex++] = nx;
      sNormBuffer[sNormIndex++] = ny;
      sNormBuffer[sNormIndex++] = nz;
      sNormBuffer[sNormIndex++] = nx;
      sNormBuffer[sNormIndex++] = ny;
      sNormBuffer[sNormIndex++] = nz;
      sNormBuffer[sNormIndex++] = nx;
      sNormBuffer[sNormIndex++] = ny;
      sNormBuffer[sNormIndex++] = nz;

      sColorBuffer[sColorIndex++] = p0;
      sColorBuffer[sColorIndex++] = p1;
      sColorBuffer[sColorIndex++] = p2;
      sColorBuffer[sColorIndex++] = p3;

      sUvBuffer[sUvIndex++] = 0;
      sUvBuffer[sUvIndex++] = 0;
      sUvBuffer[sUvIndex++] = 1;
      sUvBuffer[sUvIndex++] = 0;
      sUvBuffer[sUvIndex++] = 1;
      sUvBuffer[sUvIndex++] = 1;
      sUvBuffer[sUvIndex++] = 0;
      sUvBuffer[sUvIndex++] = 1;

      sIdxBuffer[sIdxIndex++] = sIndexOffset;
      sIdxBuffer[sIdxIndex++] = sIndexOffset + 1;
      sIdxBuffer[sIdxIndex++] = sIndexOffset + 2;
      sIdxBuffer[sIdxIndex++] = sIndexOffset;
      sIdxBuffer[sIdxIndex++] = sIndexOffset + 2;
      sIdxBuffer[sIdxIndex++] = sIndexOffset + 3;

      sIndexOffset += 4;
    }

    if (!isPassable) {
      if (pPosIndex >= MAX_FACES * 12) return;
      pPosBuffer[pPosIndex++] = px0;
      pPosBuffer[pPosIndex++] = py0;
      pPosBuffer[pPosIndex++] = pz0;
      pPosBuffer[pPosIndex++] = px1;
      pPosBuffer[pPosIndex++] = py1;
      pPosBuffer[pPosIndex++] = pz1;
      pPosBuffer[pPosIndex++] = px2;
      pPosBuffer[pPosIndex++] = py2;
      pPosBuffer[pPosIndex++] = pz2;
      pPosBuffer[pPosIndex++] = px3;
      pPosBuffer[pPosIndex++] = py3;
      pPosBuffer[pPosIndex++] = pz3;

      pIdxBuffer[pIdxIndex++] = pIndexOffset;
      pIdxBuffer[pIdxIndex++] = pIndexOffset + 1;
      pIdxBuffer[pIdxIndex++] = pIndexOffset + 2;
      pIdxBuffer[pIdxIndex++] = pIndexOffset;
      pIdxBuffer[pIdxIndex++] = pIndexOffset + 2;
      pIdxBuffer[pIdxIndex++] = pIndexOffset + 3;

      pIndexOffset += 4;
    }

    // --- STRICT GREEDY MESHING (Cache update) ---
    if (isMergeable && faceKey) {
      const prev = arrayGroup[faceKey];
      prev.active = true;
      prev.x = wx;
      prev.y = wy;
      prev.z = wz;
      prev.w = 1;
      prev.p0 = p0;
      prev.texId = texId;
      prev.isAnimated = isAnimated;
      prev.isPassable = isPassable;
      prev.posIndex = isTrans ? tPosIndex - 12 : sPosIndex - 12;
      prev.uvIndex = isTrans ? tUvIndex - 8 : sUvIndex - 8;
      prev.pPosIndex = !isPassable ? pPosIndex - 12 : -1;
    } else if (faceKey) {
      arrayGroup[faceKey].active = false;
    }
  };

  const getBlock = (x, y, z) => {
    if (
      x < 0 ||
      x >= CHUNK_SIZE_X ||
      z < 0 ||
      z >= CHUNK_SIZE_Z ||
      y < CHUNK_Y_MIN ||
      y > CHUNK_Y_MAX
    ) {
      return getGlobalBlockVal(
        cx,
        cz,
        buffer,
        neighborBuffers,
        cx * CHUNK_SIZE_X + x,
        y,
        cz * CHUNK_SIZE_Z + z
      );
    }
    return buffer[getIndex(x, y, z)];
  };

  const isSolid = (lx, ly, lz, idx, dx, dy, dz) => {
    const nx = lx + dx;
    const ny = ly + dy;
    const nz = lz + dz;
    if (nx >= 0 && nx < 16 && nz >= 0 && nz < 16 && ny >= CHUNK_Y_MIN && ny <= CHUNK_Y_MAX) {
      const v = buffer[idx + dy * 256 + dz * 16 + dx];
      const id = v & 0xff;
      if (id === 0) return 0;
      return SolidLookup[id];
    }
    const v = getGlobalBlockVal(cx, cz, buffer, neighborBuffers, cx * 16 + nx, ny, cz * 16 + nz);
    const id = v & 0xff;
    if (id === 0) return 0;
    return SolidLookup[id];
  };

  const getFluidLevel = (x, y, z) => {
    const val = getBlock(x, y, z);
    const id = getTextureId(val);
    if (id === 0 || FluidLookup[id] === 0) return -1;
    return (val >> 17) & 0xf;
  };

  const calcFluidCorner = (x, y, z, dx, dz) => {
    // A corner is shared by 4 blocks: (0,0), (dx,0), (0,dz), (dx,dz)
    // We average their levels if they are fluids.
    let sum = 0;
    let count = 0;
    
    // Check block itself
    let lvl = getFluidLevel(x, y, z);
    if (lvl === 15) return 1.0; // Source block or falling stream is full height
    if (lvl >= 0) { sum += lvl; count++; }

    // Check dx
    lvl = getFluidLevel(x + dx, y, z);
    if (lvl === 15) return 1.0;
    if (lvl >= 0) { sum += lvl; count++; }

    // Check dz
    lvl = getFluidLevel(x, y, z + dz);
    if (lvl === 15) return 1.0;
    if (lvl >= 0) { sum += lvl; count++; }

    // Check diagonal
    lvl = getFluidLevel(x + dx, y, z + dz);
    if (lvl === 15) return 1.0;
    if (lvl >= 0) { sum += lvl; count++; }

    if (count === 0) return 0.1; // fallback
    return (sum / count) / 15.0;
  };

  const calcAO = (lx, ly, lz, idx, dx1, dy1, dz1, dx2, dy2, dz2, dx3, dy3, dz3) => {
    const s1 = isSolid(lx, ly, lz, idx, dx1, dy1, dz1);
    const s2 = isSolid(lx, ly, lz, idx, dx2, dy2, dz2);
    const c = isSolid(lx, ly, lz, idx, dx3, dy3, dz3);
    if (s1 === 1 && s2 === 1) return 0;
    return 3 - (s1 + s2 + c);
  };

  // Naive Meshing for now
  for (let y = CHUNK_Y_MIN; y <= CHUNK_Y_MAX; y++) {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      // Flush with a 200 face margin inside the Z loop to prevent buffer overflow (which causes missing chunk holes)
      if (sPosIndex > (MAX_FACES - 200) * 12 || tPosIndex > (MAX_FACES - 200) * 12 || pPosIndex > (MAX_FACES - 200) * 12) {
        flushBuffers();
      }
      resetLastFaces();
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        const idx = getIndex(x, y, z);
        const val = buffer[idx];
        const blockId = getTextureId(val); // This actually returns the Block ID, not Texture ID!
        if (blockId === 0) continue; // Air

        const isHidden = getIsHidden(val);
        if (isHidden) continue; // Occlusion culled


        getBlockLight(val);

        if (FloraLookup[blockId] === 1) {
          // InstancedMesh Flora extraction: own block light
          const globalLight = val;
          const nSun = (globalLight >> 26) & 0xf;
          const nBlk = (globalLight >> 22) & 0xf;

          const wx = cx * CHUNK_SIZE_X + x;
          const wy = y;
          const wz = cz * CHUNK_SIZE_Z + z;

          const hash =
            Math.abs(Math.sin(wx * 12.9898 + wz * 78.233)) * 43758.5453;
          const rng = hash - Math.floor(hash);

          const tx = wx + 0.5 + (rng - 0.5) * 0.5;
          const ty = wy;
          const tz = wz + 0.5 + (((rng * 1.5) % 1) - 0.5) * 0.5;

          const ry = rng * Math.PI;
          const c = Math.cos(ry);
          const s = Math.sin(ry);

          if (floraMatricesIndex < MAX_FACES * 16) {
            floraMatricesBuffer[floraMatricesIndex++] = c;
            floraMatricesBuffer[floraMatricesIndex++] = 0;
            floraMatricesBuffer[floraMatricesIndex++] = -s;
            floraMatricesBuffer[floraMatricesIndex++] = 0;

            floraMatricesBuffer[floraMatricesIndex++] = 0;
            floraMatricesBuffer[floraMatricesIndex++] = 1;
            floraMatricesBuffer[floraMatricesIndex++] = 0;
            floraMatricesBuffer[floraMatricesIndex++] = 0;

            floraMatricesBuffer[floraMatricesIndex++] = s;
            floraMatricesBuffer[floraMatricesIndex++] = 0;
            floraMatricesBuffer[floraMatricesIndex++] = c;
            floraMatricesBuffer[floraMatricesIndex++] = 0;

            floraMatricesBuffer[floraMatricesIndex++] = tx;
            floraMatricesBuffer[floraMatricesIndex++] = ty;
            floraMatricesBuffer[floraMatricesIndex++] = tz;
            floraMatricesBuffer[floraMatricesIndex++] = 1;

            let texId = TextureLookup[blockId * 3 + 0];
            const ao = 3;
            const isAnimated = 0;
            const pd =
              ((isAnimated ? 1 : 0) << 18) |
              (texId << 10) |
              (ao << 8) |
              (nBlk << 4) |
              nSun;
            floraPackedBuffer[floraPackedIndex++] = pd;
          }

          continue;
        }

        const isTrans = TransparentLookup[blockId] === 1;
        const isLiquid = FluidLookup[blockId] === 1;

        // Custom Fluid Top Face Generation (Sloped)
        if (isLiquid) {
          // Check if there is fluid ABOVE us. If there is, we don't render a top face!
          const aboveVal = getBlock(x, y + 1, z);
          const aboveId = getTextureId(aboveVal);
          
          if (FluidLookup[aboveId] === 0) {
            // Draw custom sloped top face
            const y0 = calcFluidCorner(x, y, z, -1, 1);
            const y1 = calcFluidCorner(x, y, z, 1, 1);
            const y2 = calcFluidCorner(x, y, z, 1, -1);
            const y3 = calcFluidCorner(x, y, z, -1, -1);

            let faceTexId = TextureLookup[blockId * 3 + 0];

            // Lighting for top face: local-first lookup
            let globalLight;
            if (y + 1 <= CHUNK_Y_MAX) {
              globalLight = buffer[idx + 256] as number;
            } else {
              globalLight = 15 << 26;
            }
            const faceSun = (globalLight >> 26) & 0xf;
            const faceBlk = (globalLight >> 22) & 0xf;

            const ao0 = calcAO(x, y, z, idx, -1, 1, 0, 0, 1, 1, -1, 1, 1);
            const ao1 = calcAO(x, y, z, idx, 1, 1, 0, 0, 1, 1, 1, 1, 1);
            const ao2 = calcAO(x, y, z, idx, 1, 1, 0, 0, 1, -1, 1, 1, -1);
            const ao3 = calcAO(x, y, z, idx, -1, 1, 0, 0, 1, -1, -1, 1, -1);

            const isAnimated = blockId === 18 || blockId === 19;

            pushFace(
              cx * CHUNK_SIZE_X + x,
              y,
              cz * CHUNK_SIZE_Z + z,
              0, 1, 0,
              faceTexId,
              isTrans,
              true, // passable
              faceSun, faceBlk,
              ao0, ao1, ao2, ao3,
              isAnimated,
              y0, y1, y2, y3
            );
          }
        }


        for (let i = 0; i < 6; i++) {
          const n = NEIGHBORS[i];
          if (isLiquid && n.ny === 1) continue; // We already handled the sloped top face!

          const nlx = x + n.nx;
          const nly = y + n.ny;
          const nlz = z + n.nz;
          let nVal: number;
          if (nlx >= 0 && nlx < 16 && nlz >= 0 && nlz < 16 && nly >= CHUNK_Y_MIN && nly <= CHUNK_Y_MAX) {
            nVal = buffer[idx + NEIGHBOR_OFFSETS[i]] as number;
          } else {
            nVal = getGlobalBlockVal(cx, cz, buffer, neighborBuffers, cx * 16 + nlx, nly, cz * 16 + nlz);
          }
          const nBlockId = getTextureId(nVal); // getTextureId returns Block ID

          let drawFace = false;
          if (nBlockId === 0) drawFace = true;
          else {
            const nIsTrans = TransparentLookup[nBlockId] === 1;
            if (nIsTrans && !isTrans) drawFace = true;
            else if (isTrans && nIsTrans && blockId !== nBlockId)
              drawFace = true;
          }

          if (drawFace) {

            // eslint-disable-next-line no-useless-assignment
            let faceTexId = blockId;
            if (n.ny === 1) faceTexId = TextureLookup[blockId * 3 + 0];
            else if (n.ny === -1) faceTexId = TextureLookup[blockId * 3 + 1];
            else faceTexId = TextureLookup[blockId * 3 + 2];

            // Get lighting for the block IN FRONT of the face
            const gx = cx * CHUNK_SIZE_X + nlx;
            const gy = nly;
            const gz = cz * CHUNK_SIZE_Z + nlz;
            let globalLight: number;
            if (nlx >= 0 && nlx < 16 && nlz >= 0 && nlz < 16 && nly >= CHUNK_Y_MIN && nly <= CHUNK_Y_MAX) {
              globalLight = buffer[idx + NEIGHBOR_OFFSETS[i]] as number;
            } else {
              globalLight = getGlobalBlockLight(
                cx,
                cz,
                buffer,
                neighborBuffers,
                null,
                gx,
                gy,
                gz
              );
            }

            let faceSun = (globalLight >> 26) & 0xf;
            let faceBlk = (globalLight >> 22) & 0xf;

            // If neighbor is fully opaque, we use OUR light so it's not pitch black (failsafe)
            if (nBlockId !== 0 && TransparentLookup[nBlockId] === 0) {
              const selfLight = buffer[idx] as number;
              faceSun = (selfLight >> 26) & 0xf;
              faceBlk = (selfLight >> 22) & 0xf;
            }

            const isAnimated = blockId === 18 || blockId === 19; // Water (18) and Lava (19)
            const isPassable = SolidLookup[blockId] === 0;

            let ao0 = 3,
              ao1 = 3,
              ao2 = 3,
              ao3 = 3;
            if (n.ny === 1) {
              ao0 = calcAO(x, y, z, idx, -1, 1, 0, 0, 1, 1, -1, 1, 1);
              ao1 = calcAO(x, y, z, idx, 1, 1, 0, 0, 1, 1, 1, 1, 1);
              ao2 = calcAO(x, y, z, idx, 1, 1, 0, 0, 1, -1, 1, 1, -1);
              ao3 = calcAO(x, y, z, idx, -1, 1, 0, 0, 1, -1, -1, 1, -1);
            } else if (n.ny === -1) {
              ao0 = calcAO(x, y, z, idx, -1, -1, 0, 0, -1, -1, -1, -1, -1);
              ao1 = calcAO(x, y, z, idx, 1, -1, 0, 0, -1, -1, 1, -1, -1);
              ao2 = calcAO(x, y, z, idx, 1, -1, 0, 0, -1, 1, 1, -1, 1);
              ao3 = calcAO(x, y, z, idx, -1, -1, 0, 0, -1, 1, -1, -1, 1);
            } else if (n.nx === 1) {
              ao0 = calcAO(x, y, z, idx, 1, 0, 1, 1, -1, 0, 1, -1, 1);
              ao1 = calcAO(x, y, z, idx, 1, 0, -1, 1, -1, 0, 1, -1, -1);
              ao2 = calcAO(x, y, z, idx, 1, 0, -1, 1, 1, 0, 1, 1, -1);
              ao3 = calcAO(x, y, z, idx, 1, 0, 1, 1, 1, 0, 1, 1, 1);
            } else if (n.nx === -1) {
              ao0 = calcAO(x, y, z, idx, -1, 0, -1, -1, -1, 0, -1, -1, -1);
              ao1 = calcAO(x, y, z, idx, -1, 0, 1, -1, -1, 0, -1, -1, 1);
              ao2 = calcAO(x, y, z, idx, -1, 0, 1, -1, 1, 0, -1, 1, 1);
              ao3 = calcAO(x, y, z, idx, -1, 0, -1, -1, 1, 0, -1, 1, -1);
            } else if (n.nz === 1) {
              ao0 = calcAO(x, y, z, idx, -1, 0, 1, 0, -1, 1, -1, -1, 1);
              ao1 = calcAO(x, y, z, idx, 1, 0, 1, 0, -1, 1, 1, -1, 1);
              ao2 = calcAO(x, y, z, idx, 1, 0, 1, 0, 1, 1, 1, 1, 1);
              ao3 = calcAO(x, y, z, idx, -1, 0, 1, 0, 1, 1, -1, 1, 1);
            } else if (n.nz === -1) {
              ao0 = calcAO(x, y, z, idx, 1, 0, -1, 0, -1, -1, 1, -1, -1);
              ao1 = calcAO(x, y, z, idx, -1, 0, -1, 0, -1, -1, -1, -1, -1);
              ao2 = calcAO(x, y, z, idx, -1, 0, -1, 0, 1, -1, -1, 1, -1);
              ao3 = calcAO(x, y, z, idx, 1, 0, -1, 0, 1, -1, 1, 1, -1);
            }

            pushFace(
              cx * CHUNK_SIZE_X + x,
              y,
              cz * CHUNK_SIZE_Z + z,
              n.nx,
              n.ny,
              n.nz,
              faceTexId,
              isTrans,
              isPassable,
              faceSun,
              faceBlk,
              ao0,
              ao1,
              ao2,
              ao3,
              isAnimated
            );
          }
        }
      }
    }
  }

  // Final flush for remaining chunks
  flushBuffers();

  result.__flora = {
    matrices: copyToBuffer(floraMatricesBuffer, floraMatricesIndex, Float32Array),
    packed: copyToBuffer(floraPackedBuffer, floraPackedIndex, Float32Array),
  };
  
  result.__meta.boundingBox = minX === Infinity ? null : { min: [minX, minY, minZ], max: [maxX + 1, maxY + 1, maxZ + 1] };
  return result;
};
