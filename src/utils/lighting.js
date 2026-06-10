import { BlockById } from '../registry/BlockRegistry';
import {
  getSunlight,
  getBlockLight,
  setSunlight,
  setBlockLight,
  getIndex,
  CHUNK_Y_MIN,
  CHUNK_Y_MAX,
  getGlobalBlockTex,
  getTextureId,
  CHUNK_VOLUME,
} from './chunkData';

let QUEUE_SIZE = 100000;
let qX = new Int32Array(QUEUE_SIZE);
let qY = new Int32Array(QUEUE_SIZE);
let qZ = new Int32Array(QUEUE_SIZE);
let qV = new Uint8Array(QUEUE_SIZE);

let rqX = new Int32Array(QUEUE_SIZE);
let rqY = new Int32Array(QUEUE_SIZE);
let rqZ = new Int32Array(QUEUE_SIZE);
let rqV = new Uint8Array(QUEUE_SIZE);

const checkQueue = (tail) => {
  if (tail >= QUEUE_SIZE) {
    QUEUE_SIZE *= 2;
    const newQX = new Int32Array(QUEUE_SIZE); newQX.set(qX); qX = newQX;
    const newQY = new Int32Array(QUEUE_SIZE); newQY.set(qY); qY = newQY;
    const newQZ = new Int32Array(QUEUE_SIZE); newQZ.set(qZ); qZ = newQZ;
    const newQV = new Uint8Array(QUEUE_SIZE); newQV.set(qV); qV = newQV;
    
    const newRQX = new Int32Array(QUEUE_SIZE); newRQX.set(rqX); rqX = newRQX;
    const newRQY = new Int32Array(QUEUE_SIZE); newRQY.set(rqY); rqY = newRQY;
    const newRQZ = new Int32Array(QUEUE_SIZE); newRQZ.set(rqZ); rqZ = newRQZ;
    const newRQV = new Uint8Array(QUEUE_SIZE); newRQV.set(rqV); rqV = newRQV;
  }
};

const dirs = [
  [0, 1, 0],
  [0, -1, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
];

const isTransparent = (
  cx,
  cz,
  buffer,
  neighborBuffers,
  neighborObj,
  gx,
  gy,
  gz
) => {
  if (gy > CHUNK_Y_MAX) return true;
  if (gy < CHUNK_Y_MIN) return true;
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

const getLight = (cx, cz, buffer, neighborBuffers, gx, gy, gz, isSunlight) => {
  if (gy > CHUNK_Y_MAX) return isSunlight ? 15 : 0;
  if (gy < CHUNK_Y_MIN) return 0;

  if (
    gx >= cx * 16 &&
    gx < cx * 16 + 16 &&
    gz >= cz * 16 &&
    gz < cz * 16 + 16
  ) {
    const lx = ((gx % 16) + 16) % 16;
    const lz = ((gz % 16) + 16) % 16;
    const val = buffer[getIndex(lx, gy, lz)];
    return isSunlight ? getSunlight(val) : getBlockLight(val);
  }

  if (neighborBuffers) {
    const ncx = Math.floor(gx / 16);
    const ncz = Math.floor(gz / 16);
    for (let i = 0; i < neighborBuffers.length; i++) {
      if (neighborBuffers[i].cx === ncx && neighborBuffers[i].cz === ncz) {
        const lx = ((gx % 16) + 16) % 16;
        const lz = ((gz % 16) + 16) % 16;
        const val = neighborBuffers[i].buffer[getIndex(lx, gy, lz)];
        return isSunlight ? getSunlight(val) : getBlockLight(val);
      }
    }
  }
  return 0; // Unloaded chunks have 0 light
};

const setLightVal = (
  cx,
  cz,
  buffer,
  neighborBuffers,
  gx,
  gy,
  gz,
  val,
  isSunlight
) => {
  if (gy > CHUNK_Y_MAX || gy < CHUNK_Y_MIN) return false;

  if (
    gx >= cx * 16 &&
    gx < cx * 16 + 16 &&
    gz >= cz * 16 &&
    gz < cz * 16 + 16
  ) {
    const lx = ((gx % 16) + 16) % 16;
    const lz = ((gz % 16) + 16) % 16;
    const idx = getIndex(lx, gy, lz);
    if (isSunlight) setSunlight(buffer, idx, val);
    else setBlockLight(buffer, idx, val);
    return true;
  }

  if (neighborBuffers) {
    const ncx = Math.floor(gx / 16);
    const ncz = Math.floor(gz / 16);
    for (let i = 0; i < neighborBuffers.length; i++) {
      if (neighborBuffers[i].cx === ncx && neighborBuffers[i].cz === ncz) {
        const lx = ((gx % 16) + 16) % 16;
        const lz = ((gz % 16) + 16) % 16;
        const idx = getIndex(lx, gy, lz);
        if (isSunlight) setSunlight(neighborBuffers[i].buffer, idx, val);
        else setBlockLight(neighborBuffers[i].buffer, idx, val);
        return true;
      }
    }
  }
  return false;
};

const seedNeighborLight = (
  cx,
  cz,
  neighborBuffers,
  isSunlight,
  currentTail
) => {
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
            checkQueue(tail); {
              qX[tail] = gx;
              qY[tail] = gy;
              qZ[tail] = gz;
              qV[tail] = lightLvl;
              tail++;
            }
          }
        }
      }
    }
  }
  return tail;
};

