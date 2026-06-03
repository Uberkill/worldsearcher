const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/stores/useNetworkStore.js');
let code = fs.readFileSync(filePath, 'utf-8');

const syncHandler = `
    else if (data.type === 'INVENTORY_SYNC') {
       const { getGameStore } = require('./storeLinker');
       const useStore = getGameStore();
       if (useStore) {
           if (data.reason) {
              console.warn("Inventory Sync (Rejection Rubber-band):", data.reason);
           }
           if (data.authoritativeInventories) {
               useStore.setState({ authoritativeInventories: data.authoritativeInventories });
               // If we are a Guest, snap our local inventory prediction to the Host's authority
               const myId = get().playerId;
               if (data.authoritativeInventories[myId]) {
                   useStore.setState({ inventory: data.authoritativeInventories[myId] });
               }
           }
           if (data.chests) {
               useStore.setState({ chests: data.chests });
           }
       }
    }
`;

const insertPoint = `    else if (data.type === 'WORLD_SYNC') {`;

code = code.replace(insertPoint, syncHandler + insertPoint);

fs.writeFileSync(filePath, code);
console.log('useNetworkStore patched with INVENTORY_SYNC handler!');
