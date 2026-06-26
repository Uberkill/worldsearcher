import ChunkWorkerClass from '../workers/chunkWorker?worker';
import { useChunkStore } from '../stores/chunkSlice';
import { getBinaryRegistries } from '../registry/BlockRegistry';
import type { ChunkWorkerRequest, ChunkWorkerResponse } from '../types/workers';

let getPass1Cache: (() => Map<string, any>) | null = null;
const POOL_SIZE = Math.min(
  Math.max(Math.floor((navigator.hardwareConcurrency || 2) / 2), 1),
  4
);

interface WorkerObj {
  instance: Worker;
  lastPingTime: number;
  isBusy: boolean;
  isDead: boolean;
  index: number;
  activeChunkKey?: string | null;
  startTime?: number;
}

interface WorkerTask {
  type: string;
  cx?: number;
  cz?: number;
  seed?: number;
  buffer?: Uint32Array | ArrayBuffer;
  getSurfaceHeightMap?: Int16Array;
  packedBuffer?: Uint32Array;
  neighborBuffers?: Array<{cx: number, cz: number, buffer: Uint32Array}>;
  removedLights?: any[];
  isHighPriority?: boolean;
  resolve: (value: any) => void;
}

class WorkerManager {
  _idle: WorkerObj[];
  _pending: Map<WorkerObj, (value: any) => void>;
  _queue: WorkerTask[];
  workers: WorkerObj[];
  pingPongPool: ArrayBuffer[];
  activeChunks: Set<string>;
  cancelledInFlight: Set<string>;
  _ingestionQueue: Array<() => void>;
  _ingestionRunning: boolean;
  watchdogInterval?: ReturnType<typeof setInterval>;

