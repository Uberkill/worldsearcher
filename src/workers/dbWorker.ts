import { get, del, setMany, keys } from 'idb-keyval';
import { BlockIds } from '../registry/BlockRegistry';
import type { DBWorkerRequest, DBWorkerResponse } from '../types/workers';

const CHUNK_VOLUME = 16 * 288 * 16; // 73728 elements (Y from -32 to 255)

const getIndex = (lx, ly, lz) => {
  const yOffset = ly - (-32);
  return yOffset * 256 + lz * 16 + lx;
};

const setBlock = (buffer, index, textureId, health = 100, isHidden = 0, level = 0) => {
  const t = typeof textureId === 'string' ? BlockIds[textureId] : textureId;
  const h = (health === Infinity || health >= 9999) ? 511 : Math.min(Math.max(health, 0), 510);
  buffer[index] =
    (t & 0xff) |
    ((h & 0x1ff) << 8) |
    ((level & 0xf) << 17) |
    ((isHidden ? 1 : 0) << 21);
};

const RLE_TEMP_BUFFER = new Uint32Array(CHUNK_VOLUME * 2);

const compressRLE = (bufferInput: ArrayBuffer | Uint32Array): Uint32Array => {
  const uint32Array = bufferInput instanceof Uint32Array ? bufferInput : new Uint32Array(bufferInput);
  let rleIdx = 0;
  let currentVal = uint32Array[0];
  let count = 1;
  for (let i = 1; i < uint32Array.length; i++) {
    if (uint32Array[i] === currentVal) {
      count++;
    } else {
      RLE_TEMP_BUFFER[rleIdx++] = count;
      RLE_TEMP_BUFFER[rleIdx++] = currentVal;
      currentVal = uint32Array[i];
      count = 1;
    }
  }
  RLE_TEMP_BUFFER[rleIdx++] = count;
  RLE_TEMP_BUFFER[rleIdx++] = currentVal;
  return new Uint32Array(RLE_TEMP_BUFFER.subarray(0, rleIdx));
};

const decompressRLE = (rleArray: ArrayBuffer | Uint32Array | { buffer: ArrayBuffer, byteOffset?: number, byteLength?: number }): Uint32Array => {
  let rleUint32: Uint32Array;
  if (rleArray instanceof Uint32Array) {
    rleUint32 = rleArray;
  } else if (rleArray && rleArray.buffer instanceof ArrayBuffer) {
    const buf = rleArray.buffer;
    const byteOffset = rleArray.byteOffset || 0;
    const byteLength = rleArray.byteLength || buf.byteLength;
    if (byteOffset % 4 === 0) {
      rleUint32 = new Uint32Array(buf, byteOffset, byteLength / 4);
    } else {
      const slicedBuf = buf.slice(byteOffset, byteOffset + byteLength);
      rleUint32 = new Uint32Array(slicedBuf);
    }
  } else if (rleArray instanceof ArrayBuffer) {
    rleUint32 = new Uint32Array(rleArray);
  } else {
    rleUint32 = new Uint32Array(rleArray);
  }
  const arr = new Uint32Array(CHUNK_VOLUME);
  let arrIdx = 0;
  for (let i = 0; i < rleUint32.length; i += 2) {
    const count = rleUint32[i];
    const val = rleUint32[i + 1];
    const end = Math.min(arrIdx + count, CHUNK_VOLUME);
    arr.fill(val, arrIdx, end);
    arrIdx = end;
  }
  return arr;
};

const migrateLegacyChunk = (legacyData: any): { buffer: Uint32Array, isMigrated: boolean } | null => {
  const buffer = new Uint32Array(CHUNK_VOLUME);

  if (legacyData.buffer) {
    const buf = legacyData.buffer;
    const len = buf.byteLength || buf.buffer?.byteLength;
    if (len === 294912) {
      return legacyData;
    }
    if (len === 262144) {
      const uint32Array = buf.buffer ? new Uint32Array(buf.buffer) : new Uint32Array(buf);
      const newBuf = new Uint32Array(73728);
      newBuf.set(uint32Array, 8192); // Pad Y from 0 to 255 by shifting 32 * 256 blocks
      return { buffer: newBuf, isMigrated: true };
    }
    return null;
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
      await setMany(entries);
      entries.forEach(([key, data]) => {
        if (walCache.get(key) === data) {
          walCache.delete(key);
        }
      });
    } catch (err) {
      console.error('Worker failed to flush WAL', err);
    } finally {
      isFlushing = false;
    }
  })();
  await flushPromise;
};

self.onmessage = async (e: MessageEvent<DBWorkerRequest>) => {
  const data = e.data;
  const id = data.id;
  const type = data.type;
  try {
    if (data.type === 'COMPRESS') {
      const rle = compressRLE(data.payload.buffer);
      self.postMessage({ id, result: rle }, [rle.buffer]);
    } else if (data.type === 'DECOMPRESS') {
      const uncompressed = decompressRLE(data.payload.rleBuffer);
      self.postMessage({ id, result: uncompressed }, [uncompressed.buffer]);
    } else if (data.type === 'SAVE_CHUNK') {
      const { chunkKey, slotPrefix, buffer, seed } = data.payload;
      const key = `${slotPrefix}_chunk_v14_${seed}_${chunkKey}`;
      const rleBuffer = compressRLE(buffer);
      walCache.set(key, { rleBuffer });

      if (!walTimer) {
        walTimer = setTimeout(() => {
          walTimer = null;
          flushWAL();
        }, 5000);
      }
      self.postMessage({ id, result: true });
    } else if (data.type === 'LOAD_CHUNK') {
      const { chunkKey, slotPrefix, seed } = data.payload;
      const key = `${slotPrefix}_chunk_v14_${seed}_${chunkKey}`;
      if (walCache.has(key)) {
        const walData = walCache.get(key);
        if (walData.rleBuffer) {
          const arr = decompressRLE(walData.rleBuffer);
          self.postMessage({ id, result: { buffer: arr, isMigrated: true } }, [arr.buffer]);
        } else {
          const arr = new Uint32Array(walData.buffer.slice(0));
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
              const transfer = migrated.buffer instanceof ArrayBuffer
                ? migrated.buffer
                : migrated.buffer.buffer;
              if (migrated.buffer instanceof ArrayBuffer) {
                migrated.buffer = new Uint32Array(migrated.buffer);
              }
              self.postMessage({ id, result: migrated }, [transfer]);
            } else {
              self.postMessage({ id, result: migrated });
            }
          }
        } else {
          self.postMessage({ id, result: null });
        }
      }
    } else if (data.type === 'DELETE_CHUNK') {
      const { chunkKey, slotPrefix, seed } = data.payload;
      const key = `${slotPrefix}_chunk_v14_${seed}_${chunkKey}`;
      if (walCache.has(key)) walCache.delete(key);
      await del(key);
      self.postMessage({ id, result: true });
    } else if (data.type === 'CLEAR_DB') {
      const { slotId, isSlotPrefix } = data.payload;
      walCache.clear();
      if (walTimer) {
        clearTimeout(walTimer);
        walTimer = null;
      }
      const allKeys = await keys();
      for (const k of allKeys) {
        if (isSlotPrefix) {
          if (k.startsWith(`${slotId}_`) || k === `saveState_${slotId}`) {
            await del(k);
          }
        } else {
          if (k.startsWith(`${slotId}_`) || k === `saveState_slot${slotId}`) {
            await del(k);
          }
        }
      }
      self.postMessage({ id, result: true });
    } else if (data.type === 'FLUSH_WAL') {
      await flushWAL();
      self.postMessage({ id, result: true });
    }
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
