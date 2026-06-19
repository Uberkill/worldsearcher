const fs = require('fs');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

const code = fs.readFileSync('src/stores/worldActions.js', 'utf8');

const ast = parser.parse(code, {
  sourceType: 'module',
  plugins: ['jsx']
});

// We want to extract functions from the return object of worldActions
let returnedProperties = [];
traverse(ast, {
  ReturnStatement(path) {
    if (path.parentPath.parentPath.isVariableDeclarator() && path.parentPath.parentPath.node.id.name === 'worldActions') {
      returnedProperties = path.node.argument.properties;
      path.stop();
    }
  }
});

const getPropCode = (propName) => {
  const prop = returnedProperties.find(p => p.key && p.key.name === propName);
  if (!prop) return '';
  return `export const ${propName} = (set, get) => ${generate(prop.value).code};`;
}

// But wait, many functions call other functions inside the same object using `get()`.
// For example `get().requestMeshRebuild(chunkKey)` - this works perfectly across files!
// Because `get()` resolves to the god store, which has ALL actions mixed in.

// The only issue is the module-scoped variables.
// Let's create `sharedState.js` with all shared variables.
const sharedStateCode = `
export const inFlightChunks = new Set();
export const inFlightPromises = new Map();
export const cancelledChunks = new Set();
export const processingNetworkDeltas = new Set();
export const dirtyChunkSet = new Set();
export const inFlightRebuildSet = new Set();
export const pass1Cache = new Map();
export const pendingUnloads = new Map();
export const flareLightMap = new Map();
export const bufferRecycleQueue = [];

export const worldState = {
  rafRebuildHandle: null,
  worldReadyForRebuild: false,
  bufferRecycleTimer: null,
  currentRawGet: null
};

export const getChunkKey = (x, z) => \`\${Math.floor(x / 16)},\${Math.floor(z / 16)}\`;
export const getBlockKey = (x, y, z) => \`\${x},\${y},\${z}\`;
`;

// Garbage Collection
const gcFuncs = ['unloadDistantChunks', 'tickGarbageCollection', 'queueBuffersForRecycling', 'recycleChunkDataInternal'];
let gcCode = `import { useChunkStore } from '../chunkSlice';
import { pendingUnloads, bufferRecycleQueue, worldState } from './sharedState';
import { chunkWorkerPool } from '../../utils/workerPool';

export const createGarbageCollection = (set, get) => ({
`;
for (let f of gcFuncs) {
  const prop = returnedProperties.find(p => p.key && p.key.name === f);
  if (prop) gcCode += `  ${f}: ${generate(prop.value).code},\n`;
}
gcCode += `});\n`;

// Strangler Interceptors
// Needs to extract staticWorldProxy and getCombinedState.
// We can just grab their AST from the top-level.
let stranglerCode = `import { useChunkStore } from '../chunkSlice';
import { useInventoryStore } from '../inventorySlice';
import { useEnvironmentStore } from '../environmentSlice';
import { useFlareStore } from '../flareSlice';
import { worldState } from './sharedState';

`;
traverse(ast, {
  VariableDeclarator(path) {
    if (path.node.id.name === 'staticWorldProxy' || path.node.id.name === 'getCombinedState') {
      stranglerCode += generate(path.parent).code + '\n';
    }
  }
});
stranglerCode += `\nexport { getCombinedState };\n`;

// Wait, I am getting too deep into writing code with AST generation which might drop comments and formatting, or break subtly if there are imports missing.
// A simpler way: I can just copy worldActions.js and delete lines. But line-deletion is hard for 3000 lines.
// So AST is good. Let's list imports first.
const imports = [];
traverse(ast, {
  ImportDeclaration(path) {
    imports.push(generate(path.node).code);
  }
});
const importsStr = imports.join('\n');

fs.writeFileSync('scratch/sharedState.js', sharedStateCode);
fs.writeFileSync('scratch/garbageCollection.js', importsStr + '\n' + gcCode);

console.log("Successfully extracted GC and shared state.");
