

/**
 * chunkWorker.js — Off-thread chunk generation + greedy mesh worker.
 *
 * WHY A WORKER:
 * generateChunk() runs ~50,000 simplex noise samples + visibility culls + greedy
 * mesh computation per chunk. Running this on the main thread blocks React's
 * render loop → the game visibly freezes every time a new chunk is needed.
 *
 * This worker runs everything on a separate OS thread. The main thread stays
 * at 60 fps during chunk loading — no freezes, no latency spikes.
 *
 * TRANSFERABLE ARRAYBUFFERS:
 * The mesh geometry arrays (pos/norm/idx Float32Array / Uint32Array) can be
 * transferred to the main thread via postMessage transferables rather than
 * structured-cloned (copied). Transferring is O(1) — the ArrayBuffer ownership
 * moves instantly with no data duplication regardless of geometry size.
 * After transfer, the worker's typed arrays become detached (zero bytes) and
 * eligible for GC — no memory leak on the worker side.
 */

import {
  generateChunkPass1,
  generateChunkPass2,
} from '../utils/chunkGenerator.js';
import type { ChunkWorkerRequest, ChunkWorkerResponse } from '../types/workers';
import { CHUNK_VOLUME, getIndex } from '../utils/chunkData.js';
import { buildGreedyArrays } from '../utils/greedyMesh.js';
import {
  generateSunlight,
  generateBlockLight,
  removeLight,
} from '../utils/lighting.js';


const recycledBufferBuckets = {};
for (let i = 8; i <= 24; i++) recycledBufferBuckets[1 << i] = [];
  const getBucket = (size) => {
    let pow = 1;
    while (pow * 2 <= size) pow *= 2;
    return pow;
  };
const MAX_POOL_SIZE = 1500;

let SolidLookup = null;
let FluidLookup = null;
let TextureLookup = null;
let FloraLookup = null;
let TransparentLookup = null;
let isReady = false;

  const computeHeightmap = (buffer) => {
    const heightmap = new Float32Array(256);
    let hIdx = 0;
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        let highest = -999;
        let idx = getIndex(lx, 255, lz);
        
        for (let y = 255; y >= -32; y--) {
          const tex = buffer[idx] & 0xFF;
          if (tex !== 0 && SolidLookup[tex] === 1) {
            highest = y;
            break;
          }
          idx -= 256;
        }
        heightmap[hIdx++] = highest;
      }
    }
    return heightmap;
  };

const extractTransfers = (meshArrays) => {
  const uniqueTransfers = new Set();

  if (meshArrays) {
    if (meshArrays.__flora?.matrices?.buffer?.byteLength > 0) {
      uniqueTransfers.add(meshArrays.__flora.matrices.buffer);
    }
    if (meshArrays.__flora?.packed?.buffer?.byteLength > 0) {
      uniqueTransfers.add(meshArrays.__flora.packed.buffer);
    }
    if (meshArrays.__meta?.heightmap?.buffer?.byteLength > 0) {
      uniqueTransfers.add(meshArrays.__meta.heightmap.buffer);
    }

    for (const [key, arrays] of Object.entries(meshArrays)) {
      if (key === '__meta' || key === '__flora') continue;
      if (Array.isArray(arrays)) {
        for (const part of arrays) {
          if (part.pos?.buffer?.byteLength > 0) uniqueTransfers.add(part.pos.buffer);
          if (part.norm?.buffer?.byteLength > 0) uniqueTransfers.add(part.norm.buffer);
          if (part.color?.buffer?.byteLength > 0) uniqueTransfers.add(part.color.buffer);
          if (part.uv?.buffer?.byteLength > 0) uniqueTransfers.add(part.uv.buffer);
          if (part.idx?.buffer?.byteLength > 0) uniqueTransfers.add(part.idx.buffer);
        }
      }
    }
  }

  return { transferables: Array.from(uniqueTransfers) };
};

