const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/stores/createPlayerSlice.js');
let code = fs.readFileSync(filePath, 'utf-8');

const uiStateInsertion = `
  // --- Phase 6 UI: Transient State & Optimistic Execution ---
  heldItem: null,
  setHeldItem: (item) => set({ heldItem: item }),
  
  executeLocalTransaction: (source, destination, action, amount = null) => {
      const state = get();
      
      // 1. Optimistic Local UI Mutation
      // We must mutate the local 'inventory' or 'chests' prediction immediately.
      // But only if we are the Guest (if we are Host, we can just process it right away).
      const isHost = getNetworkStore().isHost;
      
      if (!isHost) {
          const getSlotData = (loc) => {
              if (loc.type === 'player') return state.inventory[loc.slot];
              if (loc.type === 'container') return state.chests[loc.id]?.[loc.slot];
              return null;
          };
          
          const setSlotData = (loc, data) => {
              if (loc.type === 'player') {
                  set(prev => {
                     const newInv = [...prev.inventory];
                     newInv[loc.slot] = data;
                     return { inventory: newInv };
                  });
              } else if (loc.type === 'container') {
                  set(prev => {
                     const newChests = { ...prev.chests };
                     const newChest = [...(newChests[loc.id] || [])];
                     newChest[loc.slot] = data;
                     newChests[loc.id] = newChest;
                     return { chests: newChests };
                  });
              }
          };

          if (action === 'MOVE') {
              const srcData = getSlotData(source);
              const dstData = getSlotData(destination);
              if (srcData) {
                  if (!dstData) {
                     setSlotData(destination, { ...srcData });
                     setSlotData(source, null);
                  } else if (dstData.texture === srcData.texture && !srcData.uuid && !dstData.uuid) {
                     const total = srcData.count + dstData.count;
                     if (total <= 64) {
                        setSlotData(destination, { ...dstData, count: total });
                        setSlotData(source, null);
                     } else {
                        setSlotData(destination, { ...dstData, count: 64 });
                        setSlotData(source, { ...srcData, count: total - 64 });
                     }
                  } else {
                     setSlotData(destination, { ...srcData });
                     setSlotData(source, { ...dstData });
                  }
              }
          }
          // Split & Drop omitted for brevity here (handled in authoritative anyway).
      }
      
      // 2. Dispatch INVENTORY_INTENT to Host
      const packet = {
          type: 'INVENTORY_INTENT',
          action, source, destination, amount
      };
      
      if (isHost) {
          // If we are host, just execute it directly!
          const myId = getNetworkStore().playerId;
          state.processInventoryTransaction(packet, myId);
          // And snap our local predictive inventory to the authoritative one
          set({ inventory: state.authoritativeInventories[myId] });
      } else {
          // Send to host
          const peerConn = getNetworkStore().connections[0];
          if (peerConn) {
             try { peerConn.send(packet); } catch(e) {}
          }
      }
  },
`;

// Insert after authoritativeInventories
const insertPoint = `  authoritativeInventories: {}, // { [playerId]: [ ...slots ] }`;
code = code.replace(insertPoint, insertPoint + uiStateInsertion);

fs.writeFileSync(filePath, code);
console.log('createPlayerSlice patched with Phase 6 UI logic!');
