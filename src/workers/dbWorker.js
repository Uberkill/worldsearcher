import { get, set, del, keys } from 'idb-keyval';
import { BlockIds } from '../registry/BlockRegistry';

const CHUNK_VOLUME = 16 * 256 * 16;

const getIndex = (lx, ly, lz) => {
  return lx * 256 * 16 + ly * 16 + lz;
};

const setBlock = (buffer, index, textureId, health = 100, isHidden = 0, level = 0) => {
  const t = typeof textureId === 'string' ? BlockIds[textureId] : textureId;
  buffer[index] = (t & 0xffff) | ((health & 0xff) << 16) | ((isHidden & 0x1) << 24) | ((level & 0x7f) << 25);
};

const compressRLE = (bufferInput) => {
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

const decompressRLE = (rleArray) => {
  const rleUint32 = rleArray instanceof Uint32Array ? rleArray : new Uint32Array(rleArray.buffer || rleArray);
  const arr = new Uint32Array(CHUNK_VOLUME);
  let arrIdx = 0;
  for (let i = 0; i < rleUint32.length; i += 2) {
    const count = rleUint32[i];
    const val = rleUint32[i + 1];
    for (let c = 0; c < count; c++) {
      if (arrIdx < CHUNK_VOLUME) arr[arrIdx++] = val;
    }
  }
  return arr;
};

const migrateLegacyChunk = (legacyData) => {
  const buffer = new Uint32Array(CHUNK_VOLUME);

  if (legacyData.buffer) {
    if (legacyData.buffer.byteLength < 327680) return null;
    return legacyData;
  }

  if (legacyData.blocks) {
    for (const key in legacyData.blocks) {
      const b = legacyData.blocks[key];
      if (b.pos) {
        const lx = ((b.pos[0] % 16) + 16) % 16;
        const lz = ((b.pos[2] % 16) + 16) % 16;
        const ly = Math.round(b.pos[1] - 0.5);

        let tex = b.texture;
        if (typeof tex === 'string') {
          tex = BlockIds[tex] || 1;
        }
        setBlock(buffer, getIndex(lx, ly, lz), tex, b.health || 100, b.isHidden ? 1 : 0, b.level || 0);
      }
    }
  } else if (legacyData.packedBuffer) {
    const pb = legacyData.packedBuffer;
    for (let i = 0; i < pb.length; i += 7) {
      const lx = ((pb[i] % 16) + 16) % 16;
      const ly = pb[i + 1];
      const lz = ((pb[i + 2] % 16) + 16) % 16;
      const isHidden = pb[i + 3];
      const tex = pb[i + 4];
      const health = pb[i + 5];
      const level = pb[i + 6];
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

const flushWAL = async () => {
  if (walCache.size === 0) return;
  if (isFlushing) {
    await flushPromise;
    if (walCache.size > 0) return flushWAL();
    return;
  }
  isFlushing = true;
  flushPromise = (async () => {
    const entries = Array.from(walCache.entries());
    try {
      const BATCH_SIZE = 5;
      for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const batch = entries.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async ([key, data]) => {
          await set(key, data);
          if (walCache.get(key) === data) {
            walCache.delete(key);
          }
        }));
        await new Promise(r => setTimeout(r, 5));
      }
    } catch (err) {
      console.error('Worker failed to flush WAL', err);
    } finally {
      isFlushing = false;
    }
  })();
  await flushPromise;
};

self.onmessage = async (e) => {
  const { id, type, payload } = e.data;
  try {
    if (type === 'COMPRESS') {
      const rle = compressRLE(payload.buffer);
      self.postMessage({ id, result: rle }, [rle.buffer]);
    } else if (type === 'DECOMPRESS') {
      const uncompressed = decompressRLE(payload.rleBuffer);
      self.postMessage({ id, result: uncompressed }, [uncompressed.buffer]);
    } else if (type === 'SAVE_CHUNK') {
      const { chunkKey, slotPrefix, buffer } = payload;
      const key = `${slotPrefix}_chunk_v14_${chunkKey}`;
      const rleBuffer = compressRLE(buffer);
      walCache.set(key, { rleBuffer });

      if (!walTimer) {
        walTimer = setTimeout(() => {
          walTimer = null;
          flushWAL();
        }, 5000);
      }
      self.postMessage({ id, result: true });
    } else if (type === 'LOAD_CHUNK') {
      const { chunkKey, slotPrefix } = payload;
      const key = `${slotPrefix}_chunk_v14_${chunkKey}`;
      if (walCache.has(key)) {
        const walData = walCache.get(key);
        if (walData.rleBuffer) {
          const arr = decompressRLE(walData.rleBuffer);
          self.postMessage({ id, result: { buffer: arr, isMigrated: true } }, [arr.buffer]);
        } else {
          const arr = new Uint32Array(walData.buffer);
          self.postMessage({ id, result: { buffer: arr, isMigrated: true } }, [arr.buffer]);
        }
      } else {
        const res = await get(key);
        if (res) {
          if (res.rleBuffer) {
            const arr = decompressRLE(res.rleBuffer);
            self.postMessage({ id, result: { buffer: arr, isMigrated: true } }, [arr.buffer]);
          } else {
            const migrated = migrateLegacyChunk(res);
            if (migrated && migrated.buffer) {
               self.postMessage({ id, result: migrated }, [migrated.buffer.buffer]);
            } else {
               self.postMessage({ id, result: migrated });
            }
          }
        } else {
          self.postMessage({ id, result: null });
        }
      }
    } else if (type === 'DELETE_CHUNK') {
      const { chunkKey, slotPrefix } = payload;
      const key = `${slotPrefix}_chunk_v14_${chunkKey}`;
      if (walCache.has(key)) walCache.delete(key);
      await del(key);
      self.postMessage({ id, result: true });
    } else if (type === 'FLUSH_WAL') {
      await flushWAL();
      self.postMessage({ id, result: true });
    }
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
