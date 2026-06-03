const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/components/BlockInteraction.jsx');
let code = fs.readFileSync(filePath, 'utf-8');

const oldLogic = `      // Handle Waypoint placement on Middle Mouse Click
      if (e.button === 1) {
         const { broadcastWaypoint } = useNetworkStore.getState();
         broadcastWaypoint(bx + nx * 0.5, by + ny * 0.5, bz + nz * 0.5);
         return;
      }

      // Only process left-click for building/breaking
      if (e.button !== 0) return; 
      
      const state = useStore.getState();
      const activeTexture = state.texture;`;

const newLogic = `      // Handle Waypoint placement on Middle Mouse Click
      if (e.button === 1) {
         const { broadcastWaypoint } = useNetworkStore.getState();
         broadcastWaypoint(bx + nx * 0.5, by + ny * 0.5, bz + nz * 0.5);
         return;
      }
      
      const state = useStore.getState();
      const activeTexture = state.texture;

      // Handle Right Click on Containers/Tables
      if (e.button === 2) {
          if (block.texture === 'chest') {
             state.openChest(bx, by, bz);
          } else if (block.texture === 'crafting_table') {
             if (document.pointerLockElement) document.exitPointerLock();
             useStore.setState({ isCraftingTableOpen: true, isInventoryOpen: false, activeChestId: null });
          }
          return;
      }

      // Only process left-click for building/breaking
      if (e.button !== 0) return;`;

code = code.replace(oldLogic, newLogic);

fs.writeFileSync(filePath, code);
console.log('BlockInteraction patched for chest interaction!');
