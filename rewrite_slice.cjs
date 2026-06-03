const fs = require('fs');

const path = 'C:/Users/oob/.gemini/antigravity/scratch/Worldsearchyou/src/stores/createWorldSlice.js';
let content = fs.readFileSync(path, 'utf8');

// We need to import getIndex, setBlock, getTextureId, getLevel, getIsHidden from chunkData
content = content.replace(
  `import { BlockRegistry } from '../registry/BlockRegistry';`,
  `import { BlockRegistry, BlockById } from '../registry/BlockRegistry';\nimport { setBlock, getIndex, getTextureId, getIsHidden, getLevel, CHUNK_Y_MIN, CHUNK_Y_MAX } from '../utils/chunkData';`
);

// addCube replacement
content = content.replace(/addCube: \(x, y, z\) => \{[\s\S]*?wakeFluidsAround\(get, set, x, y, z\);\n  \},/g, `
  addCube: (x, y, z) => {
    const chunkKey = getChunkKey(x, z);
    const rebuilds = new Set([chunkKey]);

    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    
    // Y bounds check
    const ly = Math.round(y - 0.5);
    if (ly < CHUNK_Y_MIN || ly > CHUNK_Y_MAX) return;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        rebuilds.add(\`\${cx + dx},\${cz + dz}\`);
      }
    }

    set((prev) => {
      const prevChunkData = prev.chunks[chunkKey] || { buffer: new Uint32Array(81920), isModified: false };
      
      const newBuffer = new Uint32Array(prevChunkData.buffer);
      const lx = (x % 16 + 16) % 16;
      const lz = (z % 16 + 16) % 16;

      const currentVal = newBuffer[getIndex(lx, ly, lz)];
      const currentTexId = getTextureId(currentVal);
      if (currentTexId !== 0 && BlockById[currentTexId]?.isPassable === false) {
          // Already blocked
      }

      // We resolve tex to ID
      const texName = prev.texture;
      let texId = 1;
      const keys = Object.keys(BlockRegistry);
      for(let i=0; i<keys.length; i++) {
         if(BlockRegistry[keys[i]].name === texName) { texId = parseInt(keys[i], 10); break; }
      }
      
      if (currentTexId !== 0 && BlockById[currentTexId]?.name === 'flare') {
         setTimeout(() => get().removeFlare(getBlockKey(x, y, z)), 0);
      }

      const health = BlockRegistry[texName]?.health ?? 100;
      setBlock(newBuffer, lx, ly, lz, texId, 0, 0, health);

      const rebuildId = (prevChunkData.rebuildId || 0) + 1;
      return { 
        chunks: { 
          ...prev.chunks, 
          [chunkKey]: { ...prevChunkData, buffer: newBuffer, isModified: true, rebuildId } 
        } 
      };
    });
    get().consumeActiveItem();
    rebuilds.forEach(ck => get().requestMeshRebuild(ck));
    wakeFluidsAround(get, set, x, y, z);
  },
`);

// removeCube replacement
content = content.replace(/removeCube: \(x, y, z\) => \{[\s\S]*?wakeFluidsAround\(get, set, x, y, z\);\n  \},/g, `
  removeCube: (x, y, z) => {
    const chunkKey = getChunkKey(x, z);
    const rebuilds = new Set([chunkKey]);

    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const ly = Math.round(y - 0.5);
    if (ly < CHUNK_Y_MIN || ly > CHUNK_Y_MAX) return;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        rebuilds.add(\`\${cx + dx},\${cz + dz}\`);
      }
    }
    
    set((prev) => {
      const prevChunkData = prev.chunks[chunkKey];
      if (!prevChunkData) return {};
      
      const newBuffer = new Uint32Array(prevChunkData.buffer);
      const lx = (x % 16 + 16) % 16;
      const lz = (z % 16 + 16) % 16;
      
      const val = newBuffer[getIndex(lx, ly, lz)];
      if (val === 0) return {};
      
      const texId = getTextureId(val);
      const texName = BlockById[texId]?.name || 'stone';

      if (texName === 'flare') {
        setTimeout(() => get().removeFlare(getBlockKey(x, y, z)), 0);
      }
      
      const newChunks = { ...prev.chunks };
      const droppedItems = [...(prev.droppedItems || []), { key: uuidV4(), pos: [x,y,z], texture: texName }];
      
      // FIX: Floating Grass (Block Update Cascades)
      if (ly + 1 <= CHUNK_Y_MAX) {
        const aboveVal = newBuffer[getIndex(lx, ly + 1, lz)];
        if (aboveVal !== 0) {
           const aboveTexId = getTextureId(aboveVal);
           const aboveTexName = BlockById[aboveTexId]?.name;
           if (BlockById[aboveTexId]?.isFlora || aboveTexName === 'flare') {
              setBlock(newBuffer, lx, ly + 1, lz, 0, 0, 0, 0);
              droppedItems.push({ key: uuidV4(), pos: [x,y+1,z], texture: aboveTexName });
              if (aboveTexName === 'flare') {
                 setTimeout(() => get().removeFlare(getBlockKey(x, y + 1, z)), 0);
              }
           }
        }
      }
      
      setBlock(newBuffer, lx, ly, lz, 0, 0, 0, 0);
      
      newChunks[chunkKey] = { 
        ...prevChunkData, 
        buffer: newBuffer, 
        isModified: true, 
        rebuildId: (prevChunkData.rebuildId || 0) + 1 
      };
      
      // We no longer need to manually unhide neighbors because greedyMesh checks everything natively!
      
      return { chunks: newChunks, droppedItems };
    });
    rebuilds.forEach(ck => get().requestMeshRebuild(ck));
    wakeFluidsAround(get, set, x, y, z);
  },
`);

