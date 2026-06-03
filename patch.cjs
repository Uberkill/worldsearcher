const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/stores/createWorldSlice.js');
let code = fs.readFileSync(filePath, 'utf-8');

// Insert pass1Cache at the top level
code = code.replace(
  'const useNetworkStore = () => require("./useNetworkStore").default;',
  'const useNetworkStore = () => require("./useNetworkStore").default;\nconst pass1Cache = new Map();'
);

// We will replace loadChunkAsync completely.
// First, find the start and end of loadChunkAsync.
const startIdx = code.indexOf('loadChunkAsync: async (cx, cz, skipDB = false) => {');
const endMarker = '    } finally {';
const endIdx = code.indexOf(endMarker, startIdx);
const finalEndIdx = code.indexOf('},', endIdx) + 2;

const newFunctions = `  loadChunkAsync: async (cx, cz, skipDB = false) => {
    const chunkKey = \`\${cx},\${cz}\`;
    if (get().chunks[chunkKey]) return "DECORATED";

    if (inFlightChunks.has(chunkKey)) {
      cancelledChunks.delete(chunkKey);
      return "PRISTINE";
    }

    inFlightChunks.add(chunkKey);
    cancelledChunks.delete(chunkKey);

    let chunkData = null;
    let chunkSeed = getSeed();

    try {
      if (cancelledChunks.has(chunkKey)) {
        inFlightChunks.delete(chunkKey);
        return "CANCELLED";
      }

      const useNetworkStore = getNetworkStore();
      if (useNetworkStore) {
        const networkState = useNetworkStore.getState();
        if (!networkState.isHost && networkState.connectionStatus === "connected") {
          const hostResponse = await networkState.requestChunkFromHost(chunkKey);
          if (cancelledChunks.has(chunkKey)) return "CANCELLED";
          if (hostResponse !== "PRISTINE") {
            chunkData = {
              buffer: new Uint32Array(hostResponse),
              isModified: true,
              rebuildId: 0,
            };
          }
        }
      }

      if (!chunkData && !skipDB) {
         chunkData = await loadChunkFromDB(chunkKey); 
      }
      if (cancelledChunks.has(chunkKey)) return "CANCELLED";

      if (chunkData) {
        // If we loaded from DB or Host, it is already DECORATED!
        // Reconstruct placedFlares from saved chunk data
        const foundFlares = [];
        if (chunkData.buffer) {
          const buf = chunkData.buffer;
          for (let i = 0; i < 81920; i++) {
            if (buf[i] !== 0) {
              const tex = getTextureId(buf[i]);
              if (BlockKeyById[tex] === "flare") {
                const lx = i % 16;
                const lz = Math.floor(i / 16) % 16;
                const ly = Math.floor(i / 256) + CHUNK_Y_MIN;
                const px = cx * 16 + lx;
                const pz = cz * 16 + lz;
                const key = \`\${px},\${ly + 0.5},\${pz}\`;
                foundFlares.push({ id: key, pos: [px, ly, pz], normal: [0, 1, 0] });
              }
            }
          }
        }
        if (foundFlares.length > 0) {
          set((prev) => {
            const existingIds = new Set(prev.placedFlares.map((t) => t.id));
            const newFlares = foundFlares.filter((t) => !existingIds.has(t.id));
            return { placedFlares: [...prev.placedFlares, ...newFlares] };
          });
        }

        const hasMeshes = chunkData.meshArrays && Object.keys(chunkData.meshArrays).length > 0;
        if (!hasMeshes) {
          const buffer = chunkData.buffer;
          const neighborBuffers = [];
          const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]];
          for (const [dx, dz] of dirs) {
            const nChunk = get().chunks[\`\${cx + dx},\${cz + dz}\`];
            if (nChunk && nChunk.buffer) {
              neighborBuffers.push({ cx: cx + dx, cz: cz + dz, buffer: nChunk.buffer });
            }
          }

          chunkData.meshArrays = await chunkWorkerPool.rebuild(buffer, neighborBuffers, cx, cz, getSeed());
          if (cancelledChunks.has(chunkKey)) {
            inFlightChunks.delete(chunkKey);
            return "CANCELLED";
          }
        }
        
        chunkData.rebuildId = 0;
        chunkData.physicsRebuildId = 0;

        const pending = get().pendingDeltas[chunkKey];
        if (pending) {
          for (let i = 0; i < pending.length; i += 2) {
            chunkData.buffer[pending[i]] = pending[i + 1];
          }
          chunkData.isModified = true;
          chunkData.rebuildId = (chunkData.rebuildId || 0) + 1;
          set((prev) => {
            const nextPending = { ...prev.pendingDeltas };
            delete nextPending[chunkKey];
            return { pendingDeltas: nextPending };
          });
        }

        const meshArrays = chunkData.meshArrays;
        delete chunkData.meshArrays;

        set((prev) => ({ 
          chunks: { ...prev.chunks, [chunkKey]: chunkData },
          pendingMeshMounts: [...prev.pendingMeshMounts, { chunkKey, meshArrays }]
        }));

        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]];
        dirs.forEach(([dx, dz]) => {
          const nck = \`\${cx + dx},\${cz + dz}\`;
          if (get().chunks[nck]) get().requestMeshRebuild(nck);
        });

        inFlightChunks.delete(chunkKey);
        cancelledChunks.delete(chunkKey);
        return "DECORATED";
      }

      // If NOT in DB/Network, generate Pass 1!
      const pass1Data = await chunkWorkerPool.generatePass1(cx, cz, chunkSeed);
      if (cancelledChunks.has(chunkKey)) {
         inFlightChunks.delete(chunkKey);
         return "CANCELLED";
      }
      
      pass1Cache.set(chunkKey, pass1Data.chunkData);
      
      inFlightChunks.delete(chunkKey);
      cancelledChunks.delete(chunkKey);
      return "PRISTINE";
    } catch (err) {
      inFlightChunks.delete(chunkKey);
      cancelledChunks.delete(chunkKey);
      throw err;
    }
  },

  loadChunkPass2Async: async (cx, cz) => {
    const chunkKey = \`\${cx},\${cz}\`;
    const pass1Data = pass1Cache.get(chunkKey);
    if (!pass1Data) return;

    if (inFlightChunks.has(chunkKey)) {
      cancelledChunks.delete(chunkKey);
      return;
    }
    inFlightChunks.add(chunkKey);
    cancelledChunks.delete(chunkKey);

    try {
      const chunkSeed = getSeed();
      const chunkData = await chunkWorkerPool.generatePass2(cx, cz, pass1Data.buffer, pass1Data.getSurfaceHeightMap, chunkSeed);
      pass1Cache.delete(chunkKey);
      
      if (cancelledChunks.has(chunkKey)) {
          if (chunkData && chunkData.meshArrays) chunkWorkerPool.recycleBuffers(chunkData.meshArrays);
          inFlightChunks.delete(chunkKey);
          return "CANCELLED";
      }

      // ── Handle Decorator Overflow ──
      const overflowPayload = chunkData.overflow || [];
      const overflowGroups = {};
      for (const block of overflowPayload) {
          const tcX = Math.floor(block.x / 16);
          const tcZ = Math.floor(block.z / 16);
          const targetKey = \`\${tcX},\${tcZ}\`;
          if (!overflowGroups[targetKey]) overflowGroups[targetKey] = [];
          overflowGroups[targetKey].push(block);
      }

      for (const [tKey, blocks] of Object.entries(overflowGroups)) {
          const tChunk = get().chunks[tKey];
          if (tChunk) {
              // 1. Target is already DECORATED (meshed and rendered)
              let modified = false;
              for (const b of blocks) {
                  const lx = ((b.x % 16) + 16) % 16;
                  const ly = b.y;
                  const lz = ((b.z % 16) + 16) % 16;
                  if (ly >= -64 && ly <= 255) {
                      const idx = ((ly + 64) * 256) + (lz * 16) + lx;
                      tChunk.buffer[idx] = (b.id & 0xff) | (100 << 8); // Health 100
                      modified = true;
                  }
              }
              if (modified) {
                 // Trigger Batched Dirty Meshing!
                 tChunk.isModified = true;
                 get().requestMeshRebuild(tKey); // Dispatches meshOnly worker
              }
          } else if (pass1Cache.has(tKey)) {
              // 2. Target is TERRAIN_GENERATED
              const pData = pass1Cache.get(tKey);
              for (const b of blocks) {
                  const lx = ((b.x % 16) + 16) % 16;
                  const ly = b.y;
                  const lz = ((b.z % 16) + 16) % 16;
                  if (ly >= -64 && ly <= 255) {
                      const idx = ((ly + 64) * 324) + ((lz + 1) * 18) + (lx + 1); // getHaloIndex!
                      pData.buffer[idx] = (b.id & 0xff) | (100 << 8);
                  }
              }
          } else {
              // 3. Target hasn't started generating at all
              set((prev) => {
                  const pending = { ...prev.pendingDeltas };
                  if (!pending[tKey]) pending[tKey] = [];
                  for (const b of blocks) {
                      const lx = ((b.x % 16) + 16) % 16;
                      const ly = b.y;
                      const lz = ((b.z % 16) + 16) % 16;
                      if (ly >= -64 && ly <= 255) {
                         const idx = ((ly + 64) * 256) + (lz * 16) + lx;
                         pending[tKey].push(idx, (b.id & 0xff) | (100 << 8));
                      }
                  }
                  return { pendingDeltas: pending };
              });
          }
      }

      chunkData.rebuildId = 0;
      chunkData.physicsRebuildId = 0;

      const pending = get().pendingDeltas[chunkKey];
      if (pending) {
        for (let i = 0; i < pending.length; i += 2) {
          chunkData.buffer[pending[i]] = pending[i + 1];
        }
        chunkData.isModified = true;
        chunkData.rebuildId = (chunkData.rebuildId || 0) + 1;
        set((prev) => {
          const nextPending = { ...prev.pendingDeltas };
          delete nextPending[chunkKey];
          return { pendingDeltas: nextPending };
        });
      }

      const meshArrays = chunkData.meshArrays;
      delete chunkData.meshArrays;

      set((prev) => ({ 
        chunks: { ...prev.chunks, [chunkKey]: chunkData },
        pendingMeshMounts: [...prev.pendingMeshMounts, { chunkKey, meshArrays }]
      }));

      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]];
      dirs.forEach(([dx, dz]) => {
        const nck = \`\${cx + dx},\${cz + dz}\`;
        if (get().chunks[nck]) get().requestMeshRebuild(nck);
      });

      inFlightChunks.delete(chunkKey);
      cancelledChunks.delete(chunkKey);
      return true;
    } catch (err) {
      inFlightChunks.delete(chunkKey);
      cancelledChunks.delete(chunkKey);
      throw err;
    }
  },`;

code = code.substring(0, startIdx) + newFunctions + code.substring(finalEndIdx);
fs.writeFileSync(filePath, code);
console.log('Successfully patched createWorldSlice.js');
