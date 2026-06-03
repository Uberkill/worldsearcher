const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/data/blocks.json');
let code = fs.readFileSync(filePath, 'utf-8');

const chestBlock = `,
  "chest": {
    "id": 22,
    "name": "Storage Crate",
    "color": "#d97706",
    "health": 150,
    "isTransparent": false,
    "lightLevel": 0,
    "isFlora": false,
    "isPassable": false,
    "isLiquid": false,
    "textures": {
      "top": "chest_top.png",
      "bottom": "wood.png",
      "side": "chest_side.png"
    }
  }
}`;

code = code.replace(/}[\s\n]*$/m, chestBlock);

fs.writeFileSync(filePath, code);
console.log('blocks.json patched with chest!');
