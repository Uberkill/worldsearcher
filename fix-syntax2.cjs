const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/stores/createWorldSlice.js');
const lines = fs.readFileSync(filePath, 'utf-8').split('\n');

const newContent = \`      if (chunk.meshArrays.__flora) {
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
          newChunks[chunkKey] = {\`;

lines.splice(386, 3, newContent); // Replace lines 387, 388, 389 (0-indexed: 386, 387, 388)

fs.writeFileSync(filePath, lines.join('\n'));
console.log('Fixed syntax error via line splice!');
