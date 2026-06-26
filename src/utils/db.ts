// @ts-nocheck
/* eslint-disable no-unused-vars */
import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys } from 'idb-keyval';

const memoryFallback = new Map();
let isFallbackActive = false;

const safeGet = async (key) => {
  if (isFallbackActive) return memoryFallback.get(key);
  try { return await idbGet(key); } catch (e) {
    console.warn("IndexedDB blocked! Using memory fallback.", e);
    isFallbackActive = true;
    return memoryFallback.get(key);
  }
};

const safeSet = async (key, val) => {
  if (isFallbackActive) { memoryFallback.set(key, val); return; }
  try { await idbSet(key, val); } catch (e) {
    isFallbackActive = true;
    memoryFallback.set(key, val);
  }
};

const safeDel = async (key) => {
  if (isFallbackActive) { memoryFallback.delete(key); return; }
  try { await idbDel(key); } catch (e) {
    isFallbackActive = true;
    memoryFallback.delete(key);
  }
};

const safeKeys = async () => {
  if (isFallbackActive) return Array.from(memoryFallback.keys());
  try { return await idbKeys(); } catch (e) {
    isFallbackActive = true;
    return Array.from(memoryFallback.keys());
  }
};
import './chunkData';
import { playerPosition, playerRotation } from '../globals';

let currentSlotId = sessionStorage.getItem('saveSlotId') || 'default';

export const setDbSlotId = (slotId) => {
  currentSlotId = slotId;
  sessionStorage.setItem('saveSlotId', slotId);
};

const getSlotPrefix = () => {
  return currentSlotId;
};

// Worker setup
const worker = new Worker(new URL('../workers/dbWorker.js', import.meta.url), { type: 'module' });
let messageIdCounter = 0;
const pendingRequests = new Map();
if (typeof window !== 'undefined') {
  window.__DB_PENDING_REQUESTS__ = pendingRequests;
}

worker.onmessage = (e) => {
  const { id, result, error } = e.data;
  if (pendingRequests.has(id)) {
    const { resolve, reject } = pendingRequests.get(id);
    pendingRequests.delete(id);
    if (error) reject(new Error(error));
    else resolve(result);
  }
};

const sendWorkerRequest = (type, payload, transferList = []) => {
  return new Promise((resolve, reject) => {
    const id = messageIdCounter++;
    pendingRequests.set(id, { resolve, reject });
    worker.postMessage({ id, type, payload }, transferList);
  });
};

export const compressRLE = async (bufferInput) => {
  const sourceArray = bufferInput instanceof Uint32Array ? bufferInput : new Uint32Array(bufferInput);
  const clonedArray = new Uint32Array(sourceArray);
  return await sendWorkerRequest('COMPRESS', { buffer: clonedArray }, [clonedArray.buffer]);
};

export const decompressRLE = async (rleArray) => {
  const sourceArray = rleArray instanceof Uint32Array ? rleArray : new Uint32Array(rleArray.buffer || rleArray);
  const clonedArray = new Uint32Array(sourceArray);
  return await sendWorkerRequest('DECOMPRESS', { rleBuffer: clonedArray }, [clonedArray.buffer]);
};
export const flushWAL = async () => {
  await sendWorkerRequest('FLUSH_WAL', {});
};

let skipAutoSaveOnExit = false;
export const setSkipAutoSave = (val) => {
  skipAutoSaveOnExit = val;
};

const visibilityListener = () => {
  if (document.visibilityState === 'hidden' && !skipAutoSaveOnExit) {
    if (window.useStore) {
      const pos = [playerPosition.x, playerPosition.y, playerPosition.z];
      const rot = [
        playerRotation.x,
        playerRotation.y,
        playerRotation.z,
      ];
      window.useStore.getState().savePlayerState(pos, rot);
      // Force a synchronous extraction of modified chunks into the WAL
      window.useStore.getState().saveWorld();
    }
    flushWAL();
  }
};

if (typeof window !== 'undefined') {
  if (window.__DB_VISIBILITY_LISTENER__) {
    document.removeEventListener('visibilitychange', window.__DB_VISIBILITY_LISTENER__);
  }
  window.__DB_VISIBILITY_LISTENER__ = visibilityListener;
  document.addEventListener('visibilitychange', visibilityListener);
}

export const saveChunkToDB = async (chunkKey, chunkData, seed) => {
  const start = performance.now();
  const sourceArray = chunkData.buffer instanceof Uint32Array ? chunkData.buffer : new Uint32Array(chunkData.buffer);
  const clonedArray = new Uint32Array(sourceArray);
  const result = await sendWorkerRequest('SAVE_CHUNK', { chunkKey, slotPrefix: getSlotPrefix(), buffer: clonedArray, seed }, [clonedArray.buffer]);
  const latency = performance.now() - start;

  if (window.__DEBUG_STATS__) {
    const stats = window.__DEBUG_STATS__;
    stats.dbSaveLatency = stats.dbSaveLatency || 0;
    stats.dbSaveCount = stats.dbSaveCount || 0;
    stats.dbSaveLatency = (stats.dbSaveLatency * stats.dbSaveCount + latency) / (stats.dbSaveCount + 1);
    stats.dbSaveCount++;
  }
  return result;
};

