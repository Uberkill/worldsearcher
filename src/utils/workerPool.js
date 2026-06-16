import ChunkWorkerClass from '../workers/chunkWorker.js?worker';
import { useChunkStore } from '../stores/chunkSlice';

let getPass1Cache = null;
const POOL_SIZE = Math.min(
  Math.max(Math.floor((navigator.hardwareConcurrency || 2) / 2), 1),
  4
);

class WorkerManager {
  constructor() {
    this._idle = []; // workerObjs waiting for a job
    this._pending = new Map(); // workerObj → resolve fn
    this._queue = []; // waiting jobs
    this.workers = [];
    this.pingPongPool = [];
    this.activeChunks = new Set(); // Prevent chunk data race conditions

    for (let i = 0; i < POOL_SIZE; i++) {
      this.spawnWorker(i);
    }

    if (import.meta.env.DEV) {
      console.log(
        `[WorkerManager] ${POOL_SIZE} workers ready (${navigator.hardwareConcurrency} logical cores)`
      );
    }

    this.watchdogInterval = setInterval(() => this.watchdogCheck(), 2000);

    // Global telemetry for the Debug Overlay
    window.__workerTelemetry = {
      resets: 0,
      activeJobs: 0,
      poolSize: POOL_SIZE,
      queueLength: 0,
      latencies: [],
      avgLatency: 0,
    };
  }

  spawnWorker(index) {
    const worker = new ChunkWorkerClass();
    const workerObj = {
      instance: worker,
      lastPingTime: Date.now(),
      isBusy: false,
      isDead: false,
      index: index,
    };
    this.workers[index] = workerObj;

    worker.onmessage = ({ data }) => this._onResult(workerObj, data);
    worker.onerror = (e) => this._onError(workerObj, e);

    this._idle.push(workerObj);
  }

  generatePass1(cx, cz, seed) {
    return new Promise((resolve) => {
      const key = `${cx},${cz}`;
      const canDispatch = this._idle.length > 0 && !this.activeChunks.has(key);
      if (canDispatch) {
        const workerObj = this._idle.pop();
        this.activeChunks.add(key);
        this._dispatchGeneratePass1(workerObj, cx, cz, seed, resolve);
      } else {
        this._queue.push({ type: 'generatePass1', cx, cz, seed, resolve });
      }
    });
  }

  generatePass2(cx, cz, buffer, getSurfaceHeightMap, seed) {
    return new Promise((resolve) => {
      const key = `${cx},${cz}`;
      const canDispatch = this._idle.length > 0 && !this.activeChunks.has(key);
      if (canDispatch) {
        const workerObj = this._idle.pop();
        this.activeChunks.add(key);
        this._dispatchGeneratePass2(
          workerObj,
          cx,
          cz,
          buffer,
          getSurfaceHeightMap,
          seed,
          resolve
        );
      } else {
        const firstPass1Idx = this._queue.findIndex((t) => t.type === 'generatePass1');
        const task = {
          type: 'generatePass2',
          cx,
          cz,
          buffer,
          getSurfaceHeightMap,
          seed,
          resolve,
        };
        if (firstPass1Idx !== -1) {
          this._queue.splice(firstPass1Idx, 0, task);
        } else {
          this._queue.push(task);
        }
      }
    });
  }

  cancelGenerate(cx, cz) {
    const idx1 = this._queue.findIndex(
      (t) => t.type === 'generatePass1' && t.cx === cx && t.cz === cz
    );
    if (idx1 !== -1) {
      const task = this._queue.splice(idx1, 1)[0];
      task.resolve({ error: 'CANCELLED' });
    }
    const idx2 = this._queue.findIndex(
      (t) => t.type === 'generatePass2' && t.cx === cx && t.cz === cz
    );
    if (idx2 !== -1) {
      const task = this._queue.splice(idx2, 1)[0];
      task.resolve({ error: 'CANCELLED' });
    }
  }

  cancelRebuild(cx, cz) {
    this._queue = this._queue.filter((t) => {
      if (t.type === 'rebuild' && t.cx === cx && t.cz === cz) {
        t.resolve({ error: 'CANCELLED' });
        return false;
      }
      return true;
    });
  }