// --- PASS 1: SUNLIGHT RAYCAST & BFS ---
export const generateSunlight = (
  buffer,
  cx,
  cz,
  neighborBuffers,
  neighborObj = null
) => {
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
                checkQueue(tail); {
                  qX[tail] = gx;
                  qY[tail] = gy;
                  qZ[tail] = gz;
                  qV[tail] = 15;
                  tail++;
                }
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
    const x = qX[head];
    const y = qY[head];
    const z = qZ[head];
    const val = qV[head];
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
            checkQueue(tail); {
              qX[tail] = nx;
              qY[tail] = ny;
              qZ[tail] = nz;
              qV[tail] = nextVal;
              tail++;
            }
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
  buffer,
  cx,
  cz,
  neighborBuffers,
  neighborObj = null
) => {
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
        checkQueue(tail); {
          qX[tail] = gx;
          qY[tail] = gy;
          qZ[tail] = gz;
          qV[tail] = lightLvl;
          tail++;
        }
      }
    }
  }

  // 1b: Seed border block light from neighbors
  tail = seedNeighborLight(cx, cz, neighborBuffers, false, tail);

  // 2. Flood Fill
  while (head < tail) {
    const x = qX[head];
    const y = qY[head];
    const z = qZ[head];
    const val = qV[head];
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
            checkQueue(tail); {
              qX[tail] = nx;
              qY[tail] = ny;
              qZ[tail] = nz;
              qV[tail] = nextVal;
              tail++;
            }
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
  buffer,
  cx,
  cz,
  neighborBuffers,
  rx,
  ry,
  rz,
  removedLightVal,
  isSunlight,
  neighborObj = null
) => {
  let rHead = 0;
  let rTail = 0;

  let gHead = 0;
  let gTail = 0;

  const lightOverflow = [];

  // Seed removal queue
  checkQueue(rTail);
  rqX[rTail] = rx;
  rqY[rTail] = ry;
  rqZ[rTail] = rz;
  rqV[rTail] = removedLightVal;
  rTail++;
  setLightVal(cx, cz, buffer, neighborBuffers, rx, ry, rz, 0, isSunlight);

  // 1. Reverse BFS (Darken everything that relied on this light source)
  while (rHead < rTail) {
    const x = rqX[rHead];
    const y = rqY[rHead];
    const z = rqZ[rHead];
    const val = rqV[rHead];
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
          checkQueue(rTail); {
            rqX[rTail] = nx;
            rqY[rTail] = ny;
            rqZ[rTail] = nz;
            rqV[rTail] = neighborLight;
            rTail++;
          }
        } else if (neighborLight >= val) {
          // No! Its light came from somewhere else. Add it to generation queue to re-illuminate!
          checkQueue(gTail); {
            qX[gTail] = nx;
            qY[gTail] = ny;
            qZ[gTail] = nz;
            qV[gTail] = neighborLight;
            gTail++;
          }
        }
      }
    }
  }

  // 2. Standard BFS (Re-illuminate from other sources)
  while (gHead < gTail) {
    const x = qX[gHead];
    const y = qY[gHead];
    const z = qZ[gHead];
    const val = qV[gHead];
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
            checkQueue(gTail); {
              qX[gTail] = nx;
              qY[gTail] = ny;
              qZ[gTail] = nz;
              qV[gTail] = nextVal;
              gTail++;
            }
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

// ── Vertex Ambient Occlusion & Lighting ──────────────────────────────────────
const isSolidBlock = (
  buffer,
  neighborBuffers,
  neighborObj,
  cx,
  cz,
  x,
  y,
  z
) => {
  const tex = getGlobalBlockTex(
    cx,
    cz,
    buffer,
    neighborBuffers,
    neighborObj,
    x,
    y,
    z
  );
  if (tex === 0) return false;
  if (typeof tex === 'string') return true;
  return !BlockById[tex]?.isTransparent;
};

const getVertexLightAO = (
  buffer,
  neighborBuffers,
  neighborObj,
  cx,
  cz,
  centerSun,
  centerBlock,
  s1x,
  s1y,
  s1z,
  s2x,
  s2y,
  s2z,
  cx_c,
  cy_c,
  cz_c
) => {
  const s1 = isSolidBlock(
    buffer,
    neighborBuffers,
    neighborObj,
    cx,
    cz,
    s1x,
    s1y,
    s1z
  )
    ? 1
    : 0;
  const s2 = isSolidBlock(
    buffer,
    neighborBuffers,
    neighborObj,
    cx,
    cz,
    s2x,
    s2y,
    s2z
  )
    ? 1
    : 0;
  const c = isSolidBlock(
    buffer,
    neighborBuffers,
    neighborObj,
    cx,
    cz,
    cx_c,
    cy_c,
    cz_c
  )
    ? 1
    : 0;

  const s1Sun = getLight(cx, cz, buffer, neighborBuffers, s1x, s1y, s1z, true);
  const s2Sun = getLight(cx, cz, buffer, neighborBuffers, s2x, s2y, s2z, true);
  const cSun = getLight(
    cx,
    cz,
    buffer,
    neighborBuffers,
    cx_c,
    cy_c,
    cz_c,
    true
  );

  const s1Blk = getLight(cx, cz, buffer, neighborBuffers, s1x, s1y, s1z, false);
  const s2Blk = getLight(cx, cz, buffer, neighborBuffers, s2x, s2y, s2z, false);
  const cBlk = getLight(
    cx,
    cz,
    buffer,
    neighborBuffers,
    cx_c,
    cy_c,
    cz_c,
    false
  );

  const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + c);

  let maxSun = centerSun;
  let maxBlk = centerBlock;

  if (!s1) {
    maxSun = Math.max(maxSun, s1Sun);
    maxBlk = Math.max(maxBlk, s1Blk);
  }
  if (!s2) {
    maxSun = Math.max(maxSun, s2Sun);
    maxBlk = Math.max(maxBlk, s2Blk);
  }
  if (!(s1 && s2) && !c) {
    maxSun = Math.max(maxSun, cSun);
    maxBlk = Math.max(maxBlk, cBlk);
  }

  // Pack into 10 bits: Sun (4) | Blk (4) | AO (2)
  return (maxSun & 0xf) | ((maxBlk & 0xf) << 4) | ((ao & 0x3) << 8);
};

