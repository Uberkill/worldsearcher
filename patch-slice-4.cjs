const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/stores/createWorldSlice.js');
let code = fs.readFileSync(filePath, 'utf-8');

const stateInitRegex = /export const createWorldSlice = \(set, get\) => \(\{[\s\S]*?pendingMeshMounts: \[\],/m;
const newStateInit = `export const createWorldSlice = (set, get) => ({
    batcherVersion: 0,
    incrementBatcherVersion: () => set(state => ({ batcherVersion: state.batcherVersion + 1 })),
    chunks: {},
    chests: {}, // Spatial Container Schema (Phase 6): { "x,y,z": [ ...slots... ] }
    pendingDeltas: {},
    isResetting: false,
    tickFluids: () => tickFluids(get, set),
    pendingMeshMounts: [],`;

code = code.replace(stateInitRegex, newStateInit);

const oldAddCubeBlock = `      const texId = getTextureId(val);
      const texName = BlockKeyById[texId];
      if (texName === "flare") {
        get().placeFlare([x, y, z], [0, 1, 0], \`flare_\${Date.now()}\`);
      }`;

const newAddCubeBlock = `      const texId = getTextureId(val);
      const texName = BlockKeyById[texId];
      if (texName === "flare") {
        get().placeFlare([x, y, z], [0, 1, 0], \`flare_\${Date.now()}\`);
      }
      
      // Phase 6: Spatial Container Initialization
      if (texName === "chest") {
         const chestKey = \`\${x},\${ly},\${z}\`;
         set(prev => ({
             chests: {
                 ...prev.chests,
                 [chestKey]: new Array(27).fill(null)
             }
         }));
      }`;

code = code.replace(oldAddCubeBlock, newAddCubeBlock);

const oldRemoveCubeBlock = `        const lightLevel = BlockRegistry[texName]?.lightLevel || 0;
        const newRemovedLights = prevChunkData.removedLights ? [...prevChunkData.removedLights] : [];
        if (lightLevel > 0) {
           newRemovedLights.push({ x, y: ly, z, val: lightLevel, isSunlight: false });
        }`;

const newRemoveCubeBlock = `        const lightLevel = BlockRegistry[texName]?.lightLevel || 0;
        const newRemovedLights = prevChunkData.removedLights ? [...prevChunkData.removedLights] : [];
        if (lightLevel > 0) {
           newRemovedLights.push({ x, y: ly, z, val: lightLevel, isSunlight: false });
        }
        
        // Phase 6: Spatial Container Destruction
        if (texName === "chest") {
           const chestKey = \`\${x},\${ly},\${z}\`;
           const chestInv = prev.chests[chestKey];
           if (chestInv) {
               // Drop all items in the chest
               chestInv.forEach(item => {
                   if (item) {
                       for (let i = 0; i < item.count; i++) {
                           const spreadX = x + (Math.random() - 0.5);
                           const spreadZ = z + (Math.random() - 0.5);
                           droppedItems.push({
                               id: \`drop_\${Date.now()}_\${Math.random()}\`,
                               texture: item.texture,
                               pos: [spreadX, ly + 0.5, spreadZ]
                           });
                       }
                   }
               });
               // Delete chest state
               const newChests = { ...prev.chests };
               delete newChests[chestKey];
               // We don't return here directly because we need to update the chunk buffer below.
               // So we just attach the newChests to the return state at the end.
               setTimeout(() => set({ chests: newChests }), 0); // Dispatch after current state update resolves
           }
        }`;

code = code.replace(oldRemoveCubeBlock, newRemoveCubeBlock);

// For resetting the world, we need to clear chests
const oldResetBlock = `    resetWorld: async () => {
      if (get().isResetting) return;
      set({ isResetting: true, pendingMeshMounts: [] });`;

const newResetBlock = `    resetWorld: async () => {
      if (get().isResetting) return;
      set({ isResetting: true, pendingMeshMounts: [], chests: {} });`;

code = code.replace(oldResetBlock, newResetBlock);

fs.writeFileSync(filePath, code);
console.log('createWorldSlice.js patched for Phase 6 Containers!');