  cancelAllPending() {
    this._queue.forEach(t => t.resolve({ error: 'CANCELLED' }));
    this._queue = [];
    for (const resolve of this._pending.values()) {
      resolve({ error: 'CANCELLED' });
    }
    this._pending.clear();
    if (window.__workerTelemetry) {
      window.__workerTelemetry.activeJobs = 0;
      window.__workerTelemetry.queueLength = 0;
    }
  }

  rebuild(packedBuffer, neighborBuffers, cx, cz, seed, removedLights, isHighPriority = false) {
    return new Promise((resolve) => {
      const key = `${cx},${cz}`;
      const canDispatch = this._idle.length > 0 && !this.activeChunks.has(key);
      
      if (canDispatch) {
        const workerObj = this._idle.pop();
        this.activeChunks.add(key);
        this._dispatchRebuild(
          workerObj,
          cx,
          cz,
          packedBuffer,
          neighborBuffers,
          resolve,
          removedLights
        );
      } else {
        // PRIORITY: High-priority mesh rebuilds (breaking/placing blocks by player) jump ahead of generation!
        // Low-priority rebuilds (decorator bleeds) append to the back to prevent blocking terrain queue.
        const firstGenIdx = this._queue.findIndex(
          (t) => t.type === 'generatePass1' || t.type === 'generatePass2'
        );
        const task = {
          type: 'rebuild',
          cx,
          cz,
          packedBuffer,
          neighborBuffers,
          resolve,
          removedLights,
        };

        if (isHighPriority && firstGenIdx !== -1) {
          this._queue.splice(firstGenIdx, 0, task);
        } else {
          this._queue.push(task);
        }
      }
    });
  }

  recycleBuffers(toRecycle) {
    if (!toRecycle || toRecycle.length === 0) return;
    const batches = Array.from({ length: POOL_SIZE }, () => []);
    toRecycle.forEach((buf, i) => batches[i % POOL_SIZE].push(buf));
    batches.forEach((batch, i) => {
        if (batch.length > 0) {
            const workerObj = this.workers[i];
            if (workerObj && !workerObj.isDead) {
                const MAX_TRANSFER = 50;
                for (let k = 0; k < batch.length; k += MAX_TRANSFER) {
                    const subBatch = batch.slice(k, k + MAX_TRANSFER);
                    try {
                        workerObj.instance.postMessage({ type: 'RECYCLE', buffers: subBatch }, subBatch);
                    } catch(_e) {}
                }
            }
        }
    });
  }

  watchdogCheck() {
    const NOW = Date.now();
    const TIMEOUT_LIMIT = 30000;

    this.workers.forEach((workerObj, index) => {
      if (workerObj.isBusy && NOW - workerObj.lastPingTime > TIMEOUT_LIMIT) {
        console.warn(
          `[WorkerManager] Worker ${index} froze or crashed silently! Terminating and resetting...`
        );

        try {
          workerObj.instance.terminate();
        } catch {}
        workerObj.isDead = true;
        window.__workerTelemetry.resets++;

        const resolve = this._pending.get(workerObj);
        if (resolve) resolve({ error: 'WORKER_TIMEOUT' });
        this._pending.delete(workerObj);
        window.__workerTelemetry.activeJobs = this._pending.size;

        this._idle = this._idle.filter((w) => w !== workerObj);
        this.spawnWorker(index);
        this.processNextJob();
      } else if (!workerObj.isDead) {
        workerObj.instance.postMessage({ type: 'PING' });
      }
    });
  }

