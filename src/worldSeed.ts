// Deterministic world seed — same seed = same terrain across all workers.
// Using mulberry32 PRNG so simplex-noise produces identical results
// regardless of which thread or worker calls generateChunk.
//
// Change this number for a completely different world.
let WORLD_SEED: number = 123456789;

export const setWorldSeed = (seed: number | string): void => {
  if (typeof seed === 'string') {
    WORLD_SEED = parseInt(seed, 10);
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
    if (meta.seed) {
      WORLD_SEED = meta.seed;
    } else {
      // Legacy save that existed before seed was added to metadata
      const legacySeed = localStorage.getItem('WORLD_SEED');
      WORLD_SEED = legacySeed
        ? parseInt(legacySeed, 10)
        : Math.floor(Math.random() * 1000000000);
    }
  } catch (_e) {
    WORLD_SEED = Math.floor(Math.random() * 1000000000);
  }
};
