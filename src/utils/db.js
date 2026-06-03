import { get, set, del, keys } from 'idb-keyval';
import { BlockIds } from '../registry/BlockRegistry';
import { setBlock, getIndex } from './chunkData';

const getSlotPrefix = () => {
  return sessionStorage.getItem('saveSlotId') || 'default';
};

export const compressRLE = (bufferInput) => {
  const uint32Array = bufferInput instanceof Uint32Array ? bufferInput : new Uint32Array(bufferInput);
  const rle = [];
  let currentVal = uint32Array[0];
  let count = 1;
  for (let i = 1; i < uint32Array.length; i++) {
    if (uint32Array[i] === currentVal) {
      count++;
    } else {
      rle.push(count, currentVal);
      currentVal = uint32Array[i];
      count = 1;
    }
  }
  rle.push(count, currentVal);
  return new Uint32Array(rle);
};

export const decompressRLE = (rleArray) => {
  const rleUint32 = rleArray instanceof Uint32Array ? rleArray : new Uint32Array(rleArray.buffer || rleArray);
  const arr = new Uint32Array(81920);
  let idx = 0;
  for (let i = 0; i < rleUint32.length; i += 2) {
    const count = rleUint32[i];
    const val = rleUint32[i+1];
    arr.fill(val, idx, idx + count);
    idx += count;
  }
  return arr;
};

const migrateLegacyChunk = (legacyData) => {
  const buffer = new Uint32Array(81920);
  
  if (legacyData.buffer) {
    // Failsafe: if the buffer was saved while detached (0 length), regenerate it
    if (legacyData.buffer.byteLength < 327680) return null;
    return legacyData; // Already ECS format
  }

  // Legacy Object format
  if (legacyData.blocks) {
    for (const key in legacyData.blocks) {
      const b = legacyData.blocks[key];
      if (b.pos) {
        const lx = (b.pos[0] % 16 + 16) % 16;
        const lz = (b.pos[2] % 16 + 16) % 16;
        const ly = Math.round(b.pos[1] - 0.5); // block-center Y back to integer
        
        let tex = b.texture;
        if (typeof tex === 'string') {
          tex = BlockIds[tex] || 1; // fallback to 1 (dirt) if not found
        }
        setBlock(buffer, getIndex(lx, ly, lz), tex, b.health||100, b.isHidden?1:0, b.level||0);
      }
    }
  } 
  // Legacy Packed format
  else if (legacyData.packedBuffer) {
     const pb = legacyData.packedBuffer;
     for (let i = 0; i < pb.length; i+=7) {
        const lx = (pb[i] % 16 + 16) % 16;
        const ly = pb[i+1];
        const lz = (pb[i+2] % 16 + 16) % 16;
        const isHidden = pb[i+3];
        const tex = pb[i+4];
        const health = pb[i+5];
        const level = pb[i+6];
        setBlock(buffer, getIndex(lx, ly, lz), tex, health, isHidden, level);
     }
  } else {
    return null;
  }
  
  return { buffer, isMigrated: true };
};

const walCache = new Map();
let walTimer = null;

let isFlushing = false;
let flushPromise = null;

export const flushWAL = async () => {
  if (walCache.size === 0) return;
  
  if (isFlushing) {
    // Wait for the current flush to finish, then flush again for any new items
    await flushPromise;
    if (walCache.size > 0) return flushWAL();
    return;
  }
  
  isFlushing = true;
  
  flushPromise = (async () => {
    const entries = Array.from(walCache.entries());
    try {
      // Process writes sequentially to prevent IDB transaction limits and QuotaExceededErrors
      for (const [key, data] of entries) {
         await set(key, data);
         // Only delete from cache if the save succeeded AND the chunk wasn't modified again during the await
         if (walCache.get(key) === data) {
            walCache.delete(key);
         }
      }
    } catch (err) {
      console.error('Failed to flush WAL to IndexedDB', err);
      if (err.name === 'QuotaExceededError' || err.message?.includes('Quota')) {
         // Dispatch a custom event so the UI can display a high-priority warning
         window.dispatchEvent(new CustomEvent('storage_quota_exceeded'));
      }
    } finally {
      isFlushing = false;
    }
  })();
  
  await flushPromise;
};