  processNextJob() {
    window.__workerTelemetry.queueLength = this._queue.length;
    if (this._queue.length > 0) {
      if (this._idle.length > 0) {
        // Find the first task whose chunk isn't actively being processed by another worker
        const taskIdx = this._queue.findIndex((t) => !this.activeChunks.has(`${t.cx},${t.cz}`));
        
        if (taskIdx !== -1) {
          const workerObj = this._idle.pop();
          const task = this._queue.splice(taskIdx, 1)[0];
          this.activeChunks.add(`${task.cx},${task.cz}`);
          
          if (task.type === 'generatePass1') {
            this._dispatchGeneratePass1(
              workerObj,
              task.cx,
              task.cz,
              task.seed,
              task.resolve
            );
          } else if (task.type === 'generatePass2') {
            this._dispatchGeneratePass2(
              workerObj,
              task.cx,
              task.cz,
              task.buffer,
              task.getSurfaceHeightMap,
              task.seed,
              task.resolve
            );
          } else if (task.type === 'rebuild') {
            this._dispatchRebuild(
              workerObj,
              task.cx,
              task.cz,
              task.packedBuffer,
              task.neighborBuffers,
              task.resolve,
              task.removedLights
            );
          }
        }
      }
    }
  }

  _dispatchGeneratePass1(workerObj, cx, cz, seed, resolve) {
    workerObj.isBusy = true;
    workerObj.activeChunkKey = `${cx},${cz}`;
    workerObj.lastPingTime = Date.now();
    workerObj.startTime = performance.now();
    this._pending.set(workerObj, resolve);
    window.__workerTelemetry.activeJobs = this._pending.size;
    workerObj.instance.postMessage({ type: 'generatePass1', cx, cz, seed });
  }

  _dispatchGeneratePass2(
    workerObj,
    cx,
    cz,
    buffer,
    getSurfaceHeightMap,
    seed,
    resolve
  ) {
    workerObj.isBusy = true;
    workerObj.activeChunkKey = `${cx},${cz}`;
    workerObj.lastPingTime = Date.now();
    workerObj.startTime = performance.now();
    this._pending.set(workerObj, resolve);
    window.__workerTelemetry.activeJobs = this._pending.size;

    try {
      // Gather neighbor buffers for mesh building step!
      // Use injected getPass1Cache to avoid circular dependency
      const chunkStore = useChunkStore.getState();
      const neighborBuffers = [];
      const pass1Cache = getPass1Cache ? getPass1Cache() : null;

      for (let nx = -1; nx <= 1; nx++) {
        for (let nz = -1; nz <= 1; nz++) {
          if (nx === 0 && nz === 0) continue;
          const key = `${cx + nx},${cz + nz}`;
          let nBuffer = null;

          if (chunkStore.chunks[key] && chunkStore.chunks[key].buffer) {
            nBuffer = chunkStore.chunks[key].buffer;
          } else if (pass1Cache && pass1Cache.has(key)) {
            nBuffer = pass1Cache.get(key).buffer;
          }

          if (nBuffer) {
            neighborBuffers.push({ cx: cx + nx, cz: cz + nz, buffer: nBuffer });
          }
        }
      }

      // Guard: buffer and getSurfaceHeightMap must be live (non-null, non-detached) TypedArrays.
      // If a chunk was evicted by NO_DATA and re-queued, the original pass1Data TypedArrays may be
      // detached (byteLength === 0) because their underlying ArrayBuffers were previously transferred.
      // Sending a detached or null buffer to the worker causes "Cannot convert null object" in
      // `new Float32Array(getSurfaceHeightMap)` inside chunkWorker.js.
      if (!buffer || !buffer.buffer || buffer.buffer.byteLength === 0) {
        console.warn(`[WorkerManager] Pass2 dispatch aborted for ${cx},${cz}: packedBuffer is null or detached.`);
        this._pending.delete(workerObj);
        workerObj.isBusy = false;
        resolve({ error: 'DETACHED_BUFFER' });
        this._idle.push(workerObj);
        this.processNextJob();
        return;
      }
      if (!getSurfaceHeightMap || !getSurfaceHeightMap.buffer || getSurfaceHeightMap.buffer.byteLength === 0) {
        console.warn(`[WorkerManager] Pass2 dispatch aborted for ${cx},${cz}: heightMap is null or detached.`);
        this._pending.delete(workerObj);
        workerObj.isBusy = false;
        resolve({ error: 'DETACHED_BUFFER' });
        this._idle.push(workerObj);
        this.processNextJob();
        return;
      }

      const packedBuf = buffer.buffer;

      // Implement Input Ping-Pong Pool to eliminate 2.8MB GC Spikes!
      const transfers = new Set();
      
      let pBuf = this.pingPongPool.pop();
      if (!pBuf || pBuf.byteLength !== packedBuf.byteLength) pBuf = new ArrayBuffer(packedBuf.byteLength);
      new Uint32Array(pBuf).set(new Uint32Array(packedBuf));
      transfers.add(pBuf);

      const safeNeighborBuffers = neighborBuffers.map(n => {
         if (!n.buffer || n.buffer.byteLength === 0) return { cx: n.cx, cz: n.cz, buffer: new Uint32Array(0) };
         let nBuf = this.pingPongPool.pop();
         if (!nBuf || nBuf.byteLength !== n.buffer.byteLength) nBuf = new ArrayBuffer(n.buffer.byteLength);
         const sourceArray = n.buffer instanceof Uint32Array ? n.buffer : new Uint32Array(n.buffer);
         new Uint32Array(nBuf).set(sourceArray);
         transfers.add(nBuf);
         return { cx: n.cx, cz: n.cz, buffer: new Uint32Array(nBuf) };
      });

      workerObj.instance.postMessage(
        {
          type: 'generatePass2',
          cx,
          cz,
          buffer: pBuf,
          getSurfaceHeightMap: getSurfaceHeightMap.buffer,
          seed,
          neighborBuffers: safeNeighborBuffers,
        },
        Array.from(transfers)
      );
    } catch (e) {
      console.error('[WorkerManager] Generate postMessage failed:', e);
      this._pending.delete(workerObj);
      workerObj.isBusy = false;
      resolve({ error: 'POST_MESSAGE_FAILED' });
      this._idle.push(workerObj);
      this.processNextJob();
    }
  }

