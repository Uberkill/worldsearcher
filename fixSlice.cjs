const fs = require('fs');
const file = 'src/stores/createWorldSlice.js';
let content = fs.readFileSync(file, 'utf8');

// Find clearVisualMeshArrays
const startIndex = content.indexOf('clearVisualMeshArrays: (chunkKey) =>');
if (startIndex === -1) throw new Error("Could not find clearVisualMeshArrays");

// We need to replace everything from `if (chunk.meshArrays.__flora)` down to `placedFlares: [],`
const floraRegex = /if\s*\(\s*chunk\.meshArrays\.__flora\s*\)\s*\{\s*newMeshArrays\.__flora\s*=\s*chunk\.meshArrays\.__flora;\s*\}/;
const floraMatch = content.match(floraRegex);
if (!floraMatch) throw new Error("Could not find flora check via regex");

const floraIndex = floraMatch.index;

const placedFlaresIndex = content.indexOf('placedFlares: [],');
if (placedFlaresIndex === -1) throw new Error("Could not find placedFlares");

const replacement = `      if (chunk.meshArrays.__flora) {
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

  activeFluids: [], // Stores string keys like "x,y,z" of fluids that need ticking
  worldTime: 12,
  daysElapsed: 1,
  isNightTime: false,
  isRaining: false,
  fallingStructures: [],
  debris: [],

  setWorldTime: (time, day) => set((state) => {
    let newRaining = state.isRaining;
    if (Math.floor(time) !== Math.floor(state.worldTime)) {
      if (Math.random() < 0.10) {
        newRaining = !newRaining;
      }
    }
    return { worldTime: time, daysElapsed: day, isRaining: newRaining };
  }),

  `;

const newContent = content.substring(0, floraIndex) + replacement + content.substring(placedFlaresIndex);
fs.writeFileSync(file, newContent, 'utf8');
console.log("Successfully fixed createWorldSlice.js with regex!");
