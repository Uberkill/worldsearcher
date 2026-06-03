import { BlockKeyById } from '../registry/BlockRegistry';
import { getIndex, setBlock, getTextureId, getLevel, CHUNK_Y_MIN, CHUNK_Y_MAX } from './chunkData';

const FLUID_MAX_LEVEL = 7;
const TICK_BUDGET = 200; // max fluids to process per frame

export const wakeFluidsAround = (get, set, x, y, z) => {
  // Wake up adjacent blocks
  const dirs = [[0,1,0], [0,-1,0], [1,0,0], [-1,0,0], [0,0,1], [0,0,-1], [0,0,0]];
  set(prev => {
    const newActive = new Set(prev.activeFluids);
    for (const [dx, dy, dz] of dirs) {
      newActive.add(`${x+dx},${Math.round(y+dy)},${z+dz}`);
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
  const getChunkData = (cx, cz) => state.chunks[`${cx},${cz}`];

  // Helper to read voxel
  const getBlock = (gx, gy, gz) => {
    if (gy < CHUNK_Y_MIN || gy > CHUNK_Y_MAX) return null;
    const cx = Math.floor(gx / 16);
    const cz = Math.floor(gz / 16);
    const chunk = getChunkData(cx, cz);
    if (!chunk || !chunk.buffer) return null;
    const lx = (gx % 16 + 16) % 16;
    const lz = (gz % 16 + 16) % 16;
    const val = chunk.buffer[getIndex(lx, gy, lz)];
    return { 
      val, 
      tex: BlockKeyById[getTextureId(val)], 
      texId: getTextureId(val),
      level: getLevel(val) 
    };
  };

  // Helper to write voxel
  const writeBlock = (gx, gy, gz, texId, level) => {
    const cx = Math.floor(gx / 16);
    const cz = Math.floor(gz / 16);
    const chunk = getChunkData(cx, cz);
    if (!chunk || !chunk.buffer) return;
    const lx = (gx % 16 + 16) % 16;
    const lz = (gz % 16 + 16) % 16;
    setBlock(chunk.buffer, getIndex(lx, gy, lz), texId, 100, false, level);
    chunk.isModified = true;
    chunk.rebuildId = (chunk.rebuildId || 0) + 1;
    rebuilds.add(`${cx},${cz}`);
    
    // Trigger neighbor rebuilds if on edge
    if (lx === 0) rebuilds.add(`${cx-1},${cz}`);
    if (lx === 15) rebuilds.add(`${cx+1},${cz}`);
    if (lz === 0) rebuilds.add(`${cx},${cz-1}`);
    if (lz === 15) rebuilds.add(`${cx},${cz+1}`);
  };

  let hasChanges = false;

  for (const key of toProcess) {
    const [sx, sy, sz] = key.split(',').map(Number);
    const curr = getBlock(sx, sy, sz);
    
    if (!curr) continue;
    
    // Only process actual fluids
    if (curr.tex !== 'water' && curr.tex !== 'lava') continue;
    
    // If it's a source block (FLUID_MAX_LEVEL), it never dissipates unless destroyed by a player
    // If it's a flowing block, it MUST be supported by a stronger neighbor or falling fluid
    const isSource = curr.level === FLUID_MAX_LEVEL;
    
    let supportedLevel;
    
    if (!isSource) {
      // 1. Check above: if fluid is above us, we are fully supported (falling stream)
      const above = getBlock(sx, sy + 1, sz);
      if (above && above.tex === curr.tex) {
        supportedLevel = FLUID_MAX_LEVEL;
      } else {
        // 2. Check horizontal neighbors for support
        const neighbors = [[1,0], [-1,0], [0,1], [0,-1]];
        let maxNeighborLvl = 0;
        for (const [dx, dz] of neighbors) {
          const nb = getBlock(sx + dx, sy, sz + dz);
          if (nb && nb.tex === curr.tex && nb.level > maxNeighborLvl) {
            maxNeighborLvl = nb.level;
          }
        }
        supportedLevel = Math.max(0, maxNeighborLvl - 1);
      }
      
      // If we are NOT supported (our level is higher than our supported level), we must dissipate
      if (curr.level > supportedLevel) {
        const newLevel = curr.level - 1;
        if (newLevel <= 0) {
          writeBlock(sx, sy, sz, 0, 0); // Turn to Air
        } else {
          writeBlock(sx, sy, sz, curr.texId, newLevel); // Weaken
        }
        hasChanges = true;
        // Wake up neighbors because our support value dropped
        const dirs = [[0,1,0], [0,-1,0], [1,0,0], [-1,0,0], [0,0,1], [0,0,-1]];
        for (const [dx, dy, dz] of dirs) nextActive.add(`${sx+dx},${sy+dy},${sz+dz}`);
        continue; // Don't try to flow outward while dissipating
      }
    }

    const flowLvl = curr.level - 1;

    // Try flowing down
    const below = getBlock(sx, sy - 1, sz);
    if (below && (below.texId === 0 || (below.tex === curr.tex && below.level < FLUID_MAX_LEVEL))) {
      // Fall down at max level
      writeBlock(sx, sy - 1, sz, curr.texId, FLUID_MAX_LEVEL);
      nextActive.add(`${sx},${sy-1},${sz}`);
      hasChanges = true;
      // Wake up horizontal neighbors of the falling block so they can flow
      nextActive.add(`${sx+1},${sy-1},${sz}`);
      nextActive.add(`${sx-1},${sy-1},${sz}`);
      nextActive.add(`${sx},${sy-1},${sz+1}`);
      nextActive.add(`${sx},${sy-1},${sz-1}`);
      continue; // If we fall, we don't spread horizontally
    }

    // Spread horizontally
    if (flowLvl > 0) {
      const neighbors = [[1,0], [-1,0], [0,1], [0,-1]];
      for (const [dx, dz] of neighbors) {
        const nx = sx + dx;
        const nz = sz + dz;
        const nBlock = getBlock(nx, sy, nz);
        
        if (nBlock && nBlock.texId === 0) {
          writeBlock(nx, sy, nz, curr.texId, flowLvl);
          nextActive.add(`${nx},${sy},${nz}`);
          hasChanges = true;
        } else if (nBlock && nBlock.tex === curr.tex && nBlock.level < flowLvl) {
          writeBlock(nx, sy, nz, curr.texId, flowLvl);
          nextActive.add(`${nx},${sy},${nz}`);
          hasChanges = true;
        }
      }
    }
  }

  if (hasChanges) {
    set(() => ({ activeFluids: Array.from(nextActive) }));
    rebuilds.forEach(chunkKey => {
      state.requestMeshRebuild(chunkKey);
    });
  } else if (nextActive.size !== state.activeFluids.length) {
    set({ activeFluids: Array.from(nextActive) });
  }
};
