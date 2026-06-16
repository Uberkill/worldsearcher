import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC_DIR = path.join(__dirname, '../src');

let hasError = false;

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(path.join(dir, f));
  });
}

console.log('[Architecture Linter] Running custom static analysis...');

walkDir(SRC_DIR, function(filePath) {
  if (filePath.endsWith('.jsx') || filePath.endsWith('.js')) {
    const content = fs.readFileSync(filePath, 'utf8');

    // Rule 1: No mapping of massive geometries in React
    if (content.includes('.map(') && content.includes('<InstancedMesh')) {
      console.error(`\x1b[31m[ERROR]\x1b[0m Architecture Violation in ${filePath}:`);
      console.error(`  Found '.map(' combined with '<InstancedMesh'.`);
      console.error(`  RULE: Do not map high-volume visual geometries in the React Virtual DOM.`);
      console.error(`  Use a Native Three.js Imperative pipeline (like ChunkRenderer) instead.`);
      hasError = true;
    }

    // Rule 2: No Main-Thread RLE decompression
    if (content.includes('function decompressRLE') && !filePath.includes('Worker') && !filePath.includes('dbWorker.js')) {
      console.error(`\x1b[31m[ERROR]\x1b[0m Architecture Violation in ${filePath}:`);
      console.error(`  Found RLE logic on the main thread.`);
      console.error(`  RULE: Binary array math must be offloaded to Web Workers.`);
      hasError = true;
    }

    // Rule 3: No raw loops on TypedArrays without explicitly transferring
    // Basic heuristic to catch simple mistakes (this is not a full AST parser, just a regex net)
    if (content.match(/for\s*\([^;]*\bin\b.*(Float32Array|Uint32Array|Uint8Array)/)) {
       console.error(`\x1b[31m[ERROR]\x1b[0m Architecture Violation in ${filePath}:`);
       console.error(`  Found a 'for...in' loop attempting to iterate over a TypedArray.`);
       console.error(`  RULE: 'for...in' loops on TypedArrays iterate over string indices and will break the game.`);
       hasError = true;
    }
  }
});

if (hasError) {
  console.error('\x1b[31m[Architecture Linter] Failed. Please fix the above architectural violations.\x1b[0m');
  console.log('\x1b[33mSee docs/core/AI_AGENT_WARNINGS.md for more context.\x1b[0m');
  process.exit(1);
} else {
  console.log('\x1b[32m[Architecture Linter] Passed. No architectural violations found.\x1b[0m');
  process.exit(0);
}
