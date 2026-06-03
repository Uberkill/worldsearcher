const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/stores/createWorldSlice.js');
let code = fs.readFileSync(filePath, 'utf-8');

const unloadLogic = `
    unloadChunk: async (chunkKey, playerChunkX, playerChunkZ, maxDist) => {
        const state = get();
        const chunk = state.chunks[chunkKey];
        if (!chunk) return;
        
        // 1. Safely save to disk if modified (Yields Event Loop)
        if (chunk.isModified) {
            const { saveChunkToDB } = require('../utils/db');
            await saveChunkToDB(chunkKey, chunk);
        }
        
        // 2. RE-EVALUATION LOCK (Phase 7 Fix)
        // Check if the player moved back into range during the async save.
        const [cx, cz] = chunkKey.split(',').map(Number);
        const currentDistance = Math.max(Math.abs(cx - playerChunkX), Math.abs(cz - playerChunkZ));
        
        if (currentDistance <= maxDist) {
            console.log(\`[GC] Aborted unloading \${chunkKey} - player moved back in range!\`);
            return; // Abort deletion!
        }
        
        // 3. Aggressively purge from Zustand RAM
        set(prev => {
            const nextChunks = { ...prev.chunks };
            delete nextChunks[chunkKey];
            return { chunks: nextChunks };
        });
    },
`;

const insertPoint = `    resetWorld: async () => {`;
code = code.replace(insertPoint, unloadLogic + insertPoint);

fs.writeFileSync(filePath, code);
console.log('createWorldSlice patched with unloadChunk & async lock!');
