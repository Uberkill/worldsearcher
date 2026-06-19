import { BlockById } from '../registry/BlockRegistry';
import type { NeighborBuffer } from '../types/world';
import {
  getSunlight,
  getBlockLight,
  getIndex,
  CHUNK_Y_MIN,
  CHUNK_Y_MAX,
  getGlobalBlockTex,
  getTextureId,
  CHUNK_VOLUME,
} from './chunkData';

const QUEUE_SIZE = 4194304;
const QUEUE_MASK = 4194303;
let qX = new Int32Array(QUEUE_SIZE);
let qY = new Int32Array(QUEUE_SIZE);
let qZ = new Int32Array(QUEUE_SIZE);
let qV = new Uint8Array(QUEUE_SIZE);

let rqX = new Int32Array(QUEUE_SIZE);
let rqY = new Int32Array(QUEUE_SIZE);
let rqZ = new Int32Array(QUEUE_SIZE);
let rqV = new Uint8Array(QUEUE_SIZE);


const dirs = [
  [0, 1, 0],
  [0, -1, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
];

const isTransparent = (
  cx: number,
  cz: number,
  buffer: Uint32Array,
  neighborBuffers: NeighborBuffer[] | null | undefined,
  neighborObj: Record<string, any> | null | undefined,
  gx: number,
  gy: number,
  gz: number
): boolean => {
  if (gy > CHUNK_Y_MAX || gy < CHUNK_Y_MIN) return true;

  const lx = gx - cx * 16;
  const lz = gz - cz * 16;
  if (lx >= 0 && lx < 16 && lz >= 0 && lz < 16) {
    const tex = buffer[getIndex(lx, gy, lz)] & 0xff;
    if (tex === 0) return true;
    return BlockById[tex]?.isTransparent || false;
  }

  const tex = getGlobalBlockTex(
    cx,
    cz,
    buffer,
    neighborBuffers,
    neighborObj,
    gx,
    gy,
    gz
  );
  if (tex === 0) return true;
  if (typeof tex === 'string') return false; // Objects are solid for now
  return BlockById[tex]?.isTransparent || false;
};

const getLight = (cx: number, cz: number, buffer: Uint32Array, neighborBuffers: NeighborBuffer[] | null | undefined, gx: number, gy: number, gz: number, isSunlight: boolean): number => {
  if (gy > CHUNK_Y_MAX) return isSunlight ? 15 : 0;
  if (gy < CHUNK_Y_MIN) return 0;

  const lx = gx - cx * 16;
  const lz = gz - cz * 16;
  if (lx >= 0 && lx < 16 && lz >= 0 && lz < 16) {
    const val = buffer[getIndex(lx, gy, lz)];
    return isSunlight ? (val >> 26) & 0xf : (val >> 22) & 0xf;
  }

  if (neighborBuffers) {
    const ncx = Math.floor(gx / 16);
    const ncz = Math.floor(gz / 16);
    for (let i = 0; i < neighborBuffers.length; i++) {
      if (neighborBuffers[i].cx === ncx && neighborBuffers[i].cz === ncz) {
        const nlx = gx - ncx * 16;
        const nlz = gz - ncz * 16;
        const val = neighborBuffers[i].buffer[getIndex(nlx, gy, nlz)];
        return isSunlight ? (val >> 26) & 0xf : (val >> 22) & 0xf;
      }
    }
  }
  return 0; // Unloaded chunks have 0 light
};

const setLightVal = (
  cx: number,
  cz: number,
  buffer: Uint32Array,
  neighborBuffers: NeighborBuffer[] | null | undefined,
  gx: number,
  gy: number,
  gz: number,
  val: number,
  isSunlight: boolean
): boolean => {
  if (gy > CHUNK_Y_MAX || gy < CHUNK_Y_MIN) return false;

  const lx = gx - cx * 16;
  const lz = gz - cz * 16;
  if (lx >= 0 && lx < 16 && lz >= 0 && lz < 16) {
    const idx = getIndex(lx, gy, lz);
    if (isSunlight) {
      buffer[idx] = (buffer[idx] & ~(0xf << 26)) | ((val & 0xf) << 26);
    } else {
      buffer[idx] = (buffer[idx] & ~(0xf << 22)) | ((val & 0xf) << 22);
    }
    return true;
  }

  if (neighborBuffers) {
    const ncx = Math.floor(gx / 16);
    const ncz = Math.floor(gz / 16);
    for (let i = 0; i < neighborBuffers.length; i++) {
      if (neighborBuffers[i].cx === ncx && neighborBuffers[i].cz === ncz) {
        const nlx = gx - ncx * 16;
        const nlz = gz - ncz * 16;
        const idx = getIndex(nlx, gy, nlz);
        const nBuf = neighborBuffers[i].buffer;
        if (isSunlight) {
          nBuf[idx] = (nBuf[idx] & ~(0xf << 26)) | ((val & 0xf) << 26);
        } else {
          nBuf[idx] = (nBuf[idx] & ~(0xf << 22)) | ((val & 0xf) << 22);
        }
        return true;
      }
    }
  }
  return false;
};

const seedNeighborLight = (
  cx: number,
  cz: number,
  neighborBuffers: NeighborBuffer[] | null | undefined,
  isSunlight: boolean,
  currentTail: number
): number => {
  if (!neighborBuffers) return currentTail;
  let tail = currentTail;

  for (let n = 0; n < neighborBuffers.length; n++) {
    const nb = neighborBuffers[n];
    const dx = nb.cx - cx;
    const dz = nb.cz - cz;
    if (Math.abs(dx) > 1 || Math.abs(dz) > 1 || (dx === 0 && dz === 0))
      continue;

    let startX = 0;
    let endX = 15;
    let startZ = 0;
    let endZ = 15;
    if (dx === -1) {
      startX = 15;
      endX = 15;
    }
    if (dx === 1) {
      startX = 0;
      endX = 0;
    }
    if (dz === -1) {
      startZ = 15;
      endZ = 15;
    }
    if (dz === 1) {
      startZ = 0;
      endZ = 0;
    }

    for (let lx = startX; lx <= endX; lx++) {
      for (let lz = startZ; lz <= endZ; lz++) {
        for (let gy = CHUNK_Y_MAX; gy >= CHUNK_Y_MIN; gy--) {
          const idx = getIndex(lx, gy, lz);
          const val = nb.buffer[idx];
          const lightLvl = isSunlight ? getSunlight(val) : getBlockLight(val);

          if (isSunlight ? lightLvl > 1 && lightLvl < 15 : lightLvl > 1) {
            const gx = nb.cx * 16 + lx;
            const gz = nb.cz * 16 + lz;
            qX[tail & QUEUE_MASK] = gx;
              qY[tail & QUEUE_MASK] = gy;
              qZ[tail & QUEUE_MASK] = gz;
              qV[tail & QUEUE_MASK] = lightLvl;
              tail++;
          }
        }
      }
    }
  }
  return tail;
};

// --- PASS 1: SUNLIGHT RAYCAST & BFS ---
export const generateSunlight = (
  buffer: Uint32Array,
  cx: number,
  cz: number,
  neighborBuffers: NeighborBuffer[] | null | undefined,
  neighborObj: Record<string, any> | null = null
): Array<{x: number, y: number, z: number, val: number, type: string}> => {
  let head = 0;
  let tail = 0;
  const lightOverflow = [];

  // Step 1: Raycast down from Y=255
  for (let lx = -1; lx <= 16; lx++) {
    for (let lz = -1; lz <= 16; lz++) {
      let rayVal = 15;
      const gx = cx * 16 + lx;
      const gz = cz * 16 + lz;

      for (let gy = CHUNK_Y_MAX; gy >= CHUNK_Y_MIN; gy--) {
        if (
          !isTransparent(
            cx,
            cz,
            buffer,
            neighborBuffers,
            neighborObj,
            gx,
            gy,
            gz
          )
        ) {
          rayVal = 0;
        }

        const currentLight = getLight(
          cx,
          cz,
          buffer,
          neighborBuffers,
          gx,
          gy,
          gz,
          true
        );
        if (rayVal > currentLight) {
          setLightVal(
            cx,
            cz,
            buffer,
            neighborBuffers,
            gx,
            gy,
            gz,
            rayVal,
            true
          );
          if (rayVal === 15) {
            // Check lateral neighbors to see if we should scatter!
            for (let i = 2; i < 6; i++) {
              const nx = gx + dirs[i][0];
              const nz = gz + dirs[i][2];
              if (
                isTransparent(
                  cx,
                  cz,
                  buffer,
                  neighborBuffers,
                  neighborObj,
                  nx,
                  gy,
                  nz
                )
              ) {
                qX[tail & QUEUE_MASK] = gx;
                  qY[tail & QUEUE_MASK] = gy;
                  qZ[tail & QUEUE_MASK] = gz;
                  qV[tail & QUEUE_MASK] = 15;
                  tail++;
                break; // Only need to add the source once
              }
            }
          }
        } else if (currentLight === 15) {
          rayVal = 15; // Inherit light if hitting an existing shaft
        }
      }
    }
  }

  // Step 1b: Seed border sunlight from neighbors
  tail = seedNeighborLight(cx, cz, neighborBuffers, true, tail);

  // Step 2: Flood Fill Scatter
  while (head < tail) {
    const x = qX[head & QUEUE_MASK];
    const y = qY[head & QUEUE_MASK];
    const z = qZ[head & QUEUE_MASK];
    const val = qV[head & QUEUE_MASK];
    head++;

    if (val <= 1) continue;

    for (let i = 0; i < dirs.length; i++) {
      const dir = dirs[i];
      const nx = x + dir[0];
      const ny = y + dir[1];
      const nz = z + dir[2];

      // Sun scattering only happens at max 14 going sideways/upwards/downwards if obstructed
      const nextVal = val === 15 && dir[1] === -1 ? 15 : val - 1;

      if (ny < CHUNK_Y_MIN || ny > CHUNK_Y_MAX) continue;

      if (
        isTransparent(cx, cz, buffer, neighborBuffers, neighborObj, nx, ny, nz)
      ) {
        const currentLight = getLight(
          cx,
          cz,
          buffer,
          neighborBuffers,
          nx,
          ny,
          nz,
          true
        );
        if (currentLight < nextVal) {
          const success = setLightVal(
            cx,
            cz,
            buffer,
            neighborBuffers,
            nx,
            ny,
            nz,
            nextVal,
            true
          );
          if (success) {
            qX[tail & QUEUE_MASK] = nx;
              qY[tail & QUEUE_MASK] = ny;
              qZ[tail & QUEUE_MASK] = nz;
              qV[tail & QUEUE_MASK] = nextVal;
              tail++;
          } else {
            // Reached an unloaded boundary, emit overflow payload!
            lightOverflow.push({
              x: nx,
              y: ny,
              z: nz,
              val: nextVal,
              type: 'sun',
            });
          }
        }
      }
    }
  }

  return lightOverflow;
};

// --- PASS 2: BLOCK LIGHT BFS ---
export const generateBlockLight = (
  buffer: Uint32Array,
  cx: number,
  cz: number,
  neighborBuffers: NeighborBuffer[] | null | undefined,
  neighborObj: Record<string, any> | null = null
): Array<{x: number, y: number, z: number, val: number, type: string}> => {
  let head = 0;
  let tail = 0;
  const lightOverflow = [];

  // 1. Seed emissive blocks
  for (let i = 0; i < CHUNK_VOLUME; i++) {
    const val = buffer[i];
    if (val === 0) continue;
    const tex = getTextureId(val);
    const lightLvl = BlockById[tex]?.lightLevel || 0;
    if (lightLvl > 0) {
      const lx = i % 16;
      const lz = Math.floor(i / 16) % 16;
      const gy = Math.floor(i / 256) + CHUNK_Y_MIN;
      const gx = cx * 16 + lx;
      const gz = cz * 16 + lz;

      if (
        getLight(cx, cz, buffer, neighborBuffers, gx, gy, gz, false) < lightLvl
      ) {
        setLightVal(
          cx,
          cz,
          buffer,
          neighborBuffers,
          gx,
          gy,
          gz,
          lightLvl,
          false
        );
        qX[tail & QUEUE_MASK] = gx;
          qY[tail & QUEUE_MASK] = gy;
          qZ[tail & QUEUE_MASK] = gz;
          qV[tail & QUEUE_MASK] = lightLvl;
          tail++;
      }
    }
  }

  // 1b: Seed border block light from neighbors
  tail = seedNeighborLight(cx, cz, neighborBuffers, false, tail);

  // 2. Flood Fill
  while (head < tail) {
    const x = qX[head & QUEUE_MASK];
    const y = qY[head & QUEUE_MASK];
    const z = qZ[head & QUEUE_MASK];
    const val = qV[head & QUEUE_MASK];
    head++;

    if (val <= 1) continue;
    const nextVal = val - 1;

    for (let i = 0; i < dirs.length; i++) {
      const nx = x + dirs[i][0];
      const ny = y + dirs[i][1];
      const nz = z + dirs[i][2];

      if (ny < CHUNK_Y_MIN || ny > CHUNK_Y_MAX) continue;

      if (
        isTransparent(cx, cz, buffer, neighborBuffers, neighborObj, nx, ny, nz)
      ) {
        const currentLight = getLight(
          cx,
          cz,
          buffer,
          neighborBuffers,
          nx,
          ny,
          nz,
          false
        );
        if (currentLight < nextVal) {
          const success = setLightVal(
            cx,
            cz,
            buffer,
            neighborBuffers,
            nx,
            ny,
            nz,
            nextVal,
            false
          );
          if (success) {
            qX[tail & QUEUE_MASK] = nx;
              qY[tail & QUEUE_MASK] = ny;
              qZ[tail & QUEUE_MASK] = nz;
              qV[tail & QUEUE_MASK] = nextVal;
              tail++;
          } else {
            lightOverflow.push({
              x: nx,
              y: ny,
              z: nz,
              val: nextVal,
              type: 'block',
            });
          }
        }
      }
    }
  }

  return lightOverflow;
};

// --- PASS 3: LIGHT REMOVAL BFS (GHOST LIGHT FIX) ---
export const removeLight = (
  buffer: Uint32Array,
  cx: number,
  cz: number,
  neighborBuffers: NeighborBuffer[] | null | undefined,
  rx: number,
  ry: number,
  rz: number,
  removedLightVal: number,
  isSunlight: boolean,
  neighborObj: Record<string, any> | null = null
): Array<{x: number, y: number, z: number, val: number, type: string}> => {
  let rHead = 0;
  let rTail = 0;

  let gHead = 0;
  let gTail = 0;

  const lightOverflow = [];

  // Seed removal queue
  rqX[rTail & QUEUE_MASK] = rx;
  rqY[rTail & QUEUE_MASK] = ry;
  rqZ[rTail & QUEUE_MASK] = rz;
  rqV[rTail & QUEUE_MASK] = removedLightVal;
  rTail++;
  setLightVal(cx, cz, buffer, neighborBuffers, rx, ry, rz, 0, isSunlight);

  // 1. Reverse BFS (Darken everything that relied on this light source)
  while (rHead < rTail) {
    const x = rqX[rHead & QUEUE_MASK];
    const y = rqY[rHead & QUEUE_MASK];
    const z = rqZ[rHead & QUEUE_MASK];
    const val = rqV[rHead & QUEUE_MASK];
    rHead++;

    for (let i = 0; i < dirs.length; i++) {
      const nx = x + dirs[i][0];
      const ny = y + dirs[i][1];
      const nz = z + dirs[i][2];

      if (ny < CHUNK_Y_MIN || ny > CHUNK_Y_MAX) continue;

      const neighborLight = getLight(
        cx,
        cz,
        buffer,
        neighborBuffers,
        nx,
        ny,
        nz,
        isSunlight
      );
      if (neighborLight !== 0) {
        // Did the neighbor get its light from us?
        const threshold =
          isSunlight && dirs[i][1] === -1 && val === 15 ? 15 : val - 1;

        if (
          neighborLight === threshold ||
          (isSunlight &&
            dirs[i][1] === -1 &&
            neighborLight === 15 &&
            val === 15)
        ) {
          // Yes! It was relying on us. Darken it and push to removal queue.
          setLightVal(
            cx,
            cz,
            buffer,
            neighborBuffers,
            nx,
            ny,
            nz,
            0,
            isSunlight
          );
          rqX[rTail & QUEUE_MASK] = nx;
            rqY[rTail & QUEUE_MASK] = ny;
            rqZ[rTail & QUEUE_MASK] = nz;
            rqV[rTail & QUEUE_MASK] = neighborLight;
            rTail++;
        } else if (neighborLight >= val) {
          // No! Its light came from somewhere else. Add it to generation queue to re-illuminate!
          qX[gTail & QUEUE_MASK] = nx;
            qY[gTail & QUEUE_MASK] = ny;
            qZ[gTail & QUEUE_MASK] = nz;
            qV[gTail & QUEUE_MASK] = neighborLight;
            gTail++;
        }
      }
    }
  }

  // 2. Standard BFS (Re-illuminate from other sources)
  while (gHead < gTail) {
    const x = qX[gHead & QUEUE_MASK];
    const y = qY[gHead & QUEUE_MASK];
    const z = qZ[gHead & QUEUE_MASK];
    const val = qV[gHead & QUEUE_MASK];
    gHead++;

    if (val <= 1) continue;

    for (let i = 0; i < dirs.length; i++) {
      const nx = x + dirs[i][0];
      const ny = y + dirs[i][1];
      const nz = z + dirs[i][2];

      if (ny < CHUNK_Y_MIN || ny > CHUNK_Y_MAX) continue;

      const nextVal =
        isSunlight && val === 15 && dirs[i][1] === -1 ? 15 : val - 1;

      if (
        isTransparent(cx, cz, buffer, neighborBuffers, neighborObj, nx, ny, nz)
      ) {
        const currentLight = getLight(
          cx,
          cz,
          buffer,
          neighborBuffers,
          nx,
          ny,
          nz,
          isSunlight
        );
        if (currentLight < nextVal) {
          const success = setLightVal(
            cx,
            cz,
            buffer,
            neighborBuffers,
            nx,
            ny,
            nz,
            nextVal,
            isSunlight
          );
          if (success) {
            qX[gTail & QUEUE_MASK] = nx;
              qY[gTail & QUEUE_MASK] = ny;
              qZ[gTail & QUEUE_MASK] = nz;
              qV[gTail & QUEUE_MASK] = nextVal;
              gTail++;
          } else {
            lightOverflow.push({
              x: nx,
              y: ny,
              z: nz,
              val: nextVal,
              type: isSunlight ? 'sun' : 'block',
            });
          }
        }
      }
    }
  }

  return lightOverflow;
};

