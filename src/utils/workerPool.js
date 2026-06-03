import ChunkWorkerClass from '../workers/chunkWorker.js?worker';
import { playerPosition } from '../globals.js';
import { useStore } from '../stores/useStore';

const POOL_SIZE = Math.min(
  Math.max((navigator.hardwareConcurrency || 2) - 1, 1),
  8
);

class WorkerManager {
  constructor() {
    this._idle    = []; // workerObjs waiting for a job
    this._pending = new Map(); // workerObj → resolve fn
    this._queue   = []; // waiting jobs
    this.workers = [];

    for (let i = 0; i < POOL_SIZE; i++) {
      this.spawnWorker(i);
    }

    if (import.meta.env.DEV) {
      console.log(`[WorkerManager] ${POOL_SIZE} workers ready (${navigator.hardwareConcurrency} logical cores)`);
    }

    setInterval(() => this.watchdogCheck(), 2000);
    
    // Global telemetry for the Debug Overlay
    window.__workerTelemetry = { resets: 0, activeJobs: 0, poolSize: POOL_SIZE, queueLength: 0, latencies: [], avgLatency: 0 };
  }

  spawnWorker(index) {
    const worker = new ChunkWorkerClass();
    const workerObj = {
      instance: worker,
      lastPingTime: Date.now(),
      isBusy: false,
      isDead: false,
      index: index
    };
    this.workers[index] = workerObj;

    worker.onmessage  = ({ data }) => this._onResult(workerObj, data);
    worker.onerror    = (e)        => this._onError(workerObj, e);

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
        this._dispatchGeneratePass2(workerObj, cx, cz, buffer, getSurfaceHeightMap, seed, resolve);
      } else {
        this._queue.push({ type: 'generatePass2', cx, cz, buffer, getSurfaceHeightMap, seed, resolve });
      }
    });
  }

  cancelGenerate(cx, cz) {
    const idx1 = this._queue.findIndex(t => t.type === 'generatePass1' && t.cx === cx && t.cz === cz);
    if (idx1 !== -1) {
      const task = this._queue.splice(idx1, 1)[0];
      task.resolve({ error: 'CANCELLED' }); 
    }
    const idx2 = this._queue.findIndex(t => t.type === 'generatePass2' && t.cx === cx && t.cz === cz);
    if (idx2 !== -1) {
      const task = this._queue.splice(idx2, 1)[0];
      task.resolve({ error: 'CANCELLED' }); 
    }
  }

  rebuild(packedBuffer, neighborBuffers, cx, cz, seed, removedLights) {
    return new Promise((resolve) => {
      const workerObj = this._idle.pop();
      if (workerObj) {
        this._dispatchRebuild(workerObj, cx, cz, packedBuffer, neighborBuffers, resolve, removedLights);
      } else {
        // PRIORITY: Mesh rebuilds (breaking/placing blocks) must jump ahead of chunk generation!
        const firstGenIdx = this._queue.findIndex(t => t.type === 'generatePass1' || t.type === 'generatePass2');
        const task = { type: 'rebuild', cx, cz, packedBuffer, neighborBuffers, resolve, removedLights };
        
        if (firstGenIdx !== -1) {
           this._queue.splice(firstGenIdx, 0, task);
        } else {
           this._queue.push(task);
        }
      }
    });
  }

  recycleBuffers(toRecycle) {
      if (!toRecycle) return;
      // The arrays are intercepted here and let go. 
      // V8 GC will collect them until proper worker ArrayBuffer recycling is implemented.
      // This prevents the TypeError from crashing the game!
      return;
  }

  watchdogCheck() {
    const NOW = Date.now();
    const TIMEOUT_LIMIT = 30000; 

    this.workers.forEach((workerObj, index) => {
      if (workerObj.isBusy && (NOW - workerObj.lastPingTime > TIMEOUT_LIMIT)) {
        console.warn(`[WorkerManager] Worker ${index} froze or crashed silently! Terminating and resetting...`);
        
        try { workerObj.instance.terminate(); } catch {}
        workerObj.isDead = true;
        window.__workerTelemetry.resets++;
        
        const resolve = this._pending.get(workerObj);
        if (resolve) resolve({ error: 'WORKER_TIMEOUT' });
        this._pending.delete(workerObj);
        window.__workerTelemetry.activeJobs = this._pending.size;
        
        this._idle = this._idle.filter(w => w !== workerObj);
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
          this._dispatchGeneratePass1(workerObj, task.cx, task.cz, task.seed, task.resolve);
        } else if (task.type === 'generatePass2') {
          this._dispatchGeneratePass2(workerObj, task.cx, task.cz, task.buffer, task.getSurfaceHeightMap, task.seed, task.resolve);
        } else if (task.type === 'rebuild') {
          this._dispatchRebuild(workerObj, task.cx, task.cz, task.packedBuffer, task.neighborBuffers, task.resolve, task.removedLights);
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

  _dispatchGeneratePass2(workerObj, cx, cz, buffer, getSurfaceHeightMap, seed, resolve) {
    workerObj.isBusy = true;
    workerObj.lastPingTime = Date.now();
    workerObj.startTime = performance.now();
    this._pending.set(workerObj, resolve);
    window.__workerTelemetry.activeJobs = this._pending.size;

    const uniqueTransfers = new Set();
    
    try {
      // Gather neighbor buffers for mesh building step!
      const store = useStore.getState();
      const neighborBuffers = [];
      for (let nx = -1; nx <= 1; nx++) {
        for (let nz = -1; nz <= 1; nz++) {
          if (nx === 0 && nz === 0) continue;
          const key = `${cx + nx},${cz + nz}`;
          let nBuffer = null;
          
          if (store.chunks[key] && store.chunks[key].buffer) {
             nBuffer = store.chunks[key].buffer;
          } else if (store.pass1Cache && store.pass1Cache.has(key)) {
             nBuffer = store.pass1Cache.get(key).buffer;
          }
          
          if (nBuffer) {
             neighborBuffers.push({ cx: cx + nx, cz: cz + nz, buffer: nBuffer });
          }
        }
      }
      
      const heightMapBuf = getSurfaceHeightMap.buffer;
      const packedBuf = buffer.buffer;
      
      uniqueTransfers.add(heightMapBuf);
      // DO NOT transfer packedBuf, otherwise it gets neutered in pass1Cache and neighbors crash!
      // DO NOT transfer neighborBuffers, they must be cloned or else the chunks are destroyed!
      workerObj.instance.postMessage({ 
        type: 'generatePass2', 
        cx, 
        cz, 
        buffer: packedBuf, 
        getSurfaceHeightMap: heightMapBuf, 
        seed, 
        neighborBuffers 
      }, Array.from(uniqueTransfers));
    } catch (e) {
      console.error('[WorkerManager] Generate postMessage failed:', e);
      this._pending.delete(workerObj);
      workerObj.isBusy = false;
      resolve({ error: 'POST_MESSAGE_FAILED' });
      this._idle.push(workerObj);
      this.processNextJob();
    }
  }

  _dispatchRebuild(workerObj, cx, cz, packedBuffer, neighborBuffers, resolve, removedLights) {
    workerObj.isBusy = true;
    workerObj.lastPingTime = Date.now();
    workerObj.startTime = performance.now();
    this._pending.set(workerObj, resolve);
    window.__workerTelemetry.activeJobs = this._pending.size;

    const uniqueTransfers = new Set();

    // Also ensure packedBuffer and neighborBuffers aren't detached!
    if (packedBuffer && packedBuffer.byteLength === 0) {
        console.error('[WorkerManager] packedBuffer is detached!');
    }

    try {
      workerObj.instance.postMessage({ type: 'rebuild', cx, cz, packedBuffer, neighborBuffers, removedLights }, Array.from(uniqueTransfers));
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
       t.avgLatency = Math.round(t.latencies.reduce((a, b) => a + b, 0) / t.latencies.length);
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
        resolve(data.meshArrays);
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
    
    try { workerObj.instance.terminate(); } catch {}
    workerObj.isDead = true;
    window.__workerTelemetry.resets++;
    
    this._idle = this._idle.filter(w => w !== workerObj);
    this.spawnWorker(workerObj.index);
    this.processNextJob();
  }

  terminateAll() {
    for (const w of this.workers) {
      if (w && w.instance) {
         try { w.instance.terminate(); } catch {}
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

// Fix: Prevent massive Web Worker memory leak on Vite HMR
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    chunkWorkerPool.terminateAll();
  });
}
