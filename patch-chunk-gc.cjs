const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/components/Chunk.jsx');
let code = fs.readFileSync(filePath, 'utf-8');

const effectRegex = /useEffect\(\(\) => \{\s*if \(\!chunkData \|\| \!chunkData\.meshArrays\) return;/m;
const newEffect = `useEffect(() => {
    if (!chunkData || !chunkData.meshArrays) return;`;

const oldCleanup = `  }, [chunkData?.meshArrays, chunkData?.physicsRebuildId, chunkData?.lightRebuildId, isChunkLoaded]);`;

const newCleanup = `
    // VRAM Garbage Collection (Phase 7)
    // Instantly frees GPU VRAM when the chunk unmounts or rebuilds.
    return () => {
        if (geos) {
            Object.values(geos).forEach(geoData => {
                if (geoData.geometry) {
                    geoData.geometry.dispose();
                }
            });
        }
    };
  }, [chunkData?.meshArrays, chunkData?.physicsRebuildId, chunkData?.lightRebuildId, isChunkLoaded]);`;

code = code.replace(oldCleanup, newCleanup);

fs.writeFileSync(filePath, code);
console.log('Chunk.jsx VRAM GC patched!');
