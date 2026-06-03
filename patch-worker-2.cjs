const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/workers/chunkWorker.js');
let code = fs.readFileSync(filePath, 'utf-8');

const oldRebuildBlock = `        let cx = data.cx;
        let cz = data.cz;
        
        // Generate light map seeded from BOTH internal blocks and neighbor buffers
        generateSunlight(buffer, cx, cz, neighborBuffers);
        generateBlockLight(buffer, cx, cz, neighborBuffers);
        const meshArrays = buildGreedyArrays(buffer, cx, cz, neighborBuffers, data.pooledBuffers);`;

const newRebuildBlock = `        let cx = data.cx;
        let cz = data.cz;
        
        const lightOverflow = [];
        
        if (data.removedLights && data.removedLights.length > 0) {
           for (const rl of data.removedLights) {
              const overflow = removeLight(buffer, cx, cz, neighborBuffers, rl.x, rl.y, rl.z, rl.val, rl.isSunlight);
              lightOverflow.push(...overflow);
           }
        }
        
        // Generate light map seeded from BOTH internal blocks and neighbor buffers
        lightOverflow.push(...generateSunlight(buffer, cx, cz, neighborBuffers));
        lightOverflow.push(...generateBlockLight(buffer, cx, cz, neighborBuffers));
        const meshArrays = buildGreedyArrays(buffer, cx, cz, neighborBuffers, data.pooledBuffers);`;

code = code.replace(oldRebuildBlock, newRebuildBlock);

// Include lightOverflow in rebuild response
code = code.replace(
  "self.postMessage({ type: 'rebuild', cx, cz, meshArrays, unusedBuffers }, transferables);",
  "self.postMessage({ type: 'rebuild', cx, cz, meshArrays, lightOverflow, unusedBuffers }, transferables);"
);

fs.writeFileSync(filePath, code);
console.log('chunkWorker.js patched again!');
