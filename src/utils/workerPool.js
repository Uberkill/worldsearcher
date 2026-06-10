import ChunkWorkerClass from '../workers/chunkWorker.js?worker';
import { useChunkStore } from '../stores/chunkSlice';

let getPass1Cache = null;
const POOL_SIZE = Math.min(
  Math.max((navigator.hardwareConcurrency || 2) - 1, 1),
  8
);

class WorkerManager {
  constructor() {
    this._idle = []; // workerObjs waiting for a job
    this._pending = new Map(); // workerObj → resolve fn
    this._queue = []; // waiting jobs
    this.workers = [];

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
      const workerObj = this._idle.pop();
      if (workerObj) {
        this._dispatchGeneratePass1(workerObj, cx, cz, seed, resolve);
      } else {
        this._queue.push({ type: 'generatePass1', cx, cz, seed, resolve });
      }
    });
  }

  generatePass2(cx, cz, buffer, getSurfaceHeightMap, seed) {
    return new Promise((resolve) => {
      const workerObj = this._idle.pop();
      if (workerObj) {
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

  rebuild(packedBuffer, neighborBuffers, cx, cz, seed, removedLights) {
    return new Promise((resolve) => {
      const workerObj = this._idle.pop();
      if (workerObj) {
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
        // PRIORITY: Mesh rebuilds (breaking/placing blocks) must jump ahead of chunk generation!
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

        if (firstGenIdx !== -1) {
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
                try {
                    workerObj.instance.postMessage({ type: 'RECYCLE', buffers: batch }, batch);
                } catch(_e) {}
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
      const workerObj = this._idle.pop();
      if (workerObj) {
        const task = this._queue.shift();
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

  _dispatchGeneratePass1(workerObj, cx, cz, seed, resolve) {
    workerObj.isBusy = true;
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

      // IMPORTANT: Do NOT transfer the heightmap buffer!
      // getSurfaceHeightMap is ~1KB (16×16 float32). Cloning it via structured-clone is free (<0.01ms).
      // If we transferred it, the Float32Array in pass1Cache would become detached (byteLength=0).
      // A re-queued chunk would then hit the guard above and bail with DETACHED_BUFFER — that's correct
      // fallback behaviour. But even without re-queuing, a transferred heightmap causes the next
      // neighbor that reads pass1Cache to crash. Always clone it.
      //
      // [ARCHITECTURAL CONSTRAINT: DO NOT TOUCH]
      // Why are we cloning `packedBuf` and `neighborBuffers` instead of transferring them?
      //
      // 1. If we transfer `packedBuf`, it becomes detached (neutered) on the main thread.
      //    But `packedBuf` lives in `pass1Cache` and is actively used by neighboring chunks
      //    to build their own boundary meshes! Detaching it crashes the neighboring chunk generations.
      // 2. Why not use `SharedArrayBuffer`? Because of strict CORS / Cross-Origin Isolation constraints
      //    on modern web browsers. Enabling SABs breaks many external assets and CDNs.
      // 3. Why not extract thin 1D slices on the main thread? Looping 4096 times per neighbor on the
      //    main thread causes severe frame drops. The browser's native C++ structured clone algorithm
      //    (`postMessage`) can clone 1.1MB of contiguous memory in < 1ms, which is vastly faster.
      workerObj.instance.postMessage(
        {
          type: 'generatePass2',
          cx,
          cz,
          buffer: packedBuf,
          getSurfaceHeightMap: getSurfaceHeightMap.buffer,
          seed,
          neighborBuffers,
        },
        [] // No transfers — everything is structured-cloned to keep pass1Cache buffers alive.
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
      workerObj.instance.postMessage(
        {
          type: 'rebuild',
          cx,
          cz,
          packedBuffer,
          neighborBuffers,
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
