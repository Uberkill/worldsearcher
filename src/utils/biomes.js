import biomesConfig from '../data/biomes.json';

// Constants
export const BIOME_SCALE = 0.004; // Roughly 250 blocks per biome to prevent patchiness

export function spatialHash(seed, x, y) {
  let h = seed | 0;
  h = Math.imul(h ^ x, 0x85ebca6b);
  h = Math.imul(h ^ y, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296.0; // Returns 0.0 to 1.0
}

// STORY REGION GRAPH: Maps coordinate grids to deterministic Story Beats
export const getRegionStoryBeat = (regionX, regionZ, worldSeed) => {
  // Region (0,0) is ALWAYS the Starting Village
  if (regionX === 0 && regionZ === 0) return 'starting_village';

  // Region (1, -1) is ALWAYS the Ancient Ruins
  if (regionX === 1 && regionZ === -1) return 'ancient_ruins';

  // For all other regions, we use a spatial hash to randomly roll if a "Wilderness Jigsaw" exists
  const roll = spatialHash(worldSeed + 99, regionX, regionZ);
  if (roll < 0.05) return 'boss_arena'; // 5% chance of a boss arena in any random region

  return null;
};

export const getBiomeAt = (
  worldX,
  worldZ,
  tempNoiseFunc,
  moistNoiseFunc,
  worldSeed = 12345
) => {
  // 1. REGION GRAPH OVERRIDES (Jigsaw Modules & Story Beats)
  // Divide world into massive regions (e.g., 2000x2000 blocks)
  const regionSize = 2000;
  const regionX = Math.floor(worldX / regionSize);
  const regionZ = Math.floor(worldZ / regionSize);

  const storyBeat = getRegionStoryBeat(regionX, regionZ, worldSeed);

  if (storyBeat) {
    // If this region has a story beat, we pick an exact coordinate for the Jigsaw center
    const hx = spatialHash(worldSeed, regionX, regionZ);
    const hz = spatialHash(worldSeed + 1, regionX, regionZ);

    const anchorX = regionX * regionSize + hx * regionSize;
    const anchorZ = regionZ * regionSize + hz * regionSize;

    // Check if we are inside the Jigsaw bounds
    const distSq =
      (worldX - anchorX) * (worldX - anchorX) +
      (worldZ - anchorZ) * (worldZ - anchorZ);

    if (storyBeat === 'starting_village' && distSq < 150 * 150)
      return 'village_biome';
    if (storyBeat === 'ancient_ruins' && distSq < 200 * 200)
      return 'ruins_biome';
    if (storyBeat === 'boss_arena' && distSq < 100 * 100) return 'boss_arena';
  }

  // 2. NATURAL NOISE BIOMES (2D Matrix)
  const rawTemp = tempNoiseFunc(worldX * BIOME_SCALE, worldZ * BIOME_SCALE);
  const rawMoist = moistNoiseFunc(worldX * BIOME_SCALE, worldZ * BIOME_SCALE);

  const temp = (rawTemp + 1) / 2; // Normalize to 0-1
  const moist = (rawMoist + 1) / 2; // Normalize to 0-1

  if (temp < 0.3) {
    if (moist < 0.5) return 'tundra';
    return 'snow_peaks';
  } else if (temp < 0.6) {
    if (moist < 0.3) return 'grassland';
    return 'forest';
  } else {
    if (moist < 0.3) return 'desert';
    if (moist < 0.6) return 'savanna';
    if (moist < 0.9) return 'jungle';
    return 'alien_desert';
  }
};

export const getBiomeConfig = (biomeId) => {
  return biomesConfig[biomeId] || biomesConfig['grassland'];
};
