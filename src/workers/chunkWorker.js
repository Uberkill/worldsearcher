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

import { generateChunkPass1, generateChunkPass2 } from '../utils/chunkGenerator.js';
import { buildGreedyArrays } from '../utils/greedyMesh.js';
import { generateSunlight, generateBlockLight, removeLight } from '../utils/lighting.js';

const extractTransfers = (meshArrays) => {
  const uniqueTransfers = new Set();
  
  if (meshArrays) {
    for (const arrays of Object.values(meshArrays)) {
      if (arrays.pos?.buffer?.byteLength > 0) uniqueTransfers.add(arrays.pos.buffer);
      if (arrays.norm?.buffer?.byteLength > 0) uniqueTransfers.add(arrays.norm.buffer);
      if (arrays.color?.buffer?.byteLength > 0) uniqueTransfers.add(arrays.color.buffer);
      if (arrays.uv?.buffer?.byteLength > 0) uniqueTransfers.add(arrays.uv.buffer);
      if (arrays.idx?.buffer?.byteLength > 0) uniqueTransfers.add(arrays.idx.buffer);
    }
  }

  return { transferables: Array.from(uniqueTransfers) };
};

self.onmessage = async ({ data }) => {
  if (data.type === 'PING') {
    self.postMessage({ type: 'PONG' });
    return;
  }
  
  try {
    if (data.type === 'generatePass1') {
      const { cx, cz, seed } = data;
       const pass1Data = generateChunkPass1(cx, cz, seed);
      
      // Pass 1 just returns the buffer and neighborBlocks, NO MESHES YET
      self.postMessage({ type: 'generatePass1', cx, cz, chunkData: pass1Data }, [pass1Data.buffer.buffer]);
      
    } else if (data.type === 'generatePass2') {
      const { cx, cz, buffer, getSurfaceHeightMap, seed } = data;
      
      // We must reconstruct the Float32Array from the raw ArrayBuffer passed to the worker
      const heightMap = new Float32Array(getSurfaceHeightMap);
      const packedBuffer = new Uint32Array(buffer);
      
       const { buffer: newBuffer, overflow } = generateChunkPass2(cx, cz, packedBuffer, heightMap, seed);
      
      // After Pass 2, we can finally generate the LightMap and Greedy Mesh!
      // In Pass 2, we don't have neighbor buffers yet... wait!
      // The worker needs neighbor buffers for lighting, just like rebuild mode.
      const neighborBuffers = data.neighborBuffers || [];
      const sunOverflow = generateSunlight(newBuffer, cx, cz, neighborBuffers);
        const blockOverflow = generateBlockLight(newBuffer, cx, cz, neighborBuffers);
        const lightOverflow = [...sunOverflow, ...blockOverflow];
      const meshArrays = buildGreedyArrays(newBuffer, cx, cz, neighborBuffers);
      
      const { transferables } = extractTransfers(meshArrays);
      transferables.push(newBuffer.buffer); // Pass the final modified Uint32Array back!
      
       self.postMessage({ type: 'generatePass2', cx, cz, buffer: newBuffer.buffer, overflow, meshArrays }, transferables);
      
    } else if (data.type === 'rebuild') {
      // FAILSAFE 1: Strict Runtime Payload Assertion
      if (data.neighborBuffers && !Array.isArray(data.neighborBuffers)) {
         throw new TypeError(`[CRITICAL WORKER FAILSAFE] Expected data.neighborBuffers to be an Array, received: ${typeof data.neighborBuffers}`);
      }
      
      const buffer = data.packedBuffer; // Uint32Array
      
      // In rebuild mode, neighborBuffers is an array of objects: { cx, cz, buffer }
      const neighborBuffers = data.neighborBuffers || [];
      
      let cx = data.cx;
      let cz = data.cz;
      
      // Generate light map seeded from BOTH internal blocks and neighbor buffers
      const sunOverflow = generateSunlight(buffer, cx, cz, neighborBuffers);
      const blockOverflow = generateBlockLight(buffer, cx, cz, neighborBuffers);
      const lightOverflow = [...sunOverflow, ...blockOverflow];
      const meshArrays = buildGreedyArrays(buffer, cx, cz, neighborBuffers);
      
      const { transferables } = extractTransfers(meshArrays);
      self.postMessage({ type: 'rebuild', cx, cz, meshArrays, lightOverflow }, transferables);
    }
  } catch (err) {
    console.error(`[ChunkWorker] Fatal Error in Worker Thread for chunk ${data?.cx},${data?.cz}:`, err);
    self.postMessage({ type: 'error', message: err.message, stack: err.stack, cx: data?.cx, cz: data?.cz });
  }
};
