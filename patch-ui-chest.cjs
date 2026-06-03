const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/components/ui/InGameUI.jsx');
let code = fs.readFileSync(filePath, 'utf-8');

const importRegex = /import { InventoryOverlay } from '\.\/InventoryOverlay';/;
code = code.replace(importRegex, `import { InventoryOverlay } from './InventoryOverlay';\nimport { ChestOverlay } from './ChestOverlay';`);

const renderRegex = /<InventoryOverlay active=\{isInventoryOpen\} onClose=\{\(\) => toggleInventory\(\)\} \/>/;
const newRender = `<InventoryOverlay active={isInventoryOpen} onClose={() => toggleInventory()} />
        {activeChestId && (
           <ChestOverlay chestId={activeChestId} onClose={() => useStore.getState().closeChest()} />
        )}`;

code = code.replace(renderRegex, newRender);

const stateRegex = /const isInventoryOpen = useStore\(\(state\) => state\.isInventoryOpen\);/;
code = code.replace(stateRegex, `const isInventoryOpen = useStore((state) => state.isInventoryOpen);\n  const activeChestId = useStore((state) => state.activeChestId);`);

fs.writeFileSync(filePath, code);
console.log('InGameUI patched for ChestOverlay!');
