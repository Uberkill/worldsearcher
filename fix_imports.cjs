const fs = require('fs');

const files = [
  'src/components/Cube.jsx',
  'src/components/DroppedItems.jsx',
  'src/components/DynamicCube.jsx',
  'src/components/Enemy.jsx',
  'src/components/Ground.jsx'
];

files.forEach(f => {
  try {
    let content = fs.readFileSync(f, 'utf8');
    content = content.replace("import { playerPosition } from './Player';", "import { playerPosition } from '../globals';");
    fs.writeFileSync(f, content);
  } catch (e) { console.log(e.message); }
});

let playerContent = fs.readFileSync('src/components/Player.jsx', 'utf8');
playerContent = playerContent.replace("export const playerPosition = new Vector3();", "import { playerPosition } from '../globals';");
fs.writeFileSync('src/components/Player.jsx', playerContent);
console.log("Done");