export let skipAutoSaveOnExit = false;
export const setSkipAutoSave = (val) => { skipAutoSaveOnExit = val; };

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && !skipAutoSaveOnExit) {
    if (window.useStore) {
       // Force a synchronous extraction of modified chunks into the WAL
       window.useStore.getState().saveWorld();
    }
    flushWAL();
  }
});

export const saveChunkToDB = async (chunkKey, chunkData) => {
  const key = `${getSlotPrefix()}_chunk_${chunkKey}`;
  // Compress immediately to prevent QuotaExceededError and array mutations
  const rleBuffer = compressRLE(chunkData.buffer);
  walCache.set(key, { rleBuffer });
  
  if (!walTimer) {
    walTimer = setTimeout(() => {
      walTimer = null;
      flushWAL();
    }, 5000); // 5 second debounce
  }
};

const MAX_IDB_CONCURRENCY = 10;
let idbActiveCount = 0;
const idbQueue = [];

const processIdbQueue = async () => {
  if (idbActiveCount >= MAX_IDB_CONCURRENCY || idbQueue.length === 0) return;
  idbActiveCount++;
  const task = idbQueue.shift();
  try {
    const key = `${getSlotPrefix()}_chunk_${task.chunkKey}`;
    
    // Check WAL first to prevent reading stale DB data before a flush
    if (walCache.has(key)) {
       const walData = walCache.get(key);
       if (walData.rleBuffer) {
           task.resolve({ buffer: decompressRLE(walData.rleBuffer).buffer, isMigrated: true });
       } else {
           task.resolve({ buffer: walData.buffer.slice(0), isMigrated: true });
       }
    } else {
       const res = await get(key);
       if (res) {
         if (res.rleBuffer) {
            task.resolve({ buffer: decompressRLE(res.rleBuffer).buffer, isMigrated: true });
         } else {
            task.resolve(migrateLegacyChunk(res));
         }
       } else {
         task.resolve(null);
       }
    }
  } catch (err) {
    console.error('Failed to load chunk from IndexedDB', err);
    task.resolve(null);
  } finally {
    idbActiveCount--;
    processIdbQueue();
  }
};

export const loadChunkFromDB = (chunkKey) => {
  return new Promise((resolve) => {
    idbQueue.push({ chunkKey, resolve });
    processIdbQueue();
  });
};

export const cancelLoadFromDB = (chunkKey) => {
  const idx = idbQueue.findIndex(t => t.chunkKey === chunkKey);
  if (idx !== -1) {
    idbQueue.splice(idx, 1);
  }
};

export const deleteChunkFromDB = async (chunkKey) => {
  const key = `${getSlotPrefix()}_chunk_${chunkKey}`;
  if (walCache.has(key)) walCache.delete(key);
  await del(key);
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

// --- WORLD EXPORTER (.vx Blob) ---

export const exportSlot = async (slotId) => {
  const allKeys = await keys();
  const slotKeys = allKeys.filter(k => k.startsWith(`${slotId}_`));
  
  const exportData = {
     version: 2, // Upgraded to v2 to include playerState and other JSON data
     metadata: localStorage.getItem(`saveMetadata_${slotId}`),
     chunks: {},
     otherData: {}
  };
  
  for (const k of slotKeys) {
     const data = await get(k);
     if (data && data.rleBuffer) {
        exportData.chunks[k] = data.rleBuffer;
     } else if (data && data.buffer) {
        exportData.chunks[k] = compressRLE(data.buffer);
     } else if (data) {
        // This captures player_state, achievements, etc.
        exportData.otherData[k] = data;
     }
  }
  
  const jsonStr = JSON.stringify(exportData);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `world_searcher_${slotId}.vx`;
  a.click();
  
  URL.revokeObjectURL(url);
};

export const importSlot = async (slotId, file) => {
  return new Promise((resolve, reject) => {
     const reader = new FileReader();
     reader.onload = async (e) => {
        try {
           const exportData = JSON.parse(e.target.result);
           if (!exportData.version) throw new Error("Invalid .vx file");
           
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

