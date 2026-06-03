const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/stores/createPlayerSlice.js');
let code = fs.readFileSync(filePath, 'utf-8');

const chestStateAddition = `
  activeChestId: null,
  openChest: (x, y, z) => set(state => {
      if (state.isDead) return {};
      // Also release pointer lock
      if (document.pointerLockElement) document.exitPointerLock();
      return { activeChestId: \`\${x},\${y},\${z}\`, isInventoryOpen: false, isCraftingTableOpen: false };
  }),
  closeChest: () => set({ activeChestId: null }),
`;

const insertPoint2 = `  isInventoryOpen: false,`;
code = code.replace(insertPoint2, insertPoint2 + chestStateAddition);

fs.writeFileSync(filePath, code);
console.log('createPlayerSlice patched for openChest!');