  constructor() {
    this._idle = []; // workerObjs waiting for a job
    this._pending = new Map(); // workerObj → resolve fn
    this._queue = []; // waiting jobs
    this.workers = [];
    this.pingPongPool = [];
    this.activeChunks = new Set(); // Prevent chunk data race conditions
    this.cancelledInFlight = new Set();
    this._ingestionQueue = [];
    this._ingestionRunning = false;

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

  _processIngestionQueue() {
    if (this._ingestionQueue.length === 0) {
      this._ingestionRunning = false;
      return;
    }
    
    // Resolve 1 chunk per frame to protect GPU budget
    const task = this._ingestionQueue.shift();
    task(); 
    
    requestAnimationFrame(() => this._processIngestionQueue());
  }

  spawnWorker(index: number) {
    const worker = new ChunkWorkerClass();
    const workerObj = {
      instance: worker,
      lastPingTime: Date.now(),
      isBusy: false,
      isDead: false,
      index: index,
    };
    this.workers[index] = workerObj;

    worker.onmessage = ({ data }: MessageEvent<ChunkWorkerResponse>) => this._onResult(workerObj, data);
    worker.onerror = (e) => this._onError(workerObj, e);

    const registries = getBinaryRegistries();
    const solidBuf = registries.solidBuffer.slice(0);
    const fluidBuf = registries.fluidBuffer.slice(0);
    const texBuf = registries.textureBuffer.slice(0);
    const floraBuf = registries.floraBuffer.slice(0);
    const transBuf = registries.transparentBuffer.slice(0);
    
    worker.postMessage({
      type: 'INIT_REGISTRY',
      solidBuffer: solidBuf,
      fluidBuffer: fluidBuf,
      textureBuffer: texBuf,
      floraBuffer: floraBuf,
      transparentBuffer: transBuf
    }, [solidBuf, fluidBuf, texBuf, floraBuf, transBuf]);

    this._idle.push(workerObj);
  }

  generatePass1(cx: number, cz: number, seed: number) {
    return new Promise((resolve) => {
      this._queue.push({ type: 'generatePass1', cx, cz, seed, resolve });
      this.processNextJob();
    });
  }

  generatePass2(cx: number, cz: number, buffer: ArrayBuffer, getSurfaceHeightMap: Int16Array, seed: number) {
    return new Promise((resolve) => {
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
      this.processNextJob();
    });
  }

  cancelGenerate(cx: number, cz: number) {
    const key = `${cx},${cz}`;
    if (this.activeChunks.has(key)) {
      this.cancelledInFlight.add(key);
    }
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

  cancelRebuild(cx: number, cz: number) {
    const key = `${cx},${cz}`;
    if (this.activeChunks.has(key)) {
      this.cancelledInFlight.add(key);
    }
    this._queue = this._queue.filter((t) => {
      if (t.type === 'rebuild' && t.cx === cx && t.cz === cz) {
        t.resolve({ error: 'CANCELLED' });
        return false;
      }
      return true;
    });
  }

  cancelAllPending() {
    for (const key of this.activeChunks) {
      this.cancelledInFlight.add(key);
    }
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

  rebuild(packedBuffer: Uint32Array, neighborBuffers: Array<{cx: number, cz: number, buffer: Uint32Array}>, cx: number, cz: number, seed: number, removedLights?: any[], isHighPriority = false) {
    return new Promise((resolve) => {
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
        isHighPriority
      };

      if (isHighPriority && firstGenIdx !== -1) {
        this._queue.splice(firstGenIdx, 0, task);
      } else {
        this._queue.push(task);
      }
      this.processNextJob();
    });
  }

  recycleBuffers(toRecycle: ArrayBuffer[]) {
    if (!toRecycle || toRecycle.length === 0) return;
    const batches = Array.from({ length: POOL_SIZE }, () => []);
    toRecycle.forEach((buf, i) => {
      if (buf.byteLength === 294912 || buf.byteLength === 262144) {
        if (this.pingPongPool.length < 50) this.pingPongPool.push(buf);
      } else {
        batches[i % POOL_SIZE].push(buf);
      }
    });
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

        if (workerObj.activeChunkKey) {
            this.activeChunks.delete(workerObj.activeChunkKey);
            workerObj.activeChunkKey = null;
        }

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
        let taskIdx = this._queue.findIndex((t) => !this.activeChunks.has(`${t.cx},${t.cz}`));
        
        if (taskIdx !== -1) {
          const taskObjCheck = this._queue[taskIdx];
          // Reserve the last idle worker for fast tasks (like block breaking).
          if (this._idle.length === 1 && POOL_SIZE > 1 && (taskObjCheck.type === 'generatePass1' || taskObjCheck.type === 'generatePass2')) {
            const rebuildIdx = this._queue.findIndex(t => t.type === 'rebuild' && !this.activeChunks.has(`${t.cx},${t.cz}`));
            if (rebuildIdx !== -1) {
              taskIdx = rebuildIdx;
            } else {
              return;
            }
          }

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

  _dispatchGeneratePass1(workerObj: WorkerObj, cx: number, cz: number, seed: number, resolve: (v: any) => void) {
    workerObj.isBusy = true;
    workerObj.activeChunkKey = `${cx},${cz}`;
    workerObj.lastPingTime = Date.now();
    workerObj.startTime = performance.now();
    this._pending.set(workerObj, resolve);
    window.__workerTelemetry.activeJobs = this._pending.size;
    workerObj.instance.postMessage({ type: 'generatePass1', cx, cz, seed });
  }

  _dispatchGeneratePass2(
    workerObj: WorkerObj,
    cx: number,
    cz: number,
    buffer: ArrayBuffer | Uint32Array,
    getSurfaceHeightMap: Int16Array | any,
    seed: number,
    resolve: (v: any) => void
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

      // Implement Input Ping-Pong Pool to eliminate 2.8MB GC Spikes!
      const transfers = new Set();
      
      let pBuf = this.pingPongPool.pop();
      if (!pBuf || pBuf.byteLength !== buffer.byteLength) pBuf = new ArrayBuffer(buffer.byteLength);
      const sourceArray = buffer instanceof Uint32Array ? buffer : new Uint32Array(buffer);
      new Uint32Array(pBuf).set(sourceArray);
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
    workerObj: WorkerObj,
    cx: number,
    cz: number,
    packedBuffer: Uint32Array,
    neighborBuffers: Array<{cx: number, cz: number, buffer: Uint32Array}>,
    resolve: (v: any) => void,
    removedLights?: any[]
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
      if (packedBuffer && packedBuffer.byteLength > 0) {
         let pBuf = this.pingPongPool.pop();
         if (!pBuf || pBuf.byteLength !== packedBuffer.byteLength) pBuf = new ArrayBuffer(packedBuffer.byteLength);
         const sourceArray = packedBuffer instanceof Uint32Array ? packedBuffer : new Uint32Array(packedBuffer);
         new Uint32Array(pBuf).set(sourceArray);
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
      resolve(new Error('POST_MESSAGE_FAILED'));
      this._idle.push(workerObj);
      this.processNextJob();
    }
  }

  _onResult(workerObj: WorkerObj, data: ChunkWorkerResponse) {
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
      } else {
        const chunkKey = `${data.cx},${data.cz}`;
        this._ingestionQueue.push(() => {
          if (this.cancelledInFlight.has(chunkKey)) {
             this.cancelledInFlight.delete(chunkKey);
             if (data.buffer && (data.buffer.byteLength === 294912 || data.buffer.byteLength === 262144)) {
                 if (this.pingPongPool.length < 50) this.pingPongPool.push(data.buffer);
             } else if (data.buffer) {
                 this.recycleBuffers([data.buffer]);
             }
             if (data.meshArrays) {
                 const toRecycle = [];
                 for (const val of Object.values(data.meshArrays)) {
                     if (val instanceof Float32Array || val instanceof Uint32Array) {
                         toRecycle.push(val.buffer);
                     }
                 }
                 this.recycleBuffers(toRecycle);
             }
             resolve({ error: 'CANCELLED_IN_FLIGHT' });
             return;
          }
          if (data.type === 'generatePass2') {
            resolve(data);
          } else if (data.type === 'rebuild') {
            resolve({ meshArrays: data.meshArrays, lightOverflow: data.lightOverflow, buffer: data.buffer });
          } else {
            resolve({ error: 'UNKNOWN_PAYLOAD' });
          }
        });

        if (!this._ingestionRunning) {
          this._ingestionRunning = true;
          requestAnimationFrame(() => this._processIngestionQueue());
        }
      }
    }

    this._idle.push(workerObj);
    this.processNextJob();
  }

  _onError(workerObj: WorkerObj, e: any) {
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

export const injectWorkerDependencies = (pass1CacheGetter: () => Map<string, any>) => {
    getPass1Cache = pass1CacheGetter;
};

// Fix: Prevent massive Web Worker memory leak on Vite HMR
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    chunkWorkerPool.terminateAll();
  });
}
