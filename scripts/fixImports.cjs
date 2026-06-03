const fs = require('fs');
const path = require('path');

const storesDir = path.join(__dirname, '../src/stores');

// 1. Fix createWorldSlice.js
const worldSlicePath = path.join(storesDir, 'createWorldSlice.js');
let worldSlice = fs.readFileSync(worldSlicePath, 'utf8');
worldSlice = `import { getNetworkStore } from './storeLinker';\n` + worldSlice;
worldSlice = worldSlice.replace(/import\('\.\/useNetworkStore'\)\.then\(\(\{ useNetworkStore \}\) => \{([\s\S]*?)\}\);/g, (match, body) => {
  return `const useNetworkStore = getNetworkStore();\n      if (useNetworkStore) {${body}}`;
});
fs.writeFileSync(worldSlicePath, worldSlice);

// 2. Fix createPlayerSlice.js
const playerSlicePath = path.join(storesDir, 'createPlayerSlice.js');
let playerSlice = fs.readFileSync(playerSlicePath, 'utf8');
playerSlice = `import { getNetworkStore } from './storeLinker';\n` + playerSlice;
playerSlice = playerSlice.replace(/import\('\.\/useNetworkStore'\)\.then\(\(\{ useNetworkStore \}\) => \{([\s\S]*?)\}\);/g, (match, body) => {
  return `const useNetworkStore = getNetworkStore();\n      if (useNetworkStore) {${body}}`;
});
fs.writeFileSync(playerSlicePath, playerSlice);

// 3. Fix useNetworkStore.js
const networkStorePath = path.join(storesDir, 'useNetworkStore.js');
let networkStore = fs.readFileSync(networkStorePath, 'utf8');
networkStore = `import { getGameStore, setNetworkStore } from './storeLinker';\n` + networkStore;
networkStore = networkStore.replace(/import\('\.\/useStore'\)\.then\(\(\{ useStore \}\) => \{([\s\S]*?)\}\);/g, (match, body) => {
  return `const useStore = getGameStore();\n      if (useStore) {${body}}`;
});
// Also fix bottom
networkStore = networkStore.replace(/import\('\.\/useStore'\)\.then\(module => window\.useStore = module\.useStore\);/, '');
if (!networkStore.includes('setNetworkStore(useNetworkStore)')) {
  networkStore += '\nsetNetworkStore(useNetworkStore);\n';
}
fs.writeFileSync(networkStorePath, networkStore);

console.log("Replaced all dynamic imports with storeLinker!");