// damageBlock replacement
content = content.replace(/damageBlock: \(x, y, z, amount\) => \{[\s\S]*?\},/g, `
  damageBlock: (x, y, z, amount) => {
    const chunkKey = getChunkKey(x, z);
    const ly = Math.round(y - 0.5);
    if (ly < CHUNK_Y_MIN || ly > CHUNK_Y_MAX) return;

    const state = get();
    const chunkData = state.chunks[chunkKey];
    if (!chunkData) return;
    
    const lx = (x % 16 + 16) % 16;
    const lz = (z % 16 + 16) % 16;
    
    const val = chunkData.buffer[getIndex(lx, ly, lz)];
    if (val === 0) return;

    const health = (val >> 8) & 0x1FF;
    if (health === 511) return; // Infinity
    
    if (health - amount <= 0) {
      setTimeout(() => get().removeCube(x, y, z), 0);
    } else {
      set(prev => {
        const newChunks = { ...prev.chunks };
        const newBuffer = new Uint32Array(chunkData.buffer);
        
        // rewrite health
        const newHealth = health - amount;
        newBuffer[getIndex(lx, ly, lz)] = (val & ~(0x1FF << 8)) | ((newHealth & 0x1FF) << 8);

        newChunks[chunkKey] = { 
          ...chunkData,
          buffer: newBuffer,
          isModified: true 
        };
        return { chunks: newChunks };
      });
    }
  },
`);

// triggerExplosion replacement
content = content.replace(/triggerExplosion: \(ex, ey, ez\) => \{[\s\S]*?\},/g, `
  triggerExplosion: (ex, ey, ez) => {
    const rebuilds = new Set();
    
    set((prev) => {
      const radius = 4;
      const newChunks = { ...prev.chunks };
      
      const chunkMinX = Math.floor((ex - radius - 2) / 16);
      const chunkMaxX = Math.floor((ex + radius + 2) / 16);
      const chunkMinZ = Math.floor((ez - radius - 2) / 16);
      const chunkMaxZ = Math.floor((ez + radius + 2) / 16);
      
      for (let cx = chunkMinX; cx <= chunkMaxX; cx++) {
        for (let cz = chunkMinZ; cz <= chunkMaxZ; cz++) {
          const ck = \`\${cx},\${cz}\`;
          if (!newChunks[ck]) continue;
          
          let modified = false;
          const newBuffer = new Uint32Array(newChunks[ck].buffer);
          
          for (let i = 0; i < 81920; i++) {
            const val = newBuffer[i];
            if (val === 0) continue;
            
            const lx = i % 16;
            const lz = Math.floor(i / 16) % 16;
            const ly = Math.floor(i / 256) + CHUNK_Y_MIN;
            
            const gx = cx * 16 + lx;
            const gy = ly + 0.5;
            const gz = cz * 16 + lz;
            
            const texId = getTextureId(val);
            if (BlockById[texId]?.name === 'bedrock') continue;
            
            const dist = Math.sqrt(Math.pow(gx-ex, 2) + Math.pow(gy-ey, 2) + Math.pow(gz-ez, 2));
            
            if (dist <= radius) {
              newBuffer[i] = 0;
              modified = true;
            }
          }
          if (modified) {
            newChunks[ck] = { 
              ...newChunks[ck], 
              buffer: newBuffer, 
              isModified: true, 
              rebuildId: (newChunks[ck].rebuildId || 0) + 1 
            };
            rebuilds.add(ck);
          }
        }
      }
      
      if (get().requestAreaDamage) {
         setTimeout(() => get().requestAreaDamage([ex, ey, ez], radius + 3, 1000), 0);
      }
      
      return { chunks: newChunks };
    });
    
    rebuilds.forEach(ck => get().requestMeshRebuild(ck));

    const blastRadius = 4;
    for (let dx = -blastRadius - 1; dx <= blastRadius + 1; dx++) {
      for (let dy = -blastRadius - 1; dy <= blastRadius + 1; dy++) {
        for (let dz = -blastRadius - 1; dz <= blastRadius + 1; dz++) {
          if (Math.sqrt(dx*dx + dy*dy + dz*dz) <= blastRadius + 1) {
            wakeFluidsAround(get, set, Math.floor(ex + dx), Math.floor(ey + dy) + 0.5, Math.floor(ez + dz));
          }
        }
      }
    }
  },
`);

fs.writeFileSync(path, content, 'utf8');
