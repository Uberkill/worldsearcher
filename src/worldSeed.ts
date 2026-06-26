// Deterministic world seed — same seed = same terrain across all workers.
// Using mulberry32 PRNG so simplex-noise produces identical results
// regardless of which thread or worker calls generateChunk.
//
// Change this number for a completely different world.
let WORLD_SEED: number = 123456789;

// cyrb53 hash function for string seeds
const cyrb53 = (str: string, seed = 0) => {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};

export const setWorldSeed = (seed: number | string): void => {
  if (typeof seed === 'string') {
    const parsed = Number(seed);
    WORLD_SEED = Number.isNaN(parsed) ? cyrb53(seed) : parsed;
  } else if (Number.isNaN(seed)) {
    WORLD_SEED = Math.floor(Math.random() * 1000000000);
  } else {
    WORLD_SEED = seed;
  }
};

export const getSeed = (): number => WORLD_SEED;

export const initWorldSeed = (): void => {
  const slotId = sessionStorage.getItem('saveSlotId') || 'default';
  const metaStr = localStorage.getItem(`saveMetadata_${slotId}`);

  if (!metaStr) {
    // No metadata exists, this is a fresh new world (or guest joining)
    WORLD_SEED = Math.floor(Math.random() * 1000000000);
    return;
  }

  try {
    const meta = JSON.parse(metaStr);
    if (meta.seed !== undefined) {
      setWorldSeed(meta.seed);
    } else {
      // Legacy save that existed before seed was added to metadata
      const legacySeed = localStorage.getItem('WORLD_SEED');
      if (legacySeed) {
         setWorldSeed(legacySeed);
      } else {
         WORLD_SEED = Math.floor(Math.random() * 1000000000);
      }
    }
  } catch (_e) {
    WORLD_SEED = Math.floor(Math.random() * 1000000000);
  }
};
