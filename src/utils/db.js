import { get, set, del, keys } from 'idb-keyval';
import { BlockIds } from '../registry/BlockRegistry';
import { setBlock, getIndex, CHUNK_VOLUME } from './chunkData';
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
  const uint32Array = bufferInput instanceof Uint32Array ? bufferInput : new Uint32Array(bufferInput);
  return await sendWorkerRequest('COMPRESS', { buffer: uint32Array });
};

export const decompressRLE = async (rleArray) => {
  const rleUint32 = rleArray instanceof Uint32Array ? rleArray : new Uint32Array(rleArray.buffer || rleArray);
  return await sendWorkerRequest('DECOMPRESS', { rleBuffer: rleUint32 });
};
export const flushWAL = async () => {
  await sendWorkerRequest('FLUSH_WAL', {});
};

export let skipAutoSaveOnExit = false;
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
        playerRotation.w,
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

export const saveChunkToDB = async (chunkKey, chunkData) => {
  const uint32Array = chunkData.buffer instanceof Uint32Array ? chunkData.buffer : new Uint32Array(chunkData.buffer);
  await sendWorkerRequest('SAVE_CHUNK', { chunkKey, slotPrefix: getSlotPrefix(), buffer: uint32Array });
};

export const loadChunkFromDB = async (chunkKey) => {
  return await sendWorkerRequest('LOAD_CHUNK', { chunkKey, slotPrefix: getSlotPrefix() });
};

export const cancelLoadFromDB = (chunkKey) => {
  // Not strictly needed with async worker unless we add cancellation logic
};

export const deleteChunkFromDB = async (chunkKey) => {
  await sendWorkerRequest('DELETE_CHUNK', { chunkKey, slotPrefix: getSlotPrefix() });
};

export const clearDB = async () => {
  const allKeys = await keys();
  const prefix = getSlotPrefix();
  for (const k of allKeys) {
    if (k.startsWith(`${prefix}_`) || k === `saveState_${prefix}`) {
      await del(k);
    }
  }
};

export const clearSlotDB = async (slotId) => {
  const allKeys = await keys();
  for (const k of allKeys) {
    if (k.startsWith(`${slotId}_`) || k === `saveState_slot${slotId}`) {
      await del(k);
    }
  }
};

// --- WORLD ENTITIES EXPORTER ---
export const saveWorldEntities = async (data) => {
  const prefix = getSlotPrefix();
  await set(`${prefix}_world_entities`, data);
};

export const loadWorldEntities = async () => {
  const prefix = getSlotPrefix();
  return await get(`${prefix}_world_entities`);
};

// --- WORLD EXPORTER (.vx Blob) ---

export const exportSlotBlob = async (slotId) => {
  const allKeys = await keys();
  const slotKeys = allKeys.filter((k) => k.startsWith(`${slotId}_`));

  const exportData = {
    version: 2, // Upgraded to v2 to include playerState and other JSON data
    metadata: localStorage.getItem(`saveMetadata_${slotId}`),
    chunks: {},
    otherData: {},
  };

  for (const k of slotKeys) {
    const data = await get(k);
    if (data && data.rleBuffer) {
      exportData.chunks[k] = data.rleBuffer;
    } else if (data && data.buffer) {
      exportData.chunks[k] = await compressRLE(data.buffer);
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
      await set(targetKey, { rleBuffer: rleArray });
    }
  }

  if (exportData.version >= 2 && exportData.otherData) {
    for (const [key, data] of Object.entries(exportData.otherData)) {
      const firstUnderscore = key.indexOf('_');
      const targetKey = `${slotId}${key.substring(firstUnderscore)}`;
      await set(targetKey, data);
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
