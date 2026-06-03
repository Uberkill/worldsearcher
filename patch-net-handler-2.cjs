const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/stores/useNetworkStore.js');
let code = fs.readFileSync(filePath, 'utf-8');

const oldLogic = `           // 4. Perform Transaction Logic (Will be handled in createWorldSlice/createPlayerSlice)
           // TODO: Execute Move/Split/Drop/Craft using the authoritative store.
           // For now, we simulate success and broadcast sync.
           
           console.log("Valid Transaction:", data.action, data.source, "->", data.destination);
           
           // Broadcast success sync
           get().broadcastEvent({ type: 'INVENTORY_SYNC' });`;

const newLogic = `           // 4. Perform Transaction Logic
           const { getGameStore } = require('./storeLinker');
           const useStore = getGameStore();
           if (useStore) {
               useStore.getState().processInventoryTransaction(data, senderId);
               console.log("Valid Transaction:", data.action, data.source, "->", data.destination);
               // Broadcast success sync (Host broadcasts authoritative state to all peers)
               get().broadcastEvent({ 
                   type: 'INVENTORY_SYNC',
                   authoritativeInventories: useStore.getState().authoritativeInventories,
                   chests: useStore.getState().chests
               });
           }`;

code = code.replace(oldLogic, newLogic);

fs.writeFileSync(filePath, code);
console.log('useNetworkStore patched to call processInventoryTransaction!');
