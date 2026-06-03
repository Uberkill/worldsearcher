const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/stores/createWorldSlice.js');
let code = fs.readFileSync(filePath, 'utf-8');

// 1. In removeCube, add the removed light to chunkData.removedLights
const oldRemoveCubeBlock = `      set((prev) => {
        const prevChunkData = prev.chunks[chunkKey];
        if (!prevChunkData) return {};

        const newBuffer = new Uint32Array(prevChunkData.buffer);
        const val = newBuffer[getIndex(lx, ly, lz)];
        if (val === 0) return {};

        const texId = getTextureId(val);
        const texName = BlockKeyById[texId] || "stone";

        newBuffer[getIndex(lx, ly, lz)] = 0; // set to air

        let droppedItems = [...(prev.droppedItems || [])];`;

const newRemoveCubeBlock = `      set((prev) => {
        const prevChunkData = prev.chunks[chunkKey];
        if (!prevChunkData) return {};

        const newBuffer = new Uint32Array(prevChunkData.buffer);
        const val = newBuffer[getIndex(lx, ly, lz)];
        if (val === 0) return {};

        const texId = getTextureId(val);
        const texName = BlockKeyById[texId] || "stone";

        const lightLevel = BlockRegistry[texName]?.lightLevel || 0;
        const newRemovedLights = prevChunkData.removedLights ? [...prevChunkData.removedLights] : [];
        if (lightLevel > 0) {
           newRemovedLights.push({ x, y: ly, z, val: lightLevel, isSunlight: false });
        }

        newBuffer[getIndex(lx, ly, lz)] = 0; // set to air

        let droppedItems = [...(prev.droppedItems || [])];`;

code = code.replace(oldRemoveCubeBlock, newRemoveCubeBlock);

const oldRemoveCubeReturn = `        return { chunks: newChunks, droppedItems };
      });
      rebuilds.forEach((ck) => get().requestMeshRebuild(ck));`;

const newRemoveCubeReturn = `        // Preserve removedLights!
        newChunks[chunkKey].removedLights = newRemovedLights;
        return { chunks: newChunks, droppedItems };
      });
      rebuilds.forEach((ck) => get().requestMeshRebuild(ck));`;

// NOTE: oldRemoveCubeReturn appears twice in createWorldSlice.js (once for item drop logic branch, once for none). 
// Actually, wait, let's just use string replace that targets the object creation.
const oldRemoveCubeSet = `        newChunks[chunkKey] = {
          ...prevChunkData,
          buffer: newBuffer,
          isModified: true,
          rebuildId: (prevChunkData.rebuildId || 0) + 1,
        };`;

const newRemoveCubeSet = `        newChunks[chunkKey] = {
          ...prevChunkData,
          buffer: newBuffer,
          isModified: true,
          rebuildId: (prevChunkData.rebuildId || 0) + 1,
          removedLights: newRemovedLights,
        };`;

code = code.replace(oldRemoveCubeSet, newRemoveCubeSet);

// 2. In removeCubesBulk, do the same
const oldBulkRemove = `          const idx = getIndex(lx, ly, lz);
          const val = newBuffer[idx];
          if (val !== 0) {
            newBuffer[idx] = 0;
            chunkDeltas[chunkKey].push(idx);
            chunkDeltas[chunkKey].push(0);
            
            const texId = getTextureId(val);
            if (texId !== 0) {
               const texName = BlockKeyById[texId];
               if (texName) {
                  const bDef = BlockRegistry[texName];`;

const newBulkRemove = `          const idx = getIndex(lx, ly, lz);
          const val = newBuffer[idx];
          if (val !== 0) {
            newBuffer[idx] = 0;
            chunkDeltas[chunkKey].push(idx);
            chunkDeltas[chunkKey].push(0);
            
            const texId = getTextureId(val);
            if (texId !== 0) {
               const texName = BlockKeyById[texId];
               if (texName) {
                  const bDef = BlockRegistry[texName];
                  if (bDef.lightLevel > 0) {
                     if (!newChunks[chunkKey].removedLights) newChunks[chunkKey].removedLights = [];
                     newChunks[chunkKey].removedLights.push({ x, y: ly, z, val: bDef.lightLevel, isSunlight: false });
                  }`;

code = code.replace(oldBulkRemove, newBulkRemove);


// 3. In requestMeshRebuild, extract removedLights and pass to rebuild
const oldRebuildCall = `        // 🔹 Dispatch Rebuild to Web Worker 🔹
        const meshArrays = await chunkWorkerPool.rebuild(
          buffer,
          neighborBuffers,
          cx,
          cz,
        );`;

const newRebuildCall = `        // 🔹 Dispatch Rebuild to Web Worker 🔹
        const removedLights = chunkData.removedLights || [];
        
        // Clear them out of state so we don't process them twice if another rebuild triggers later
        set(prev => {
            if (!prev.chunks[chunkKey]) return prev;
            return {
                chunks: {
                    ...prev.chunks,
                    [chunkKey]: {
                        ...prev.chunks[chunkKey],
                        removedLights: []
                    }
                }
            };
        });

        const workerPayload = await chunkWorkerPool.rebuild(
          buffer,
          neighborBuffers,
          cx,
          cz,
          chunkData.seed || 1234,
          removedLights
        );
        
        // 🔹 Handle Light Overflow during rebuilds! 🔹
        if (workerPayload.lightOverflow && workerPayload.lightOverflow.length > 0) {
            const overflowGroups = {};
            for (const b of workerPayload.lightOverflow) {
                const tcX = Math.floor(b.x / 16);
                const tcZ = Math.floor(b.z / 16);
                const targetKey = \`\${tcX},\${tcZ}\`;
                if (!overflowGroups[targetKey]) overflowGroups[targetKey] = [];
                overflowGroups[targetKey].push(b);
            }
            
            for (const [tKey, lights] of Object.entries(overflowGroups)) {
                const tChunk = get().chunks[tKey];
                if (tChunk) {
                    let modified = false;
                    for (const l of lights) {
                        const lx = ((l.x % 16) + 16) % 16;
                        const lz = ((l.z % 16) + 16) % 16;
                        if (l.y >= -64 && l.y <= 255) {
                            const idx = ((l.y + 64) * 256) + (lz * 16) + lx;
                            const val = tChunk.buffer[idx];
                            if (l.type === 'sun') {
                                const current = (val >> 26) & 0xF;
                                if (l.val > current) {
                                    tChunk.buffer[idx] = (val & ~(0xF << 26)) | ((l.val & 0xF) << 26);
                                    modified = true;
                                }
                            } else {
                                const current = (val >> 22) & 0xF;
                                if (l.val > current) {
                                    tChunk.buffer[idx] = (val & ~(0xF << 22)) | ((l.val & 0xF) << 22);
                                    modified = true;
                                }
                            }
                        }
                    }
                    if (modified) {
                        tChunk.isModified = true;
                        get().requestMeshRebuild(tKey);
                    }
                }
            }
        }
        
        const meshArrays = workerPayload.meshArrays || workerPayload;`;

code = code.replace(oldRebuildCall, newRebuildCall);

fs.writeFileSync(filePath, code);
console.log('createWorldSlice.js patched 3!');
