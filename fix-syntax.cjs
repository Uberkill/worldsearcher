const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/stores/createWorldSlice.js');
let code = fs.readFileSync(filePath, 'utf-8');

const regex = /if \(chunk\.meshArrays\.__flora\) \{\n\s*newMeshArrays\.__flora = chunk\.meshArrays\.__flora;\n\s*newChunks\[chunkKey\] = \{/m;

const newBlock = `if (chunk.meshArrays.__flora) {
        newMeshArrays.__flora = chunk.meshArrays.__flora;
      }

      return {
        chunks: {
          ...prev.chunks,
          [chunkKey]: {
            ...chunk,
            meshArrays: newMeshArrays,
          },
        },
      };
    }),

  applyNetworkSync: (chunksData) => {
    set((prev) => {
      const newChunks = { ...prev.chunks };
      let updated = false;

      for (const chunkKey in chunksData) {
        const incoming = chunksData[chunkKey];
        const current = prev.chunks[chunkKey];

        if (!current) {
          const newBuffer = new Uint8Array(incoming.buffer);
          newChunks[chunkKey] = {`;

code = code.replace(regex, newBlock);

fs.writeFileSync(filePath, code);
console.log('Fixed syntax error in createWorldSlice.js!');
