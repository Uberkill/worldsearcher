const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/utils/workerPool.js');
let code = fs.readFileSync(filePath, 'utf-8');

code = code.replace(
  "rebuild(packedBuffer, neighborBuffers, cx, cz, seed) {",
  "rebuild(packedBuffer, neighborBuffers, cx, cz, seed, removedLights) {"
);

code = code.replace(
  "this._dispatchRebuild(workerObj, cx, cz, packedBuffer, neighborBuffers, resolve, pooledBuffers);",
  "this._dispatchRebuild(workerObj, cx, cz, packedBuffer, neighborBuffers, resolve, pooledBuffers, removedLights);"
);

code = code.replace(
  "const task = { type: 'rebuild', cx, cz, packedBuffer, neighborBuffers, resolve, pooledBuffers };",
  "const task = { type: 'rebuild', cx, cz, packedBuffer, neighborBuffers, resolve, pooledBuffers, removedLights };"
);

code = code.replace(
  "this._dispatchRebuild(workerObj, task.cx, task.cz, task.packedBuffer, task.neighborBuffers, task.resolve, task.pooledBuffers);",
  "this._dispatchRebuild(workerObj, task.cx, task.cz, task.packedBuffer, task.neighborBuffers, task.resolve, task.pooledBuffers, task.removedLights);"
);

code = code.replace(
  "_dispatchRebuild(workerObj, cx, cz, packedBuffer, neighborBuffers, resolve, pooledBuffers) {",
  "_dispatchRebuild(workerObj, cx, cz, packedBuffer, neighborBuffers, resolve, pooledBuffers, removedLights) {"
);

code = code.replace(
  "workerObj.instance.postMessage({ type: 'rebuild', cx, cz, packedBuffer, neighborBuffers, pooledBuffers }, Array.from(uniqueTransfers));",
  "workerObj.instance.postMessage({ type: 'rebuild', cx, cz, packedBuffer, neighborBuffers, pooledBuffers, removedLights }, Array.from(uniqueTransfers));"
);

fs.writeFileSync(filePath, code);
console.log('workerPool.js patched!');
