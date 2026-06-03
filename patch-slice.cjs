const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/stores/createWorldSlice.js');
let code = fs.readFileSync(filePath, 'utf-8');

const oldOverflowBlock = `        // 🔹 Handle Decorator Overflow 🔹
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
                // 2. Target has finished Pass 1, but hasn't done Pass 2 yet.
                // We inject it into the raw buffer safely!
                const tBuffer = pass1Cache.get(tKey);
                for (const b of blocks) {
                    const lx = ((b.x % 16) + 16) % 16;
                    const ly = b.y;
                    const lz = ((b.z % 16) + 16) % 16;
                    if (ly >= -64 && ly <= 255) {
                        const idx = ((ly + 64) * 256) + (lz * 16) + lx;
                        tBuffer[idx] = (b.id & 0xff) | (100 << 8); // Health 100
                    }
                }
            } else {
                // 3. Target hasn't even loaded Pass 1 yet! Save it for later.
                const pd = get().pendingDeltas[tKey] || [];
                for (const b of blocks) pd.push(b);
                get().pendingDeltas[tKey] = pd;
            }
        }`;

const newOverflowBlock = `        // 🔹 Handle Decorator & Light Overflow 🔹
        const overflowGroups = {};
        
        const processPayload = (payload, isLight) => {
           for (const b of payload) {
              const tcX = Math.floor(b.x / 16);
              const tcZ = Math.floor(b.z / 16);
              const targetKey = \`\${tcX},\${tcZ}\`;
              if (!overflowGroups[targetKey]) overflowGroups[targetKey] = { blocks: [], lights: [] };
              if (isLight) overflowGroups[targetKey].lights.push(b);
              else overflowGroups[targetKey].blocks.push(b);
           }
        };

        processPayload(chunkData.decoratorOverflow || [], false);
        processPayload(chunkData.lightOverflow || [], true);

        for (const [tKey, payload] of Object.entries(overflowGroups)) {
            const applyOverflowToBuffer = (buffer) => {
               let modified = false;
               for (const b of payload.blocks) {
                    const lx = ((b.x % 16) + 16) % 16;
                    const lz = ((b.z % 16) + 16) % 16;
                    if (b.y >= -64 && b.y <= 255) {
                        const idx = ((b.y + 64) * 256) + (lz * 16) + lx;
                        buffer[idx] = (b.id & 0xff) | (100 << 8); // Health 100
                        modified = true;
                    }
               }
               for (const l of payload.lights) {
                    const lx = ((l.x % 16) + 16) % 16;
                    const lz = ((l.z % 16) + 16) % 16;
                    if (l.y >= -64 && l.y <= 255) {
                        const idx = ((l.y + 64) * 256) + (lz * 16) + lx;
                        const val = buffer[idx];
                        if (l.type === 'sun') {
                            const current = (val >> 26) & 0xF;
                            if (l.val > current) {
                                buffer[idx] = (val & ~(0xF << 26)) | ((l.val & 0xF) << 26);
                                modified = true;
                            }
                        } else {
                            const current = (val >> 22) & 0xF;
                            if (l.val > current) {
                                buffer[idx] = (val & ~(0xF << 22)) | ((l.val & 0xF) << 22);
                                modified = true;
                            }
                        }
                    }
               }
               return modified;
            };

            const tChunk = get().chunks[tKey];
            if (tChunk) {
                // 1. Target is already DECORATED (meshed and rendered)
                if (applyOverflowToBuffer(tChunk.buffer)) {
                   // Trigger Batched Dirty Meshing!
                   tChunk.isModified = true;
                   get().requestMeshRebuild(tKey); // Dispatches meshOnly worker
                }
            } else if (pass1Cache.has(tKey)) {
                // 2. Target has finished Pass 1, but hasn't done Pass 2 yet.
                // We inject it into the raw buffer safely!
                applyOverflowToBuffer(pass1Cache.get(tKey));
            } else {
                // 3. Target hasn't even loaded Pass 1 yet! Save it for later.
                const pd = get().pendingDeltas[tKey] || { blocks: [], lights: [] };
                // Migrate legacy array pending deltas if they exist
                if (Array.isArray(pd)) {
                   get().pendingDeltas[tKey] = { blocks: [...pd], lights: [] };
                }
                const newPd = get().pendingDeltas[tKey];
                for (const b of payload.blocks) newPd.blocks.push(b);
                for (const l of payload.lights) newPd.lights.push(l);
            }
        }`;

code = code.replace(oldOverflowBlock, newOverflowBlock);

// One more place: applying pendingDeltas inside loadChunkPass2Async when resolving from DECORATED
const oldDeltaBlock = `        // 🔹 Apply any pending deltas (e.g. from neighbors overflowing into us before we loaded) 🔹
        const pending = get().pendingDeltas[chunkKey];
        if (pending && pending.length > 0) {
            for (const b of pending) {
                const lx = ((b.x % 16) + 16) % 16;
                const ly = b.y;
                const lz = ((b.z % 16) + 16) % 16;
                if (ly >= -64 && ly <= 255) {
                    const idx = ((ly + 64) * 256) + (lz * 16) + lx;
                    pass1Buffer[idx] = (b.id & 0xff) | (100 << 8); // Health 100
                }
            }
            delete get().pendingDeltas[chunkKey];
        }`;

const newDeltaBlock = `        // 🔹 Apply any pending deltas (e.g. from neighbors overflowing into us before we loaded) 🔹
        const pending = get().pendingDeltas[chunkKey];
        if (pending) {
            if (Array.isArray(pending)) {
               // Legacy
               for (const b of pending) {
                   const lx = ((b.x % 16) + 16) % 16;
                   const lz = ((b.z % 16) + 16) % 16;
                   if (b.y >= -64 && b.y <= 255) {
                       const idx = ((b.y + 64) * 256) + (lz * 16) + lx;
                       pass1Buffer[idx] = (b.id & 0xff) | (100 << 8);
                   }
               }
            } else {
               for (const b of pending.blocks || []) {
                   const lx = ((b.x % 16) + 16) % 16;
                   const lz = ((b.z % 16) + 16) % 16;
                   if (b.y >= -64 && b.y <= 255) {
                       const idx = ((b.y + 64) * 256) + (lz * 16) + lx;
                       pass1Buffer[idx] = (b.id & 0xff) | (100 << 8);
                   }
               }
               for (const l of pending.lights || []) {
                   const lx = ((l.x % 16) + 16) % 16;
                   const lz = ((l.z % 16) + 16) % 16;
                   if (l.y >= -64 && l.y <= 255) {
                       const idx = ((l.y + 64) * 256) + (lz * 16) + lx;
                       const val = pass1Buffer[idx];
                       if (l.type === 'sun') {
                           pass1Buffer[idx] = (val & ~(0xF << 26)) | ((l.val & 0xF) << 26);
                       } else {
                           pass1Buffer[idx] = (val & ~(0xF << 22)) | ((l.val & 0xF) << 22);
                       }
                   }
               }
            }
            delete get().pendingDeltas[chunkKey];
        }`;

code = code.replace(oldDeltaBlock, newDeltaBlock);

fs.writeFileSync(filePath, code);
console.log('createWorldSlice.js patched!');