self.onmessage = async (e: MessageEvent<ChunkWorkerRequest>) => {
  const data = e.data;
  if (data.type === 'INIT_REGISTRY') {
    SolidLookup = new Uint8Array(data.solidBuffer);
    FluidLookup = new Uint8Array(data.fluidBuffer);
    TextureLookup = new Uint16Array(data.textureBuffer);
    FloraLookup = new Uint8Array(data.floraBuffer);
    TransparentLookup = new Uint8Array(data.transparentBuffer);
    isReady = true;
    return;
  }

  if (data.type === 'PING') {
    self.postMessage({ type: 'PONG' });
    return;
  }
  
  if (data.type === 'RECYCLE') {
    if (data.buffers) {
      let currentSize = 0;
      for (const key in recycledBufferBuckets) currentSize += recycledBufferBuckets[key].length;
      
      for (let i = 0; i < data.buffers.length; i++) {
        if (currentSize >= MAX_POOL_SIZE) break; 
        const buf = data.buffers[i];
        const bucketSize = getBucket(buf.byteLength);
        if (recycledBufferBuckets[bucketSize]) {
           recycledBufferBuckets[bucketSize].push(buf);
           currentSize++;
        }
      }
    }
    return;
  }

  if (!isReady) {
    self.postMessage({
      type: 'error',
      message: 'Worker received generation task before registry initialization.',
      cx: (data as any)?.cx,
      cz: (data as any)?.cz,
    });
    return;
  }

  try {
    if (data.type === 'generatePass1') {
      const { cx, cz, seed } = data;
      const pass1Data = generateChunkPass1(cx, cz, seed);

      // Pass 1 just returns the buffer and neighborBlocks, NO MESHES YET
      self.postMessage(
        { type: 'generatePass1', cx, cz, chunkData: pass1Data },
        [pass1Data.buffer.buffer]
      );
    } else if (data.type === 'generatePass2') {
      const { cx, cz, buffer, getSurfaceHeightMap, seed } = data;

      // We must reconstruct the Int16Array from the raw ArrayBuffer passed to the worker
      const heightMap = new Int16Array(getSurfaceHeightMap);
      const packedBuffer = new Uint32Array(buffer);

      const { buffer: newBuffer, overflow } = generateChunkPass2(
        cx,
        cz,
        packedBuffer,
        heightMap,
        seed
      );

      // After Pass 2, we can finally generate the LightMap and Greedy Mesh!
      // In Pass 2, we don't have neighbor buffers yet... wait!
      // The worker needs neighbor buffers for lighting, just like rebuild mode.
      const neighborBuffers = data.neighborBuffers || [];
      const sunOverflow = generateSunlight(newBuffer, cx, cz, neighborBuffers);
      const blockOverflow = generateBlockLight(
        newBuffer,
        cx,
        cz,
        neighborBuffers
      );
      const lightOverflow = [...sunOverflow, ...blockOverflow];

      const meshArrays = buildGreedyArrays(newBuffer, cx, cz, neighborBuffers, recycledBufferBuckets, SolidLookup, FluidLookup, TextureLookup, FloraLookup, TransparentLookup);
      if (!meshArrays.__meta) meshArrays.__meta = {};
      meshArrays.__meta.heightmap = computeHeightmap(newBuffer);

      const { transferables } = extractTransfers(meshArrays);
      const transferSet = new Set(transferables);
      transferSet.add(newBuffer.buffer); // Pass the final modified Uint32Array back!

      const recycledBuffers = [];
      if (data.neighborBuffers) {
        for (const nb of data.neighborBuffers) {
          if (nb.buffer) {
             const ab = nb.buffer.buffer || nb.buffer;
             recycledBuffers.push(ab);
             transferSet.add(ab);
          }
        }
      }

      self.postMessage(
        {
          type: 'generatePass2',
          cx,
          cz,
          buffer: newBuffer.buffer,
          overflow,
          lightOverflow,
          meshArrays,
          recycledBuffers
        },
        Array.from(transferSet)
      );
    } else if (data.type === 'rebuild') {
      // FAILSAFE 1: Strict Runtime Payload Assertion
      if (data.neighborBuffers && !Array.isArray(data.neighborBuffers)) {
        throw new TypeError(
          `[CRITICAL WORKER FAILSAFE] Expected data.neighborBuffers to be an Array, received: ${typeof data.neighborBuffers}`
        );
      }

      const buffer = data.packedBuffer; // Uint32Array

      // In rebuild mode, neighborBuffers is an array of objects: { cx, cz, buffer }
      const neighborBuffers = data.neighborBuffers || [];

      let cx = data.cx;
      let cz = data.cz;

      // FIX Ghost Lights: Use specifically passed removed lights (from block destruction)
      const removedLightOverflow = [];
      if (data.removedLights && data.removedLights.length > 0) {
        for (const l of data.removedLights) {
          const isSun = l.type === 'sun';
          removedLightOverflow.push(...removeLight(buffer, cx, cz, neighborBuffers, l.x, l.y, l.z, l.val, isSun));
        }
      }

      // Clear existing light in the buffer
      // Bits 22-25: Block Light, Bits 26-29: Sun Light.
      // Mask ~0x3FC00000 clears these bits so the chunk regenerates light purely from scratch.
      for (let i = 0; i < CHUNK_VOLUME; i++) {
        buffer[i] &= ~0x3fc00000;
      }

      // Generate light map seeded from BOTH internal blocks and neighbor buffers
      const sunOverflow = generateSunlight(buffer, cx, cz, neighborBuffers);
      const blockOverflow = generateBlockLight(buffer, cx, cz, neighborBuffers);
      const lightOverflow = [...removedLightOverflow, ...sunOverflow, ...blockOverflow];
      const meshArrays = buildGreedyArrays(buffer, cx, cz, neighborBuffers, recycledBufferBuckets, SolidLookup, FluidLookup, TextureLookup, FloraLookup, TransparentLookup);
      if (!meshArrays.__meta) meshArrays.__meta = {};
      meshArrays.__meta.heightmap = computeHeightmap(buffer);

      const { transferables } = extractTransfers(meshArrays);
      const transferSet = new Set(transferables);
      transferSet.add(buffer.buffer);

      const recycledBuffers = [];
      if (data.neighborBuffers) {
        for (const nb of data.neighborBuffers) {
          if (nb.buffer) {
             const ab = nb.buffer.buffer || nb.buffer;
             recycledBuffers.push(ab);
             transferSet.add(ab);
          }
        }
      }

      self.postMessage(
        { type: 'rebuild', cx, cz, meshArrays, lightOverflow, buffer: buffer.buffer, recycledBuffers },
        Array.from(transferSet)
      );
    }
  } catch (_err) {
    console.error(
      `[ChunkWorker] Fatal Error in Worker Thread for chunk ${data?.cx},${data?.cz}:`,
      _err
    );
    self.postMessage({
      type: 'error',
      message: _err.message,
      stack: _err.stack,
      cx: (data as any)?.cx,
      cz: (data as any)?.cz,
    });
  }
};
