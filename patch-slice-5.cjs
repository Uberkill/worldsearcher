const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/stores/createPlayerSlice.js');
let code = fs.readFileSync(filePath, 'utf-8');

const transactionLogic = `
  // --- Phase 6: Authoritative Inventory Transactions ---
  // Only executed by the Host
  authoritativeInventories: {}, // { [playerId]: [ ...slots ] }
  
  initAuthoritativeInventory: (playerId) => set(prev => {
      if (prev.authoritativeInventories[playerId]) return {};
      // Default loadout
      const newInv = new Array(36).fill(null);
      newInv[0] = { texture: 'sword', count: 1 };
      newInv[1] = { texture: 'pickaxe', count: 1 };
      newInv[4] = { texture: 'flare', count: 64 };
      newInv[5] = { texture: 'dirt', count: 64 };
      newInv[6] = { texture: 'wood', count: 64 };
      newInv[7] = { texture: 'stone', count: 64 };
      newInv[8] = { texture: 'crafting_table', count: 64 };
      return {
          authoritativeInventories: {
              ...prev.authoritativeInventories,
              [playerId]: newInv
          }
      };
  }),

  processInventoryTransaction: (intent, senderId) => {
      const state = get();
      
      const getSlotData = (loc) => {
          if (loc.type === 'player') return state.authoritativeInventories[loc.id]?.[loc.slot];
          if (loc.type === 'container') return state.chests[loc.id]?.[loc.slot];
          return null;
      };
      
      const setSlotData = (loc, data) => {
          if (loc.type === 'player') {
              set(prev => {
                 const newInv = [...(prev.authoritativeInventories[loc.id] || [])];
                 newInv[loc.slot] = data;
                 return { authoritativeInventories: { ...prev.authoritativeInventories, [loc.id]: newInv } };
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

      if (intent.action === 'MOVE') {
          const srcData = getSlotData(intent.source);
          const dstData = getSlotData(intent.destination);
          
          if (!srcData) throw new Error("Source slot empty");
          
          if (!dstData) {
             // Simple move
             setSlotData(intent.destination, { ...srcData });
             setSlotData(intent.source, null);
          } else if (dstData.texture === srcData.texture && !srcData.uuid && !dstData.uuid) {
             // Merge stacks (Max 64)
             const total = srcData.count + dstData.count;
             if (total <= 64) {
                setSlotData(intent.destination, { ...dstData, count: total });
                setSlotData(intent.source, null);
             } else {
                setSlotData(intent.destination, { ...dstData, count: 64 });
                setSlotData(intent.source, { ...srcData, count: total - 64 });
             }
          } else {
             // Swap slots
             setSlotData(intent.destination, { ...srcData });
             setSlotData(intent.source, { ...dstData });
          }
      }
      else if (intent.action === 'SPLIT') {
          const srcData = getSlotData(intent.source);
          if (!srcData || srcData.count <= 1) throw new Error("Cannot split");
          
          const half = Math.floor(srcData.count / 2);
          const rem = srcData.count - half;
          
          const dstData = getSlotData(intent.destination);
          if (dstData) throw new Error("Destination not empty");
          
          setSlotData(intent.source, { ...srcData, count: rem });
          setSlotData(intent.destination, { ...srcData, count: half });
      }
      else if (intent.action === 'DROP') {
          const srcData = getSlotData(intent.source);
          if (!srcData) throw new Error("Nothing to drop");
          
          // Drop item entity in world
          const pPos = state.players[senderId]?.pos || [0, 260, 0];
          const spreadX = pPos[0] + (Math.random() - 0.5) * 2;
          const spreadZ = pPos[2] + (Math.random() - 0.5) * 2;
          
          set(prev => ({
             droppedItems: [...(prev.droppedItems || []), {
                id: \`drop_\${Date.now()}_\${Math.random()}\`,
                texture: srcData.texture,
                pos: [spreadX, pPos[1], spreadZ],
                count: intent.amount || srcData.count
             }]
          }));
          
          if (intent.amount && intent.amount < srcData.count) {
             setSlotData(intent.source, { ...srcData, count: srcData.count - intent.amount });
          } else {
             setSlotData(intent.source, null);
          }
      }
      else if (intent.action === 'CRAFT') {
          import('../data/recipes.json').then(({ default: recipes }) => {
             const recipe = recipes[intent.recipeId];
             if (!recipe) throw new Error("Invalid recipe");
             // TODO: Advanced DAG validation logic
          });
      }
  },
`;

const insertPoint = `  removePickupFeedItem: (id) => set((prev) => ({ pickupFeed: prev.pickupFeed.filter(item => item.id !== id) })),`;

code = code.replace(insertPoint, insertPoint + transactionLogic);

fs.writeFileSync(filePath, code);
console.log('createPlayerSlice patched with authoritative inventory logic!');
