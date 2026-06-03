const fs = require('fs');

const files = [
  'src/components/ui/InventoryOverlay.jsx',
  'src/components/ui/ChestOverlay.jsx'
];

files.forEach(f => {
  let code = fs.readFileSync(f, 'utf-8');
  code = code.replace(/\\`/g, '`').replace(/\\\$/g, '$');
  fs.writeFileSync(f, code);
});
console.log('Fixed double escaping!');