  _dispatchRebuild(
    workerObj,
    cx,
    cz,
    packedBuffer,
    neighborBuffers,
    resolve,
    removedLights
  ) {
    workerObj.isBusy = true;
    workerObj.activeChunkKey = `${cx},${cz}`;
    workerObj.lastPingTime = Date.now();
    workerObj.startTime = performance.now();
    this._pending.set(workerObj, resolve);
    window.__workerTelemetry.activeJobs = this._pending.size;

    const uniqueTransfers = new Set();

    // Also ensure packedBuffer and neighborBuffers aren't detached!
    if (packedBuffer && packedBuffer.byteLength === 0) {
      console.error('[WorkerManager] packedBuffer is detached!');
      resolve({ error: 'DETACHED_BUFFER' });
      this._idle.push(workerObj);
      this._pending.delete(workerObj);
      workerObj.isBusy = false;
      this.processNextJob();
      return;
    }

    try {
      let safePackedBuffer = packedBuffer;
      if (packedBuffer && packedBuffer.buffer) {
         let pBuf = this.pingPongPool.pop();
         if (!pBuf || pBuf.byteLength !== packedBuffer.buffer.byteLength) pBuf = new ArrayBuffer(packedBuffer.buffer.byteLength);
         new Uint32Array(pBuf).set(new Uint32Array(packedBuffer.buffer));
         uniqueTransfers.add(pBuf);
         safePackedBuffer = new Uint32Array(pBuf);
      }

      const safeNeighborBuffers = neighborBuffers ? neighborBuffers.map(n => {
         if (!n.buffer || n.buffer.byteLength === 0) return { cx: n.cx, cz: n.cz, buffer: new Uint32Array(0) };
         let nBuf = this.pingPongPool.pop();
         if (!nBuf || nBuf.byteLength !== n.buffer.byteLength) nBuf = new ArrayBuffer(n.buffer.byteLength);
         const sourceArray = n.buffer instanceof Uint32Array ? n.buffer : new Uint32Array(n.buffer);
         new Uint32Array(nBuf).set(sourceArray);
         uniqueTransfers.add(nBuf);
         return { cx: n.cx, cz: n.cz, buffer: new Uint32Array(nBuf) };
      }) : [];

      workerObj.instance.postMessage(
        {
          type: 'rebuild',
          cx,
          cz,
          packedBuffer: safePackedBuffer,
          neighborBuffers: safeNeighborBuffers,
          removedLights,
        },
        Array.from(uniqueTransfers)
      );
    } catch (e) {
      console.error('[WorkerManager] Rebuild postMessage failed:', e);
      this._pending.delete(workerObj);
      workerObj.isBusy = false;
      resolve({ error: 'POST_MESSAGE_FAILED' });
      this._idle.push(workerObj);
      this.processNextJob();
    }
  }

