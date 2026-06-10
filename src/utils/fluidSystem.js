import { BlockKeyById } from '../registry/BlockRegistry';
import { useChunkStore } from '../stores/chunkSlice';
import {
  getIndex,
  setFluidLevel,
  getTextureId,
  getLevel,
  CHUNK_Y_MIN,
  CHUNK_Y_MAX,
} from './chunkData';

export const FLUID_MAX_LEVEL = 15;
const TICK_BUDGET = 200; // max fluids to process per frame

const getFluidMaxSpread = (texId) => {
  const tex = BlockKeyById[texId];
  if (tex === 'lava') return 2;
  return 4; // Water/Acid default spread
};

export const wakeFluidsAround = (get, set, x, y, z) => {
  // Wake up adjacent blocks and the block above (for floating water fix)
  const dirs = [
    [0, 1, 0], // Above
    [0, -1, 0], // Below
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
    [0, 0, 0], // Self
  ];
  set((prev) => {
    const newActive = new Set(prev.activeFluids);
    for (const [dx, dy, dz] of dirs) {
      newActive.add(`${x + dx},${Math.round(y + dy)},${z + dz}`);
    }
    return { activeFluids: Array.from(newActive) };
  });
};

export const tickFluids = (get, set) => {
  const state = get();
  if (!state.activeFluids || state.activeFluids.length === 0) return;

  const toProcess = state.activeFluids.slice(0, TICK_BUDGET);
  const remaining = state.activeFluids.slice(TICK_BUDGET);
  const nextActive = new Set(remaining);

  const rebuilds = new Set();
  const getChunkData = (cx, cz) => useChunkStore.getState().chunks[`${cx},${cz}`];

  // Helper to read voxel
  const getBlock = (gx, gy, gz) => {
    if (gy < CHUNK_Y_MIN || gy > CHUNK_Y_MAX) return { isBoundary: true };
    const cx = Math.floor(gx / 16);
    const cz = Math.floor(gz / 16);
    const chunk = getChunkData(cx, cz);
    if (!chunk || !chunk.buffer) return { isBoundary: true };
    const lx = ((gx % 16) + 16) % 16;
    const lz = ((gz % 16) + 16) % 16;
    const val = chunk.buffer[getIndex(lx, gy, lz)];
    return {
      val,
      tex: BlockKeyById[getTextureId(val)],
      texId: getTextureId(val),
      level: getLevel(val),
      isBoundary: false,
    };
  };

  // Helper to write voxel
  const writeBlock = (gx, gy, gz, texId, level) => {
    const cx = Math.floor(gx / 16);
    const cz = Math.floor(gz / 16);
    const chunk = getChunkData(cx, cz);
    if (!chunk || !chunk.buffer) return;
    const lx = ((gx % 16) + 16) % 16;
    const lz = ((gz % 16) + 16) % 16;
    const idx = getIndex(lx, gy, lz);
    
    const oldVal = chunk.buffer[idx];
    const newTex = texId & 0xff;
    const newHealth = (texId === 0 ? 0 : 100) & 0x1ff; // basic health
    const newLevel = level & 0xf;
    const isHidden = 0; // fluids are transparent, not occlusion culled
    const blockLight = (oldVal >> 22) & 0xf;
    const sunLight = (oldVal >> 26) & 0xf;
    
    chunk.buffer[idx] =
      newTex |
      (newHealth << 8) |
      (newLevel << 17) |
      (isHidden << 21) |
      (blockLight << 22) |
      (sunLight << 26);

    chunk.isModified = true;
    chunk.rebuildId = (chunk.rebuildId || 0) + 1;
    rebuilds.add(`${cx},${cz}`);

    // Trigger neighbor rebuilds if on edge
    if (lx === 0) rebuilds.add(`${cx - 1},${cz}`);
    if (lx === 15) rebuilds.add(`${cx + 1},${cz}`);
    if (lz === 0) rebuilds.add(`${cx},${cz - 1}`);
    if (lz === 15) rebuilds.add(`${cx},${cz + 1}`);
  };

  let hasChanges = false;

  for (const key of toProcess) {
    const [sx, sy, sz] = key.split(',').map(Number);
    const curr = getBlock(sx, sy, sz);

    if (!curr || curr.isBoundary) {
      nextActive.add(key); // keep in queue until chunk loads
      continue;
    }

    // Only process actual fluids
    if (curr.tex !== 'water' && curr.tex !== 'lava') continue;

    // Calculate maximum possible level based on fluid type
    const maxSpread = getFluidMaxSpread(curr.texId);
    // Source blocks always have FLUID_MAX_LEVEL
    const isSource = curr.level === FLUID_MAX_LEVEL;
    
    // Level drop step: FLUID_MAX_LEVEL / maxSpread
    const levelDrop = Math.ceil(FLUID_MAX_LEVEL / maxSpread);

    let supportedLevel;
    let isBoundarySupported = false;

    if (!isSource) {
      // 1. Check above: if fluid is above us, we are fully supported (falling stream)
      const above = getBlock(sx, sy + 1, sz);
      if (above.isBoundary) isBoundarySupported = true;
      else if (above && above.tex === curr.tex) {
        supportedLevel = FLUID_MAX_LEVEL;
      } else {
        // 2. Check horizontal neighbors for support
        const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        let maxNeighborLvl = 0;
        for (const [dx, dz] of neighbors) {
          const nb = getBlock(sx + dx, sy, sz + dz);
          if (nb.isBoundary) {
            isBoundarySupported = true;
            break; // If border unloaded, pause updates!
          }
          if (nb && nb.tex === curr.tex && nb.level > maxNeighborLvl) {
            maxNeighborLvl = nb.level;
          }
        }
        supportedLevel = Math.max(0, maxNeighborLvl - levelDrop);
      }

      if (isBoundarySupported) {
        nextActive.add(key);
        continue; // Wait for chunk
      }

      // If we are NOT supported (our level is higher than our supported level), we must dissipate
      if (curr.level > supportedLevel) {
        const newLevel = curr.level - levelDrop;
        if (newLevel <= 0) {
          writeBlock(sx, sy, sz, 0, 0); // Turn to Air
        } else {
          writeBlock(sx, sy, sz, curr.texId, newLevel); // Weaken
        }

        hasChanges = true;
        // Wake up neighbors because our support value dropped
        const dirs = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
        for (const [dx, dy, dz] of dirs)
          nextActive.add(`${sx + dx},${sy + dy},${sz + dz}`);
        continue; 
      }
    }

    const flowLvl = curr.level - levelDrop;

    // Try flowing down
    const below = getBlock(sx, sy - 1, sz);
    if (below.isBoundary) {
      nextActive.add(key);
      continue;
    }
    
    if (
      below &&
      (below.texId === 0 ||
        (below.tex === curr.tex && below.level < FLUID_MAX_LEVEL))
    ) {
      // Fall down at max level
      writeBlock(sx, sy - 1, sz, curr.texId, FLUID_MAX_LEVEL);
      nextActive.add(`${sx},${sy - 1},${sz}`);
      hasChanges = true;
      // Alien Ooze physics: straight drops! Do NOT splash horizontally.
      continue; // If we fall, we don't spread horizontally
    }

    // Spread horizontally
    if (flowLvl > 0) {
      const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dz] of neighbors) {
        const nx = sx + dx;
        const nz = sz + dz;
        const nBlock = getBlock(nx, sy, nz);

        if (nBlock.isBoundary) {
          nextActive.add(key); // Suspend
          continue;
        }

        if (nBlock && nBlock.texId === 0) {
          writeBlock(nx, sy, nz, curr.texId, flowLvl);
          nextActive.add(`${nx},${sy},${nz}`);
          hasChanges = true;
        } else if (
          nBlock &&
          nBlock.tex === curr.tex &&
          nBlock.level < flowLvl
        ) {
          writeBlock(nx, sy, nz, curr.texId, flowLvl);
          nextActive.add(`${nx},${sy},${nz}`);
          hasChanges = true;
        }
      }
    }
  }

  if (hasChanges) {
    set(() => ({ activeFluids: Array.from(nextActive) }));
    rebuilds.forEach((chunkKey) => {
      state.requestMeshRebuild(chunkKey);
    });
  } else if (nextActive.size !== state.activeFluids.length) {
    set({ activeFluids: Array.from(nextActive) });
  }
};