export const loadChunkFromDB = async (chunkKey, seed) => {
  const start = performance.now();
  const result = await sendWorkerRequest('LOAD_CHUNK', { chunkKey, slotPrefix: getSlotPrefix(), seed });
  const latency = performance.now() - start;

  if (window.__DEBUG_STATS__) {
    const stats = window.__DEBUG_STATS__;
    stats.dbLoadLatency = stats.dbLoadLatency || 0;
    stats.dbLoadCount = stats.dbLoadCount || 0;
    stats.dbLoadLatency = (stats.dbLoadLatency * stats.dbLoadCount + latency) / (stats.dbLoadCount + 1);
    stats.dbLoadCount++;
  }
  return result;
};

export const cancelLoadFromDB = (_chunkKey) => {
  // Not strictly needed with async worker unless we add cancellation logic
};

const deleteChunkFromDB = async (chunkKey, seed) => {
  await sendWorkerRequest('DELETE_CHUNK', { chunkKey, slotPrefix: getSlotPrefix(), seed });
};

export const clearDB = async () => {
  const prefix = getSlotPrefix();
  await sendWorkerRequest('CLEAR_DB', { slotId: prefix, isSlotPrefix: true });
};

export const clearSlotDB = async (slotId) => {
  await sendWorkerRequest('CLEAR_DB', { slotId: slotId, isSlotPrefix: false });
};

// --- WORLD ENTITIES EXPORTER ---
export const saveWorldEntities = async (data) => {
  const prefix = getSlotPrefix();
  await safeSet(`${prefix}_world_entities`, data);
};

export const loadWorldEntities = async () => {
  const prefix = getSlotPrefix();
  return await safeGet(`${prefix}_world_entities`);
};

// --- SHIP BUFFER PERSISTENCE ---
const saveShipToDB = async (shipBuffer) => {
  const prefix = getSlotPrefix();
  // shipBuffer is a Uint32Array, we can just save it
  await safeSet(`${prefix}_ship_buffer`, shipBuffer);
};

export const loadShipFromDB = async () => {
  const prefix = getSlotPrefix();
  const buffer = await safeGet(`${prefix}_ship_buffer`);
  if (buffer) {
    if (buffer.rleBuffer) {
      return await decompressRLE(buffer.rleBuffer); // Legacy cleanup
    }
    if (Array.isArray(buffer)) {
      return new Uint32Array(buffer);
    }
    if (!(buffer instanceof Uint32Array)) {
      return new Uint32Array(buffer);
    }
  }
  return buffer;
};

// --- WORLD EXPORTER (.vx Blob) ---

export const exportSlotBlob = async (slotId) => {
  const allKeys = await safeKeys();
  const slotKeys = allKeys.filter((k) => k.startsWith(`${slotId}_`));

  const exportData = {
    version: 2, // Upgraded to v2 to include playerState and other JSON data
    metadata: localStorage.getItem(`saveMetadata_${slotId}`),
    chunks: {},
    otherData: {},
  };

  for (const k of slotKeys) {
    const data = await safeGet(k);
    if (k.endsWith('_ship_buffer')) {
      exportData.chunks[k] = Array.from(await compressRLE(data));
    } else if (data && data.rleBuffer) {
      exportData.chunks[k] = Array.from(data.rleBuffer);
    } else if (data && data.buffer) {
      exportData.chunks[k] = Array.from(await compressRLE(data.buffer));
    } else if (data) {
      // This captures player_state, achievements, etc.
      exportData.otherData[k] = data;
    }
  }

  const jsonStr = JSON.stringify(exportData);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  return blob;
};

export const exportSlot = async (slotId) => {
  const blob = await exportSlotBlob(slotId);
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `world_searcher_${slotId}.vx`;
  a.click();

  URL.revokeObjectURL(url);
};

export const importSlotBlob = async (slotId, exportData) => {
  if (!exportData.version) throw new Error('Invalid .vx data');

  await clearSlotDB(slotId);
  localStorage.setItem(`saveMetadata_${slotId}`, exportData.metadata);

  if (exportData.chunks) {
    for (const [key, rleArray] of Object.entries(exportData.chunks)) {
      const firstUnderscore = key.indexOf('_');
      const targetKey = `${slotId}${key.substring(firstUnderscore)}`;
      if (targetKey.endsWith('_ship_buffer')) {
        const decompressed = await decompressRLE(rleArray);
        await safeSet(targetKey, decompressed);
      } else {
        await safeSet(targetKey, { rleBuffer: rleArray });
      }
    }
  }

  if (exportData.version >= 2 && exportData.otherData) {
    for (const [key, data] of Object.entries(exportData.otherData)) {
      const firstUnderscore = key.indexOf('_');
      const targetKey = `${slotId}${key.substring(firstUnderscore)}`;
      await safeSet(targetKey, data);
    }
  }
};

export const importSlot = async (slotId, file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const exportData = JSON.parse(e.target.result);
        await importSlotBlob(slotId, exportData);
        resolve();
      } catch (err) {
        console.error('Import failed', err);
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
};

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (window.__DB_VISIBILITY_LISTENER__) {
      document.removeEventListener('visibilitychange', window.__DB_VISIBILITY_LISTENER__);
    }
  });
}