  _onResult(workerObj, data) {
    if (data.type === 'PONG') {
      workerObj.lastPingTime = Date.now();
      return;
    }

    workerObj.isBusy = false;
    if (workerObj.activeChunkKey) {
        this.activeChunks.delete(workerObj.activeChunkKey);
        workerObj.activeChunkKey = null;
    }

    if (workerObj.startTime) {
      const ms = performance.now() - workerObj.startTime;
      const t = window.__workerTelemetry;
      t.latencies.push(ms);
      if (t.latencies.length > 50) t.latencies.shift();
      t.avgLatency = Math.round(
        t.latencies.reduce((a, b) => a + b, 0) / t.latencies.length
      );
      workerObj.startTime = 0;
    }

    const resolve = this._pending.get(workerObj);
    if (resolve) {
      this._pending.delete(workerObj);
      window.__workerTelemetry.activeJobs = this._pending.size;

      if (data.recycledBuffers) {
        for (const rb of data.recycledBuffers) {
           if (rb && rb.byteLength > 0 && this.pingPongPool.length < 50) {
             this.pingPongPool.push(rb);
           }
        }
      }

      if (data.type === 'CORRUPTED_SAVE') {
        resolve({ error: 'CORRUPTED_SAVE', chunkKey: data.chunkKey });
      } else if (data.type === 'error') {
        resolve({ error: data.message });
      } else if (data.type === 'generatePass1') {
        resolve(data.chunkData);
      } else if (data.type === 'generatePass2') {
        resolve(data);
      } else if (data.type === 'rebuild') {
        resolve({ meshArrays: data.meshArrays, lightOverflow: data.lightOverflow, buffer: data.buffer });
      } else {
        resolve({ error: 'UNKNOWN_PAYLOAD' });
      }
    }

    this._idle.push(workerObj);
    this.processNextJob();
  }

  _onError(workerObj, e) {
    console.error('[WorkerManager] worker error:', e?.message || e);
    workerObj.isBusy = false;
    if (workerObj.activeChunkKey) {
        this.activeChunks.delete(workerObj.activeChunkKey);
        workerObj.activeChunkKey = null;
    }

    const resolve = this._pending.get(workerObj);
    if (resolve) resolve({ error: 'WORKER_FATAL_ERROR' });
    this._pending.delete(workerObj);
    window.__workerTelemetry.activeJobs = this._pending.size;

    try {
      workerObj.instance.terminate();
    } catch {}
    workerObj.isDead = true;
    window.__workerTelemetry.resets++;

    this._idle = this._idle.filter((w) => w !== workerObj);
    this.spawnWorker(workerObj.index);
    this.processNextJob();
  }

  terminateAll() {
    clearInterval(this.watchdogInterval);
    for (const w of this.workers) {
      if (w && w.instance) {
        try {
          w.instance.terminate();
        } catch {}
      }
    }
    this._idle = [];
    for (const resolve of this._pending.values()) {
      resolve({ error: 'WORKER_TERMINATED' });
    }
    this._pending.clear();
  }
}

// Singleton — one pool for the whole app
export const chunkWorkerPool = new WorkerManager();

export const injectWorkerDependencies = (pass1CacheGetter) => {
    getPass1Cache = pass1CacheGetter;
};

// Fix: Prevent massive Web Worker memory leak on Vite HMR
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    chunkWorkerPool.terminateAll();
  });
}