export const calculateFaceLighting = (
  buffer,
  neighborBuffers,
  neighborObj,
  cx,
  cz,
  bx,
  by,
  bz,
  dir
) => {
  const ax = bx + dir[0];
  const ay = by + dir[1];
  const az = bz + dir[2];

  const cSun = getLight(cx, cz, buffer, neighborBuffers, ax, ay, az, true);
  const cBlk = getLight(cx, cz, buffer, neighborBuffers, ax, ay, az, false);

  let v0, v1, v2, v3;

  if (dir[1] === 1) {
    // +Y
    v0 = getVertexLightAO(
      buffer,
      neighborBuffers,
      neighborObj,
      cx,
      cz,
      cSun,
      cBlk,
      ax - 1,
      ay,
      az,
      ax,
      ay,
      az - 1,
      ax - 1,
      ay,
      az - 1
    );
    v1 = getVertexLightAO(
      buffer,
      neighborBuffers,
      neighborObj,
      cx,
      cz,
      cSun,
      cBlk,
      ax - 1,
      ay,
      az,
      ax,
      ay,
      az + 1,
      ax - 1,
      ay,
      az + 1
    );
    v2 = getVertexLightAO(
      buffer,
      neighborBuffers,
      neighborObj,
      cx,
      cz,
      cSun,
      cBlk,
      ax + 1,
      ay,
      az,
      ax,
      ay,
      az + 1,
      ax + 1,
      ay,
      az + 1
    );
    v3 = getVertexLightAO(
      buffer,
      neighborBuffers,
      neighborObj,
      cx,
      cz,
      cSun,
      cBlk,
      ax + 1,
      ay,
      az,
      ax,
      ay,
      az - 1,
      ax + 1,
      ay,
      az - 1
    );
  } else if (dir[1] === -1) {
    // -Y
    v0 = getVertexLightAO(
      buffer,
      neighborBuffers,
      neighborObj,
      cx,
      cz,
      cSun,
      cBlk,
      ax - 1,
      ay,
      az,
      ax,
      ay,
      az - 1,
      ax - 1,
      ay,
      az - 1
    );
    v1 = getVertexLightAO(
      buffer,
      neighborBuffers,
      neighborObj,
      cx,
      cz,
      cSun,
      cBlk,
      ax + 1,
      ay,
      az,
      ax,
      ay,
      az - 1,
      ax + 1,
      ay,
      az - 1
    );
    v2 = getVertexLightAO(
      buffer,
      neighborBuffers,
      neighborObj,
      cx,
      cz,
      cSun,
      cBlk,
      ax + 1,
      ay,
      az,
      ax,
      ay,
      az + 1,
      ax + 1,
      ay,
      az + 1
    );
    v3 = getVertexLightAO(
      buffer,
      neighborBuffers,
      neighborObj,
      cx,
      cz,
      cSun,
      cBlk,
      ax - 1,
      ay,
      az,
      ax,
      ay,
      az + 1,
      ax - 1,
      ay,
      az + 1
    );
  } else if (dir[0] === 1) {
    // +X
    v0 = getVertexLightAO(
      buffer,
      neighborBuffers,
      neighborObj,
      cx,
      cz,
      cSun,
      cBlk,
      ax,
      ay - 1,
      az,
      ax,
      ay,
      az - 1,
      ax,
      ay - 1,
      az - 1
    );
    v1 = getVertexLightAO(
      buffer,
      neighborBuffers,
      neighborObj,
      cx,
      cz,
      cSun,
      cBlk,
      ax,
      ay + 1,
      az,
      ax,
      ay,
      az - 1,
      ax,
      ay + 1,
      az - 1
    );
    v2 = getVertexLightAO(
      buffer,
      neighborBuffers,
      neighborObj,
      cx,
      cz,
      cSun,
      cBlk,
      ax,
      ay + 1,
      az,
      ax,
      ay,
      az + 1,
      ax,
      ay + 1,
      az + 1
    );
    v3 = getVertexLightAO(
      buffer,
      neighborBuffers,
      neighborObj,
      cx,
      cz,
      cSun,
      cBlk,
      ax,
      ay - 1,
      az,
      ax,
      ay,
      az + 1,
      ax,
      ay - 1,
      az + 1
    );
  } else if (dir[0] === -1) {
    // -X
    v0 = getVertexLightAO(
      buffer,
      neighborBuffers,
      neighborObj,
      cx,
      cz,
      cSun,
      cBlk,
      ax,
      ay - 1,
      az,
      ax,
      ay,
      az - 1,
      ax,
      ay - 1,
      az - 1
    );
    v1 = getVertexLightAO(
      buffer,
      neighborBuffers,
      neighborObj,
      cx,
      cz,
      cSun,
      cBlk,
      ax,
      ay - 1,
      az,
      ax,
      ay,
      az + 1,
      ax,
      ay - 1,
      az + 1
    );
    v2 = getVertexLightAO(
      buffer,
      neighborBuffers,
      neighborObj,
      cx,
      cz,
      cSun,
      cBlk,
      ax,
      ay + 1,
      az,
      ax,
      ay,
      az + 1,
      ax,
      ay + 1,
      az + 1
    );
    v3 = getVertexLightAO(
      buffer,
      neighborBuffers,
      neighborObj,
      cx,
      cz,
      cSun,
      cBlk,
      ax,
      ay + 1,
      az,
      ax,
      ay,
      az - 1,
      ax,
      ay + 1,
      az - 1
    );
  } else if (dir[2] === 1) {
    // +Z
    v0 = getVertexLightAO(
      buffer,
      neighborBuffers,
      neighborObj,
      cx,
      cz,
      cSun,
      cBlk,
      ax + 1,
      ay,
      az,
      ax,
      ay - 1,
      az,
      ax + 1,
      ay - 1,
      az
    );
    v1 = getVertexLightAO(
      buffer,
      neighborBuffers,
      neighborObj,
      cx,
      cz,
      cSun,
      cBlk,
      ax + 1,
      ay,
      az,
      ax,
      ay + 1,
      az,
      ax + 1,
      ay + 1,
      az
    );
    v2 = getVertexLightAO(
      buffer,
      neighborBuffers,
      neighborObj,
      cx,
      cz,
      cSun,
      cBlk,
      ax - 1,
      ay,
      az,
      ax,
      ay + 1,
      az,
      ax - 1,
      ay + 1,
      az
    );
    v3 = getVertexLightAO(
      buffer,
      neighborBuffers,
      neighborObj,
      cx,
      cz,
      cSun,
      cBlk,
      ax - 1,
      ay,
      az,
      ax,
      ay - 1,
      az,
      ax - 1,
      ay - 1,
      az
    );
  } else if (dir[2] === -1) {
    // -Z
    v0 = getVertexLightAO(
      buffer,
      neighborBuffers,
      neighborObj,
      cx,
      cz,
      cSun,
      cBlk,
      ax - 1,
      ay,
      az,
      ax,
      ay - 1,
      az,
      ax - 1,
      ay - 1,
      az
    );
    v1 = getVertexLightAO(
      buffer,
      neighborBuffers,
      neighborObj,
      cx,
      cz,
      cSun,
      cBlk,
      ax - 1,
      ay,
      az,
      ax,
      ay + 1,
      az,
      ax - 1,
      ay + 1,
      az
    );
    v2 = getVertexLightAO(
      buffer,
      neighborBuffers,
      neighborObj,
      cx,
      cz,
      cSun,
      cBlk,
      ax + 1,
      ay,
      az,
      ax,
      ay + 1,
      az,
      ax + 1,
      ay + 1,
      az
    );
    v3 = getVertexLightAO(
      buffer,
      neighborBuffers,
      neighborObj,
      cx,
      cz,
      cSun,
      cBlk,
      ax + 1,
      ay,
      az,
      ax,
      ay - 1,
      az,
      ax + 1,
      ay - 1,
      az
    );
  }

  // Pack four 10-bit values into a single 40-bit number (safe up to 53 bits in JS floats)
  // v0 is lowest 10 bits, v3 is highest 10 bits
  return v0 + v1 * 1024 + v2 * 1048576 + v3 * 1073741824;
};
