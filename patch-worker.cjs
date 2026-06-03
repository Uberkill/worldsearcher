const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/workers/chunkWorker.js');
let code = fs.readFileSync(filePath, 'utf-8');

// Replace import
code = code.replace(
  "import { generateLightMap } from '../utils/lighting.js';",
  "import { generateSunlight, generateBlockLight, removeLight } from '../utils/lighting.js';"
);

// Replace generation logic in loadChunkPass2Async worker payload
code = code.replace(
  "const lightMap = generateLightMap(newBuffer, cx, cz, neighborBuffers);",
  `const sunOverflow = generateSunlight(newBuffer, cx, cz, neighborBuffers);
        const blockOverflow = generateBlockLight(newBuffer, cx, cz, neighborBuffers);
        const lightOverflow = [...sunOverflow, ...blockOverflow];`
);

code = code.replace(
  "const meshArrays = buildGreedyArrays(newBuffer, lightMap, cx, cz, neighborBuffers, pooledBuffers);",
  "const meshArrays = buildGreedyArrays(newBuffer, cx, cz, neighborBuffers, pooledBuffers);"
);

// Replace rebuild generation logic
code = code.replace(
  "const lightMap = generateLightMap(buffer, cx, cz, neighborBuffers);",
  `generateSunlight(buffer, cx, cz, neighborBuffers);
        generateBlockLight(buffer, cx, cz, neighborBuffers);`
);

code = code.replace(
  "const meshArrays = buildGreedyArrays(buffer, lightMap, cx, cz, neighborBuffers, data.pooledBuffers);",
  "const meshArrays = buildGreedyArrays(buffer, cx, cz, neighborBuffers, data.pooledBuffers);"
);

// Include lightOverflow in Pass 2 response
code = code.replace(
  "self.postMessage({ type: 'pass2Complete', cx, cz, meshArrays, decoratorOverflow, unusedBuffers }, transferables);",
  "self.postMessage({ type: 'pass2Complete', cx, cz, meshArrays, decoratorOverflow, lightOverflow, unusedBuffers }, transferables);"
);

fs.writeFileSync(filePath, code);
console.log('chunkWorker.js patched!');
