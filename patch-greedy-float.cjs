const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/utils/greedyMesh.js');
let code = fs.readFileSync(filePath, 'utf-8');

// We need to change Uint32Array back to Float32Array but keep the size 4 per face (1 per vertex)
code = code.replace(
  "const scratchColor = new Uint32Array(MAX_FACES * 4);",
  "const scratchColor = new Float32Array(MAX_FACES * 4);"
);

code = code.replace(
  "const color = new Uint32Array(colorBuffer, 0, faces * 4);",
  "const color = new Float32Array(colorBuffer, 0, faces * 4);"
);

fs.writeFileSync(filePath, code);
console.log('greedyMesh.js float fix!');
