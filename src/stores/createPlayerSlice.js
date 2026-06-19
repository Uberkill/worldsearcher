import { getNetworkStore } from './storeLinker';
import { get as getIDB, set as setIDB } from 'idb-keyval';
import { useInventoryStore } from './inventorySlice';
import { useConnectionStore } from './connectionSlice';
import { useChatStore } from './chatSlice';
import { useSyncStore } from './syncSlice';
import {
  playerPosition,
  playerLastSafePosition,
  playerRotation,
} from '../globals';
import { v4 as uuidV4 } from 'uuid';
import { getSeed } from '../worldSeed';
import { EventBus } from '../utils/EventBus';
import { matchRecipe } from '../registry/CraftingRegistry';
import { useChunkStore } from './chunkSlice';
import skillsData from '../registry/skills.json';
import { useUIStore } from './useUIStore';

export const createPlayerSlice = (set, get) => ({
  version: 1,
  forceTeleportPos: null,
  executeTeleport: (pos) => { playerPosition.set(pos[0], pos[1], pos[2]); set({ forceTeleportPos: pos }); },
  teleportLocalPlayer: (x, y, z) => { playerPosition.set(x, y, z); set({ forceTeleportPos: [x, y, z] }); },
  isStreamingTerrain: false,
  texture: 'sword',
  activeHotbarIndex: 0,
  coins: 0,
  isInventoryOpen: false,
  isShopOpen: false,
  isCraftingTableOpen: false,
  isSkillTreeOpen: false,
  isQuestJournalOpen: false,
  isHeartCoreOpen: false,
  isLunarAnchorOpen: false,
  isAstrolabeOpen: false,
  isWarpDriveUIOpen: false,
  toggleHeartCore: () => set(state => ({ isHeartCoreOpen: !state.isHeartCoreOpen, isLunarAnchorOpen: false, isAstrolabeOpen: false, isWarpDriveUIOpen: false })),
  toggleLunarAnchor: () => set(state => ({ isLunarAnchorOpen: !state.isLunarAnchorOpen, isHeartCoreOpen: false, isAstrolabeOpen: false, isWarpDriveUIOpen: false })),
  toggleAstrolabe: () => set(state => ({ isAstrolabeOpen: !state.isAstrolabeOpen, isLunarAnchorOpen: false, isHeartCoreOpen: false, isWarpDriveUIOpen: false })),
  toggleWarpDrive: () => set(state => ({ isWarpDriveUIOpen: !state.isWarpDriveUIOpen, isAstrolabeOpen: false, isLunarAnchorOpen: false, isHeartCoreOpen: false })),

  activeChestId: null,
  activeFurnaceId: null,

  isBuildMode: false,
  toggleBuildMode: () => set(state => ({ isBuildMode: !state.isBuildMode })),
  
  isShipyardUIOpen: false,
  shipyardCorePos: null,
  toggleShipyardUI: (pos = null) => {
    useUIStore.getState().toggleModal('SHIPYARD', pos);
  },

  isUIActive: () => {
      const state = get();
      return useUIStore.getState().getAnyUIOpen() || 
             useChatStore.getState().isTyping ||
             state.isInventoryOpen ||
             state.isShopOpen ||
             state.isCraftingTableOpen ||
             state.isSkillTreeOpen ||
             state.isQuestJournalOpen ||
             state.isHeartCoreOpen ||
             state.isLunarAnchorOpen ||
             state.isAstrolabeOpen ||
             state.isWarpDriveUIOpen ||
             state.isShipyardUIOpen;
  },

  openChest: (x, y, z, isShip = false) => {
    const chestId = isShip ? `ship_${x}_${y}_${z}` : `${x},${y},${z}`;
    useInventoryStore.setState((prev) => {
      if (!prev.chests[chestId]) {
        return {
          chests: {
            ...prev.chests,
            [chestId]: new Array(27).fill(null)
          }
        };
      }
      return {};
    });
    set({ activeChestId: chestId });
    useUIStore.getState().toggleModal('CHEST');
  },
  
  closeChest: () => {
    const state = get();
    if (state.activeChestId && state.heldItem) {
      state.executeLocalTransaction(
        state.heldItem.sourceLoc,
        null,
        'DROP',
        state.heldItem.count
      );
      set({ heldItem: null });
    }
    set({ activeChestId: null });
    useUIStore.getState().closeModal();
  },

  openFurnace: (x, y, z, isShip = false) => {
    const furnaceId = isShip ? `ship_${x}_${y}_${z}` : `${x},${y},${z}`;
    useInventoryStore.setState((prev) => {
      const updates = {};
      if (!prev.chests[furnaceId]) {
        updates.chests = {
          ...prev.chests,
          [furnaceId]: new Array(3).fill(null) // 0: Input, 1: Fuel, 2: Output
        };
      }
      if (!prev.machines[furnaceId]) {
        updates.machines = {
          ...prev.machines,
          [furnaceId]: {
            burnTimeLeft: 0,
            currentFuelMax: 1,
            cookProgress: 0,
            currentCookMax: 1
          }
        };
      }
      return updates;
    });
    set({ activeFurnaceId: furnaceId });
    useUIStore.getState().toggleModal('FURNACE');
  },
  
  closeFurnace: () => {
    const state = get();
    if (state.activeFurnaceId && state.heldItem) {
      state.executeLocalTransaction(
        state.heldItem.sourceLoc,
        null,
        'DROP',
        state.heldItem.count
      );
      set({ heldItem: null });
    }
    set({ activeFurnaceId: null });
    useUIStore.getState().closeModal();
  },

  pickupFeed: [],
  removePickupFeedItem: (id) =>
    set((prev) => ({
      pickupFeed: prev.pickupFeed.filter((item) => item.id !== id),
    })),


  // --- Phase 6: Authoritative Inventory Transactions ---
  // Only executed by the Host
  authoritativeInventories: {}, // { [playerId]: [ ...slots ] }
  authoritativeTableGrids: {}, // { [playerId]: [ ...slots ] }
  // --- Phase 6 UI: Transient State & Optimistic Execution ---
  heldItem: null,
  setHeldItem: (item) => set({ heldItem: item }),

  executeLocalTransaction: (source, destination, action, amount = null) => {
    const state = get();

    // 1. Optimistic Local UI Mutation
    // We must mutate the local 'inventory' or 'chests' prediction immediately.
    // But only if we are the Guest (if we are Host, we can just process it right away).
    const isHost = useConnectionStore.getState().isHost;

    if (!isHost) {
      const getSlotData = (loc) => {
        if (loc.type === 'player') return state.inventory[loc.slot];
        if (loc.type === 'container') return useInventoryStore.getState().chests[loc.id]?.[loc.slot];
        if (loc.type === 'table') return state.tableGrid[loc.slot];
        if (loc.type === 'tableResult') return state.tableResult;
        if (loc.type === 'creative') {
          if (get().gameMode?.toLowerCase() !== 'creative') return null; // Anti-cheat prediction
          return { texture: loc.texture, count: 64 };
        }
        return null;
      };

      const setSlotData = (loc, data) => {
        if (loc.type === 'player') {
          set((prev) => {
            const newInv = [...prev.inventory];
            newInv[loc.slot] = data;
            return { inventory: newInv };
          });
        } else if (loc.type === 'container') {
          useInventoryStore.setState((prev) => {
            const newChests = { ...prev.chests };
            const newChest = [...(newChests[loc.id] || [])];
            newChest[loc.slot] = data;
            newChests[loc.id] = newChest;
            return { chests: newChests };
          });
        } else if (loc.type === 'table') {
          set((prev) => {
            const newTable = [...prev.tableGrid];
            newTable[loc.slot] = data;
            const newResult = matchRecipe(newTable);
            return { tableGrid: newTable, tableResult: newResult };
          });
        } else if (loc.type === 'tableResult') {
          set({ tableResult: data });
        }
      };

      if (action === 'CRAFT_EXTRACT') {
        const grid = [...state.tableGrid];
        const result = matchRecipe(grid);
        if (result) {
          let max_crafts_ingredients = 64;
          grid.forEach(item => {
            if (item) max_crafts_ingredients = Math.min(max_crafts_ingredients, item.count);
          });
          
          let actual_crafts = 1;
          if (amount === 'QUICK') {
            let freeSpace = 0;
            state.inventory.forEach(item => {
              if (!item) freeSpace += 64;
              else if (item.texture === result.texture) freeSpace += (64 - item.count);
            });
            const max_crafts_space = Math.floor(freeSpace / result.count);
            actual_crafts = Math.min(max_crafts_ingredients, max_crafts_space);
          }
          
          if (actual_crafts > 0) {
            for (let i = 0; i < grid.length; i++) {
              if (grid[i]) {
                grid[i] = { ...grid[i], count: grid[i].count - actual_crafts };
                if (grid[i].count <= 0) grid[i] = null;
              }
            }
            set({ tableGrid: grid, tableResult: matchRecipe(grid) });
            if (amount === 'QUICK') {
              get().addInventoryItem(result.texture, result.count * actual_crafts);
            }
          }
        }
      } else if (action === 'MOVE') {
        const srcData = getSlotData(source);
        const dstData = getSlotData(destination);
        if (srcData) {
          const moveAmount = amount
            ? Math.min(amount, srcData.count)
            : srcData.count;
          const remainingAmount = srcData.count - moveAmount;

          if (!dstData) {
            setSlotData(destination, { ...srcData, count: moveAmount });
            setSlotData(
              source,
              remainingAmount > 0
                ? { ...srcData, count: remainingAmount }
                : null
            );
          } else if (
            dstData.texture === srcData.texture &&
            !srcData.uuid &&
            !dstData.uuid
          ) {
            const total = moveAmount + dstData.count;
            if (total <= 64) {
              setSlotData(destination, { ...dstData, count: total });
              setSlotData(
                source,
                remainingAmount > 0
                  ? { ...srcData, count: remainingAmount }
                  : null
              );
            } else {
              const actualMoved = 64 - dstData.count;
              setSlotData(destination, { ...dstData, count: 64 });
              setSlotData(source, {
                ...srcData,
                count: srcData.count - actualMoved,
              });
            }
          } else {
            setSlotData(destination, { ...srcData });
            setSlotData(source, { ...dstData });
          }
        }
      } else if (action === 'CONSUME') {
        const srcData = getSlotData(source);
        if (srcData) {
          if (srcData.count > amount) {
            setSlotData(source, { ...srcData, count: srcData.count - amount });
          } else {
            setSlotData(source, null);
          }
        }
      }
      // Split & Drop omitted for brevity here (handled in authoritative anyway).
    }

    // 2. Dispatch INVENTORY_INTENT to Host
    const intentId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    if (!window.__intentQueue) window.__intentQueue = [];
    window.__intentQueue.push(intentId);

    const packet = {
      type: 'INVENTORY_INTENT',
      intentId,
      action,
      source,
      destination,
      amount,
    };

    if (isHost) {
      // If we are host, just execute it directly!
      const myId = useConnectionStore.getState().playerId;
      try {
        state.processInventoryTransaction(packet, myId);
      } catch (e) {
        console.warn('Local Host Transaction Failed:', e.message);
      }
      // And snap our local predictive inventory to the authoritative one
      set({
        inventory: get().authoritativeInventories[myId] || Array(36).fill(null),
      });
    } else {
      // Send to host
      const peerConn = useConnectionStore.getState().connections[0];
      if (peerConn) {
        try {
          peerConn.send(packet);
        } catch (_e) {
          /* intentionally ignored: silent network drop */
        }
      }
    }
  },

  initAuthoritativeInventory: (playerId) =>
    set((prev) => {
      if (prev.authoritativeInventories[playerId]) return {};
      // Default loadout
      const newInv = new Array(36).fill(null);
      newInv[0] = { texture: 'sword', count: 1 };
      newInv[1] = { texture: 'pickaxe', count: 1 };
      newInv[2] = { texture: 'gauss_rifle', count: 1 };
      newInv[3] = { texture: 'grapple', count: 1 };
      newInv[4] = { texture: 'flare', count: 64 };
      newInv[5] = { texture: 'dirt', count: 64 };
      newInv[6] = { texture: 'wood', count: 64 };
      newInv[7] = { texture: 'stone', count: 64 };
      newInv[8] = { texture: 'crafting_table', count: 64 };
      return {
        authoritativeInventories: {
          ...prev.authoritativeInventories,
          [playerId]: newInv,
        },
        authoritativeTableGrids: {
          ...prev.authoritativeTableGrids,
          [playerId]: Array(9).fill(null),
        },
      };
    }),

  processInventoryTransaction: (intent, senderId) => {
    const state = get();

    const getSlotData = (loc) => {
      if (loc.type === 'player') {
        const actualId = loc.id === 'player' ? senderId : loc.id;
        return state.authoritativeInventories[actualId]?.[loc.slot];
      }
      if (loc.type === 'container') return useInventoryStore.getState().chests[loc.id]?.[loc.slot];
      if (loc.type === 'table') {
        const actualId = loc.id === 'table' ? senderId : (loc.id || senderId);
        return state.authoritativeTableGrids[actualId]?.[loc.slot];
      }
      if (loc.type === 'tableResult') return state.tableResult;
      if (loc.type === 'creative') {
        const isSelf = senderId === useConnectionStore.getState().playerId;
        if (isSelf && state.gameMode?.toLowerCase() !== 'creative') return null; // Anti-cheat
        return { texture: loc.texture, count: 64 };
      }
      return null;
    };

    const setSlotData = (loc, data) => {
      if (loc.type === 'player') {
        const actualId = loc.id === 'player' ? senderId : loc.id;
        set((prev) => {
          const newInv = [...(prev.authoritativeInventories[actualId] || [])];
          newInv[loc.slot] = data;
          return {
            authoritativeInventories: {
              ...prev.authoritativeInventories,
              [actualId]: newInv,
            },
          };
        });
      } else if (loc.type === 'container') {
        useInventoryStore.setState((prev) => {
          const newChests = { ...prev.chests };
          const newChest = [...(newChests[loc.id] || [])];
          newChest[loc.slot] = data;
          newChests[loc.id] = newChest;
          return { chests: newChests };
        });
      } else if (loc.type === 'table') {
        const actualId = loc.id === 'table' ? senderId : (loc.id || senderId);
        set((prev) => {
          const newTable = [...(prev.authoritativeTableGrids[actualId] || Array(9).fill(null))];
          newTable[loc.slot] = data;
          const nextState = {
            authoritativeTableGrids: {
              ...prev.authoritativeTableGrids,
              [actualId]: newTable,
            },
          };
          if (actualId === useConnectionStore.getState().playerId) {
            nextState.tableGrid = newTable;
            nextState.tableResult = matchRecipe(newTable);
          }
          return nextState;
        });
      } else if (loc.type === 'tableResult') {
        if (senderId === useConnectionStore.getState().playerId) {
          set({ tableResult: data });
        }
      }
    };

    if (intent.action === 'CRAFT_EXTRACT') {
      const actualId = senderId;
      const grid = [...(state.authoritativeTableGrids[actualId] || Array(9).fill(null))];
      const result = matchRecipe(grid);
      if (result) {
        let max_crafts_ingredients = 64;
        grid.forEach(item => {
          if (item) max_crafts_ingredients = Math.min(max_crafts_ingredients, item.count);
        });
        
        let actual_crafts = 1;
        if (intent.amount === 'QUICK') {
          let freeSpace = 0;
          const inv = state.authoritativeInventories[actualId] || Array(36).fill(null);
          inv.forEach(item => {
            if (!item) freeSpace += 64;
            else if (item.texture === result.texture) freeSpace += (64 - item.count);
          });
          const max_crafts_space = Math.floor(freeSpace / result.count);
          actual_crafts = Math.min(max_crafts_ingredients, max_crafts_space);
        }
        
        if (actual_crafts > 0) {
          for (let i = 0; i < grid.length; i++) {
            if (grid[i]) {
              grid[i] = { ...grid[i], count: grid[i].count - actual_crafts };
              if (grid[i].count <= 0) grid[i] = null;
            }
          }
          set((prev) => {
             const nextState = {
               authoritativeTableGrids: {
                 ...prev.authoritativeTableGrids,
                 [actualId]: grid,
               }
             };
             if (actualId === useConnectionStore.getState().playerId) {
                nextState.tableGrid = grid;
                nextState.tableResult = matchRecipe(grid);
             }
             return nextState;
          });
          
          if (intent.amount === 'QUICK') {
             // Add directly to authoritative inventory!
             let leftover = actual_crafts * result.count;
             set((prev) => {
                const newInv = [...(prev.authoritativeInventories[actualId] || Array(36).fill(null))];
                for (let i = 0; i < 36 && leftover > 0; i++) {
                  if (newInv[i]?.texture === result.texture && newInv[i].count < 64) {
                    const space = 64 - newInv[i].count;
                    const toAdd = Math.min(space, leftover);
                    newInv[i] = { ...newInv[i], count: newInv[i].count + toAdd };
                    leftover -= toAdd;
                  }
                }
                for (let i = 0; i < 36 && leftover > 0; i++) {
                  if (!newInv[i]) {
                    const toAdd = Math.min(64, leftover);
                    newInv[i] = { texture: result.texture, count: toAdd };
                    leftover -= toAdd;
                  }
                }
                return {
                   authoritativeInventories: {
                     ...prev.authoritativeInventories,
                     [actualId]: newInv,
                   }
                };
             });
          }
        }
      }
    } else if (intent.action === 'MOVE') {
      if (!intent.source || !intent.destination) return; // Ignore missing destinations
      if (
        intent.source.id === intent.destination.id &&
        intent.source.slot === intent.destination.slot &&
        intent.source.type === intent.destination.type
      )
        return; // Same slot

      let srcData = getSlotData(intent.source);
      const dstData = getSlotData(intent.destination);

      if (intent.source.type === 'tableResult') {
         const actualId = senderId;
         const grid = [...(state.authoritativeTableGrids[actualId] || Array(9).fill(null))];
         const result = matchRecipe(grid);
         if (!result) return;
         srcData = result;
      }

      if (!srcData) throw new Error('Source slot empty');

      const moveAmount = intent.amount
        ? Math.min(intent.amount, srcData.count)
        : srcData.count;
      const remainingAmount = srcData.count - moveAmount;

      if (!dstData) {
        // Simple move
        setSlotData(intent.destination, { ...srcData, count: moveAmount });
        setSlotData(
          intent.source,
          remainingAmount > 0 ? { ...srcData, count: remainingAmount } : null
        );
      } else if (
        dstData.texture === srcData.texture &&
        !srcData.uuid &&
        !dstData.uuid
      ) {
        // Merge stacks (Max 64)
        const total = moveAmount + dstData.count;
        if (total <= 64) {
          setSlotData(intent.destination, { ...dstData, count: total });
          setSlotData(
            intent.source,
            remainingAmount > 0 ? { ...srcData, count: remainingAmount } : null
          );
        } else {
          const actualMoved = 64 - dstData.count;
          setSlotData(intent.destination, { ...dstData, count: 64 });
          setSlotData(intent.source, {
            ...srcData,
            count: srcData.count - actualMoved,
          });
        }
      } else {
        if (moveAmount < srcData.count)
          throw new Error('Cannot swap partial stacks');
        // Swap slots
        setSlotData(intent.destination, { ...srcData });
        if (intent.source.type !== 'tableResult') {
          setSlotData(intent.source, { ...dstData });
        }
      }

      if (intent.source.type === 'tableResult') {
         const actualId = senderId;
         const grid = [...(state.authoritativeTableGrids[actualId] || Array(9).fill(null))];
         for (let i = 0; i < grid.length; i++) {
           if (grid[i]) {
             grid[i] = { ...grid[i], count: grid[i].count - 1 };
             if (grid[i].count <= 0) grid[i] = null;
           }
         }
         set((prev) => {
            const nextState = {
              authoritativeTableGrids: {
                ...prev.authoritativeTableGrids,
                [actualId]: grid,
              }
            };
            if (actualId === useConnectionStore.getState().playerId) {
               nextState.tableGrid = grid;
               nextState.tableResult = matchRecipe(grid);
            }
            return nextState;
         });
      }
    } else if (intent.action === 'CONSUME') {
       const srcData = getSlotData(intent.source);
       if (srcData) {
         if (srcData.count > intent.amount) {
           setSlotData(intent.source, { ...srcData, count: srcData.count - intent.amount });
         } else {
           setSlotData(intent.source, null);
         }
       }
     } else if (intent.action === 'DROP') {
      let srcData = getSlotData(intent.source);
      if (intent.source.type === 'tableResult') {
         const actualId = senderId;
         const grid = [...(state.authoritativeTableGrids[actualId] || Array(9).fill(null))];
         const result = matchRecipe(grid);
         if (!result) return;
         srcData = result;
      }
      if (!srcData) throw new Error('Nothing to drop');

      // Drop item entity in world
      let pPos;
      if (senderId === useConnectionStore.getState().playerId) {
        pPos = [playerPosition.x, playerPosition.y, playerPosition.z];
      } else {
        const p = useSyncStore.getState().players[senderId];
        pPos = p ? [p.x, p.y, p.z] : [0, 260, 0];
      }
      const spreadX = pPos[0] + (Math.random() - 0.5) * 2;
      const spreadZ = pPos[2] + (Math.random() - 0.5) * 2;

      useInventoryStore.setState((prev) => ({
        droppedItems: [
          ...(prev.droppedItems || []),
          {
            key: uuidV4(),
            texture: srcData.texture, // Note: might need srcData.id if textures are renamed later
            pos: [spreadX, pPos[1] + 1.2, spreadZ],
            count: intent.amount || srcData.count,
            pickupCooldown: Date.now() + 1000,
          },
        ],
      }));

      if (intent.amount && intent.amount < srcData.count) {
        if (intent.source.type !== 'tableResult') {
           setSlotData(intent.source, {
             ...srcData,
             count: srcData.count - intent.amount,
           });
        }
      } else {
        if (intent.source.type !== 'tableResult') {
           setSlotData(intent.source, null);
        }
      }

      if (intent.source.type === 'tableResult') {
         const actualId = senderId;
         const grid = [...(state.authoritativeTableGrids[actualId] || Array(9).fill(null))];
         for (let i = 0; i < grid.length; i++) {
           if (grid[i]) {
             grid[i] = { ...grid[i], count: grid[i].count - 1 };
             if (grid[i].count <= 0) grid[i] = null;
           }
         }
         set((prev) => {
            const nextState = {
              authoritativeTableGrids: {
                ...prev.authoritativeTableGrids,
                [actualId]: grid,
              }
            };
            if (actualId === useConnectionStore.getState().playerId) {
               nextState.tableGrid = grid;
               nextState.tableResult = matchRecipe(grid);
            }
            return nextState;
         });
      }
    }
  },

  inventory: [
    // Hotbar (Slots 0-8): Essential tools and common blocks
    { texture: 'sword', count: 1 },
    { texture: 'pickaxe', count: 1 },
    { texture: 'gun', count: 1 },
    { texture: 'gauss_rifle', count: 1 },
    { texture: 'grapple', count: 1 },
    { texture: 'lantern', count: 1 },
    { texture: 'flare', count: 64 },
    { texture: 'dirt', count: 64 },
    { texture: 'grass', count: 64 },
    { texture: 'wood', count: 64 },
    { texture: 'stone', count: 64 },
    { texture: 'tnt', count: 64 },
    { texture: 'bedrock', count: 64 },
    { texture: 'crafting_table', count: 64 },
    { texture: 'water', count: 64 },
    { texture: 'lava', count: 64 },
    // Inventory Rows 2 & 3 (Slots 18-35): Empty
    ...new Array(16).fill(null),
  ],

  tableGrid: Array(9).fill(null),
  tableResult: null,

  playerHealth: 100,
  playerMaxHealth: 100,
  playerDamageMult: 1.0,
  playerJumpMult: 1.0,

  playerPower: 100,
  playerMaxPower: 100,
  playerMana: 100,
  playerMaxMana: 100,
  playerData: 0,
  syncRate: 1.0,
  authoritativeSkills: [],

  drainPower: (amount) => set((state) => {
    if (state.gameMode?.toLowerCase() === 'creative') return {};
    return { playerPower: Math.max(0, state.playerPower - amount) };
  }),
  rechargePower: (amount) => set((state) => ({ playerPower: Math.min(state.playerMaxPower, state.playerPower + amount) })),
  
  drainMana: (amount) => set((state) => {
    if (state.gameMode?.toLowerCase() === 'creative') return {};
    return { playerMana: Math.max(0, state.playerMana - amount) };
  }),
  rechargeMana: (amount) => set((state) => ({ playerMana: Math.min(state.playerMaxMana, state.playerMana + amount) })),

  addData: (amount) => set((state) => ({ playerData: state.playerData + amount })),

  unlockSkill: (nodeId) => {
    const state = get();
    if (state.authoritativeSkills.includes(nodeId)) return false;

    // We need to import skillsRegistry inside the function to avoid circular dependency
    // or just fetch it here. For simplicity:
    const skillsRegistry = skillsData.skills;
    const skill = skillsRegistry.find(s => s.id === nodeId);
    if (!skill) return false;

    if (state.playerData >= skill.cost) {
      // Check prerequisites
      if (skill.prerequisites.length > 0) {
        const hasAll = skill.prerequisites.every(req => state.authoritativeSkills.includes(req));
        if (!hasAll) return false;
      }

      set(prev => {
        const nextState = {
          playerData: prev.playerData - skill.cost,
          authoritativeSkills: [...prev.authoritativeSkills, nodeId]
        };
        // Apply modifiers
        if (skill.modifiers) {
          for (const [key, val] of Object.entries(skill.modifiers)) {
            nextState[key] = val; // Assuming these simply overwrite or we can add logic later
          }
        }
        return nextState;
      });

      // Broadcast skill sync
      const ns = useConnectionStore.getState();
      if (ns.connections.length > 0) {
        ns.connections.forEach(conn => {
          try {
            conn.send({ type: 'SKILL_SYNC', playerId: ns.playerId, skillId: nodeId });
          } catch (e) { /* ignore */ }
        });
      }
      return true;
    }
    return false;
  },

  isDead: false,
  isRespawning: false, // true during the 650ms pointer-lock cooldown after clicking respawn
  swordSwungAt: 0,
  playerChunkX: 0,
  playerChunkZ: 0,

  grappleTarget: null,
  setGrappleTarget: (val) => set({ grappleTarget: val }),
  isFlying: false,
  setIsFlying: (val) =>
    set((state) => ({
      isFlying: typeof val === 'function' ? val(state.isFlying) : val,
    })),
  // Projectiles (Visual only)
  visualProjectiles: [],
  spawnVisualProjectile: (data) =>
    set((state) => {
      // data: { id, origin, velocity }
      const p = {
        id: data.id,
        pos: [...data.origin],
        vel: [...data.velocity],
        createdAt: performance.now(),
      };
      return { visualProjectiles: [...state.visualProjectiles, p] };
    }),
  destroyVisualProjectile: (id, impactPoint) =>
    set((state) => {
      if (impactPoint && state.requestAreaDamage) {
        // optionally trigger a small visual explosion here,
        // but damage is handled by host!
      }
      return {
        visualProjectiles: state.visualProjectiles.filter((p) => p.id !== id),
      };
    }),

  lasers: [],
  addLaser: (start, end) => {
    const id = Date.now() + Math.random();
    set((prev) => ({ lasers: [...prev.lasers, { id, start, end }] }));
    setTimeout(() => {
      set((prev) => ({ lasers: prev.lasers.filter((l) => l.id !== id) }));
    }, 150);
  },

  toggleMenu: () => {
    const state = get();
    if (state.isDead) return;
    useUIStore.getState().toggleModal('MENU');
  },

  toggleSkillTree: () => {
    const state = get();
    if (state.isDead) return;
    useUIStore.getState().toggleModal('SKILL_TREE');
  },

  toggleQuestJournal: () => {
    const state = get();
    if (state.isDead) return;
    useUIStore.getState().toggleModal('QUEST_JOURNAL');
  },

  isWorldReady: false,
  loadingProgress: 0,
  isUnderground: false,
  setIsUnderground: (val) => set({ isUnderground: val }),
  hasLoadedState: false,
  submergedLiquid: null,
  setSubmergedLiquid: (val) => set({ submergedLiquid: val }),

  loadPlayerState: async () => {
    try {
      const { loadWorldEntities } = await import('../utils/db');
      const prefix = typeof window !== 'undefined' && window.sessionStorage ? sessionStorage.getItem('saveSlotId') || 'default' : 'default';
      const data = await getIDB(`${prefix}_player_state`);
      const worldData = await loadWorldEntities();
      
      if (worldData) {
        const { chests, machines, droppedItems, tombstones, debris, fallingStructures, ...playerSliceData } = worldData;
        set((prev) => ({ ...prev, ...playerSliceData }));
        
        const iPatch = {};
        if (chests !== undefined) iPatch.chests = chests;
        if (machines !== undefined) iPatch.machines = machines;
        if (droppedItems !== undefined) iPatch.droppedItems = droppedItems;
        if (tombstones !== undefined) iPatch.tombstones = tombstones;
        if (debris !== undefined) iPatch.debris = debris;
        if (fallingStructures !== undefined) iPatch.fallingStructures = fallingStructures;
        
        if (Object.keys(iPatch).length > 0) {
           useInventoryStore.setState(iPatch);
        }
      }
      
      if (data) {
        if (data.playerPos) playerPosition.set(data.playerPos[0], data.playerPos[1], data.playerPos[2]);
        // --- Save Migration Logic ---
        if (!data.version) {
          console.log('Migrating save file to v1');
          data.version = 1;
        }
        
        // Ensure new RPG stats exist if loading an old save
        if (data.playerPower === undefined) data.playerPower = data.playerMaxPower || 100;
        if (data.playerMaxPower === undefined) data.playerMaxPower = 100;
        if (data.playerMana === undefined) data.playerMana = data.playerMaxMana || 100;
        if (data.playerMaxMana === undefined) data.playerMaxMana = 100;
        if (data.playerData === undefined) {
          if (data.playerXP !== undefined) {
            data.playerData = data.playerXP;
            delete data.playerXP;
          } else {
            data.playerData = 0;
          }
        }
        if (data.syncRate === undefined) data.syncRate = 1.0;
        if (data.authoritativeSkills === undefined) data.authoritativeSkills = [];

        const myId = useConnectionStore.getState().playerId;

        const currentState = get();
        const currentAuthInvs = currentState.authoritativeInventories || {};

        if (
          !currentAuthInvs[myId] && data.inventory
        ) {
          set((prev) => ({
            authoritativeInventories: {
               ...prev.authoritativeInventories,
               [myId]: data.inventory
            }
          }));
          console.log('Migrated legacy inventory to authoritative structure');
        }

        // --- NaN Matrix Rescue ---
        if (data.playerPos) {
          const [px, py, pz] = data.playerPos;
          if (
            Number.isNaN(px) ||
            Number.isNaN(py) ||
            Number.isNaN(pz) ||
            py < -100
          ) {
            console.warn(
              '[FAILSAFE] Corrupt NaN or Void coordinates detected in save slot! Rescuing player...'
            );
            data.playerPos = [0, 260, 0];
            data.isDead = false; // Auto-revive
            data.playerHealth = data.playerMaxHealth || 100;
          }
        }

        delete data.authoritativeInventories;
        set((prev) => ({ ...prev, ...data, hasLoadedState: true }));
        return true;
      } else {
        // New game: Ensure we initialize the host's authoritative inventory
        const myId = useConnectionStore.getState().playerId;
        get().initAuthoritativeInventory(myId);
        set({
          inventory:
            get().authoritativeInventories[myId] || Array(36).fill(null),
          hasLoadedState: true,
        });
        return true;
      }
    } catch (e) {
      console.error('Failed to load player state:', e);
    }
    set({ hasLoadedState: true });
    return false;
  },

  savePlayerState: async (currentPos, currentRot) => {
    const state = get();
    const netStore = useConnectionStore.getState();
    const myId = netStore ? netStore.playerId : null;
    const saveInv = (state.authoritativeInventories && myId && state.authoritativeInventories[myId]) 
                    ? state.authoritativeInventories[myId] 
                    : state.inventory;

    const dataToSave = {
      version: state.version || 1,
      inventory: saveInv,
      activeHotbarIndex: state.activeHotbarIndex,
      texture: state.texture,
      coins: state.coins,
      playerHealth: state.playerHealth,
      playerMaxHealth: state.playerMaxHealth,
      playerPower: state.playerPower,
      playerMaxPower: state.playerMaxPower,
      playerMana: state.playerMana,
      playerMaxMana: state.playerMaxMana,
      playerData: state.playerData,
      syncRate: state.syncRate,
      authoritativeSkills: state.authoritativeSkills,
      playerDamageMult: state.playerDamageMult,
      playerJumpMult: state.playerJumpMult,
      playerPos: currentPos || [playerPosition.x, playerPosition.y, playerPosition.z],
      playerRot: currentRot || [playerRotation.x, playerRotation.y, playerRotation.z, playerRotation.w],
      isDead: state.isDead,
      playtime: state.playtime || 0,
    };
    try {
      const netStore =
        useConnectionStore.getState();

      if (
        netStore &&
        useConnectionStore.getState().connectionStatus === 'connected' &&
        !useConnectionStore.getState().isHost
      ) {
        useConnectionStore.getState().connections[0]?.send({
          type: 'GUEST_SAVE',
          state: dataToSave,
        });
        return;
      }
      const prefix = sessionStorage.getItem('saveSlotId') || 'default';
      await setIDB(`${prefix}_player_state`, dataToSave);

      // Save metadata for the Title Screen UI
      localStorage.setItem(
        `saveMetadata_${prefix}`,
        JSON.stringify({
          name: `Sector ${prefix.replace('slot', '')}`,
          mode: 'Survival', // Hardcoded for now until gameMode is global
          played: state.playtime || 0,
          date: new Date().toISOString().split('T')[0],
          seed: getSeed(),
        })
      );

      // DO NOT update playerPos in the React store here!
      // Updating state.playerPos triggers the Player.jsx teleport subscription
      // which causes massive rubberbanding every 15 seconds!
    } catch (e) {
      console.error('Failed to save player state:', e);
    }
  },

  incrementPlaytime: () =>
    set((state) => ({ playtime: (state.playtime || 0) + 1 })),

  setPlayerChunk: (cx, cz) => set({ playerChunkX: cx, playerChunkZ: cz }),
  setWorldReady: () => set({ isWorldReady: true }),
  spawnPhysicsPending: false,
  setSpawnPhysicsPending: (val) => set({ spawnPhysicsPending: val }),
  setLoadingProgress: (p) => set({ loadingProgress: p }),

  addCoins: (amount) => set((prev) => ({ coins: prev.coins + amount })),

  setTexture: (texture) => set(() => ({ texture })),

  setActiveHotbarIndex: (idx) =>
    set((state) => {
      const item = state.inventory[idx];
      return { activeHotbarIndex: idx, texture: item ? item.texture : null };
    }),

  toggleInventory: () => {
    const state = get();
    if (state.isDead) return;
    if (useUIStore.getState().activeModal === 'INVENTORY' && state.heldItem) {
      state.executeLocalTransaction(
        state.heldItem.sourceLoc,
        null,
        'DROP',
        state.heldItem.count
      );
      set({ heldItem: null });
    }
    useUIStore.getState().toggleModal('INVENTORY');
  },
  
  toggleCraftingTable: () => {
    const state = get();
    if (state.isDead) return;
    if (useUIStore.getState().activeModal === 'CRAFTING' && state.heldItem) {
      state.executeLocalTransaction(
        state.heldItem.sourceLoc,
        null,
        'DROP',
        state.heldItem.count
      );
      set({ heldItem: null });
    }
    useUIStore.getState().toggleModal('CRAFTING');
  },

  moveInventoryItem: (fromIdx, toIdx) =>
    set((prev) => {
      const newInv = [...prev.inventory];
      const temp = newInv[fromIdx];
      newInv[fromIdx] = newInv[toIdx];
      newInv[toIdx] = temp;

      // Update active texture if hotbar changed
      let activeTex = prev.texture;
      if (fromIdx === prev.activeHotbarIndex)
        activeTex = newInv[fromIdx] ? newInv[fromIdx].texture : null;
      if (toIdx === prev.activeHotbarIndex)
        activeTex = newInv[toIdx] ? newInv[toIdx].texture : null;

      return { inventory: newInv, texture: activeTex };
    }),

  splitStack: (type, idx) => {
      const state = get();
      let item = type === 'inventory' ? state.inventory[idx] : state.tableGrid[idx];
      if (!item || item.count <= 1) return;

      const half = Math.floor(item.count / 2);
      let emptySlot = -1;
      for (let i = 0; i < 36; i++) {
        if (!state.inventory[i]) {
          emptySlot = i;
          break;
        }
      }
      if (emptySlot === -1) return;

      state.executeLocalTransaction(
          { type: type === 'inventory' ? 'player' : type, id: 'player', slot: idx },
          { type: 'player', id: 'player', slot: emptySlot },
          'MOVE',
          half
      );
  },

  moveItemGeneric: (srcType, srcIdx, destType, destIdx) => {
      const state = get();
      if (srcIdx === destIdx && srcType === destType) return;
      state.executeLocalTransaction(
         { type: srcType === 'inventory' ? 'player' : srcType, id: 'player', slot: srcIdx },
         { type: destType === 'inventory' ? 'player' : destType, id: 'player', slot: destIdx },
         'MOVE'
      );
  },

  addInventoryItem: (texture, count = 1) => {
    let leftover = count;
    set((prev) => {
      const newInv = [...prev.inventory];

      // Group pickup feed spam
      let newFeed = [...prev.pickupFeed];
      const lastItem = newFeed[newFeed.length - 1];
      if (
        lastItem &&
        lastItem.texture === texture &&
        Date.now() - lastItem.time < 2000
      ) {
        newFeed[newFeed.length - 1] = {
          ...lastItem,
          count: lastItem.count + count,
          time: Date.now(),
        };
      } else {
        newFeed.push({
          id: Date.now() + Math.random(),
          texture,
          count,
          time: Date.now(),
        });
      }
      if (newFeed.length > 5) newFeed = newFeed.slice(-5);

      // Fill existing stacks first
      for (let i = 0; i < 36 && leftover > 0; i++) {
        if (newInv[i]?.texture === texture && newInv[i].count < 64) {
          const space = 64 - newInv[i].count;
          const toAdd = Math.min(space, leftover);
          newInv[i] = { ...newInv[i], count: newInv[i].count + toAdd };
          leftover -= toAdd;
        }
      }

      // Fill empty slots
      for (let i = 0; i < 36 && leftover > 0; i++) {
        if (!newInv[i]) {
          const toAdd = Math.min(64, leftover);
          newInv[i] = { texture, count: toAdd };
          leftover -= toAdd;
        }
      }

      let activeTex = prev.texture;
      if (newInv[prev.activeHotbarIndex]) {
        activeTex = newInv[prev.activeHotbarIndex].texture;
      }

      // --- MULTIPLAYER FIX: Add authoritative logic ---
      const netStore = useConnectionStore.getState();
      if (netStore && netStore.isHost) {
        const myId = netStore.playerId;
        const newAuth = {
           ...prev.authoritativeInventories,
           [myId]: newInv
        };
        
        // Host syncs to guests immediately
        if (netStore.connections && netStore.connections.length > 0) {
           setTimeout(() => {
              netStore.connections.forEach(conn => {
                 try { conn.send({ type: 'INVENTORY_SYNC', authoritativeInventories: newAuth }); } catch {}
              });
           }, 0);
        }
        
        return { 
           inventory: newInv, 
           texture: activeTex, 
           pickupFeed: newFeed,
           authoritativeInventories: newAuth 
        };
      } else if (netStore && netStore.connectionStatus === 'connected') {
        // Guest: Send Intent to Host
        if (netStore.connections && netStore.connections[0]) {
           try {
              netStore.connections[0].send({ type: 'GRANT_ITEM_INTENT', texture, count });
           } catch {}
        }
        return { inventory: newInv, texture: activeTex, pickupFeed: newFeed };
      }

      return { inventory: newInv, texture: activeTex, pickupFeed: newFeed };
    });
    return leftover; // Return how many items could not be added
  },

  consumeActiveItem: () => {
      const state = get();
      if (state.gameMode?.toLowerCase() === 'creative') return;

      const idx = state.activeHotbarIndex;
      const item = state.inventory[idx];
      if (!item) return;

      const NON_CONSUMABLE = new Set([
        'sword',
        'pickaxe',
        'gun',
        'gauss_rifle',
        'grapple',
        'lantern',
      ]);
      if (NON_CONSUMABLE.has(item.texture)) return;

      state.executeLocalTransaction(
          { type: 'player', id: 'player', slot: idx },
          null,
          'CONSUME',
          1
      );
  },

  toggleShop: () => {
    const state = get();
    if (state.isDead) return;
    useUIStore.getState().toggleModal('SHOP');
  },

  buyUpgrade: (type, cost, amount) =>
    set((prev) => {
      if (prev.coins >= cost) {
        if (type === 'health')
          return {
            coins: prev.coins - cost,
            playerMaxHealth: prev.playerMaxHealth + amount,
            playerHealth: prev.playerMaxHealth + amount,
          };
        if (type === 'damage')
          return {
            coins: prev.coins - cost,
            playerDamageMult: prev.playerDamageMult + amount,
          };
        if (type === 'jump')
          return {
            coins: prev.coins - cost,
            playerJumpMult: prev.playerJumpMult + amount,
          };
      }
      return {};
    }),

  applyPlayerState: (data) => {
    if (!data) return; // Empty handshake, brand new guest. Spawn defaults.

    // Same migration logic as local saves!
    if (!data.version) {
      data.version = 1;
    }
    if (data.playerPos) {
      const [px, py, pz] = data.playerPos;
      if (Number.isNaN(px) || Number.isNaN(py) || Number.isNaN(pz)) {
        data.playerPos = [0, 260, 0];
      }
      get().executeTeleport(data.playerPos);
    }
    
    if (data.playerRot) {
      playerRotation.set(data.playerRot[0] || 0, data.playerRot[1] || 0, data.playerRot[2] || 0, 'XYZ');
    }

    set((prev) => ({
      ...prev,
      inventory: data.inventory || prev.inventory,
      activeHotbarIndex: data.activeHotbarIndex ?? prev.activeHotbarIndex,
      texture: data.texture || prev.texture,
      coins: data.coins ?? prev.coins,
      playerHealth: data.playerHealth ?? prev.playerHealth,
      playerMaxHealth: data.playerMaxHealth ?? prev.playerMaxHealth,
      isDead: data.isDead ?? prev.isDead,
      hasLoadedState: true,
      lastSpawnTime: Date.now(), // Trigger spawn protection window
    }));
  },

  swingSword: () => set({ swordSwungAt: Date.now() }),
  damagePlayer: (amount) =>
    set((prev) => {
      // Creative mode: invincible
      if (get().gameMode?.toLowerCase() === 'creative') return {};

      // Spawn Protection (5 seconds)
      if (prev.lastSpawnTime && Date.now() - prev.lastSpawnTime < 5000)
        return {};

      // I-Frames (500ms) - Bypassed by instant kill (>= 1000)
      if (
        amount < 1000 &&
        prev.lastDamageTime &&
        Date.now() - prev.lastDamageTime < 500
      )
        return {};

      const netStore = getNetworkStore();
      const isGuest =
        netStore &&
        netStore.getState().connectionStatus === 'connected' &&
        !netStore.getState().isHost;

      if (isGuest) {
        // HOST-AUTHORITATIVE HEALTH: Guests cannot lower their own health!
        // They must ask the Host to damage them.
        netStore.getState().unreliableConnections[0]?.send({
          type: 'TAKE_DAMAGE',
          id: netStore.getState().playerId,
          amount: amount,
          deathPos: [playerPosition.x, playerPosition.y, playerPosition.z], // Supply location just in case they die
          inventory: [...prev.inventory, ...prev.tableGrid].filter(Boolean),
        });
        return {}; // Do not update local health
      }

      // Local Host/Singleplayer Damage Execution
      const newHealth = Math.max(0, prev.playerHealth - amount);
      if (newHealth === 0 && prev.playerHealth > 0) {
        let px = playerPosition.x;
        let py = playerPosition.y;
        let pz = playerPosition.z;

        // Void Death Rescue (Breadcrumb system)
        if (py < -10) {
          px = playerLastSafePosition.x;
          py = playerLastSafePosition.y;
          pz = playerLastSafePosition.z;
        }

        // Spawn slightly above ground to prevent mesh clipping
        let spawnY = py;
        if (typeof get().findSafeFlatSpawn === 'function') {
          const safeSpot = get().findSafeFlatSpawn(px, pz);
          if (safeSpot && safeSpot.y > 0) {
            spawnY = safeSpot.y - 0.5; // Centers the 1.0 height tombstone on top of the block
          }
        }

        // TOMBSTONE LOOT DROP
        const fullInventory = [...prev.inventory, ...prev.tableGrid].filter(
          Boolean
        );
        if (fullInventory.length > 0) {
          get().addTombstone({
            id: `tombstone_host_${Date.now()}`,
            pos: [px, spawnY, pz],
            inventory: fullInventory,
            ownerName: netStore ? netStore.getState().playerName : 'Player',
          });

          if (netStore) {
            netStore
              .getState()
              .addWaypoint(px, py + 1, pz, '#ff0000', 'death_waypoint');
          }
        }

        return {
          playerHealth: 0,
          isDead: true,
          inventory: Array(36).fill(null),
          tableGrid: Array(9).fill(null),
        };
      }
      EventBus.emit('audio', { sound: 'damage', source: 'local' });
      return { playerHealth: newHealth, lastDamageTime: Date.now() };
    }),

  respawnPlayer: async () => {
    if (get().gameMode?.toLowerCase() === 'hardcore') return;

    // Phase 3: Safe Respawn Logic
    const state = get();
    let spawnY = 260; // Default fallback
    const spawnX = 0;
    const spawnZ = 0;

    // ── Pointer Lock Cooldown Guard ──────────────────────────────────────────
    // Chrome enforces a ~300–500ms mandatory lockout after exitPointerLock().
    // DeathScreen calls exitPointerLock() the moment the player dies.
    // If we set isDead=false immediately on click, PointerLockControls remounts
    // and calls requestPointerLock() before the cooldown expires — the browser
    // silently rejects it and the respawn button appears unresponsive.
    //
    // Fix: signal "respawning" state so the UI can show feedback, then delay
    // the actual isDead=false until the pointer lock cooldown has safely elapsed.
    set({ isRespawning: true });

    // 1. Wait for chunk 0,0 to be ready if it's not (Failsafe Timeout 5 seconds)
    const chunkKey = '0,0';
    const chunkStoreState = useChunkStore.getState();
    let chunk = chunkStoreState.chunks[chunkKey];
    if (!chunk || !chunk.buffer) {
      // Simulate waiting or loading screen
      let attempts = 0;
      while ((!chunk || !chunk.buffer) && attempts < 50) {
        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms * 50 = 5s
        chunk = useChunkStore.getState().chunks[chunkKey];
        attempts++;
      }
    }

    // Use the existing findSafeFlatSpawn function in the store
    if (typeof state.findSafeFlatSpawn === 'function') {
      const safeSpot = state.findSafeFlatSpawn(spawnX, spawnZ);
      if (safeSpot && safeSpot.y > 0) {
        // Found a block
        spawnY = safeSpot.y + 2;

        // Edge Case 4: Suffocation Spawns (Force Clear above spawn)
        // Ensure y and y+1 are clear
        if (state.setVoxelRaw) {
          state.setVoxelRaw(spawnX, spawnY, spawnZ, 0); // 0 = Air
          state.setVoxelRaw(spawnX, spawnY + 1, spawnZ, 0); // 0 = Air
        }
      } else {
        // Edge Case 1 Failsafe: Glass Platform at Y=250 (max Y chunk bound is 255)
        spawnY = 252;
        if (state.setVoxelRaw) {
          for (let x = -1; x <= 1; x++) {
            for (let z = -1; z <= 1; z++) {
              state.setVoxelRaw(x, 250, z, 3); // 3 = Glass
            }
          }
        }
      }
    }

    // ── Delayed Commit (Pointer Lock Cooldown) ────────────────────────────────
    // Wait 650ms before clearing isDead so PointerLockControls doesn't try to
    // call requestPointerLock() inside Chrome's mandatory post-exitPointerLock
    // cooldown window (~300–500ms). The death screen stays visible during this
    // brief pause (isDead is still true), so the user sees normal UI — not a
    // frozen button.
    await new Promise(resolve => setTimeout(resolve, 650));

    // Edge Case 5: Network "Zombie" Desync (Purge queues)
    playerPosition.set(spawnX, spawnY, spawnZ);
    set({
      playerHealth: get().playerMaxHealth,
      playerPower: get().playerMaxPower,
      playerMana: get().playerMaxMana,
      isDead: false,
      isRespawning: false,
      
      lastSpawnTime: Date.now(),
      grappleTarget: null,
      damageQueue: [],
      directDamageQueue: [],
    });
  },

  healPlayer: (amount) =>
    set((prev) => {
      if (prev.isDead) return {};
      return {
        playerHealth: Math.min(
          prev.playerMaxHealth,
          prev.playerHealth + amount
        ),
      };
    }),

  setTableResult: (result) => set({ tableResult: result }),

  ejectTableGrid: () => {
    const state = get();
    for (let i = 0; i < 9; i++) {
      if (state.tableGrid[i]) {
        state.executeLocalTransaction(
          { type: 'table', id: 'table', slot: i },
          null,
          'DROP',
          state.tableGrid[i].count
        );
      }
    }
  },

  dropItemFromSlot: (type, idx, dropAll = false) => {
    const state = get();
    if (state.isDead) return;

    let item;
    if (type === 'table') item = state.tableGrid[idx];
    else item = state.inventory[idx];

    if (!item) return;

    const amountToDrop = dropAll ? item.count : 1;
    state.executeLocalTransaction(
      { type: type === 'table' ? 'table' : 'player', id: type === 'table' ? 'table' : 'player', slot: idx },
      null,
      'DROP',
      amountToDrop
    );
  },

  craftItem: (matchRecipeOutput) =>
    set((prev) => {
      if (!matchRecipeOutput) return {};

      let newInv = [...prev.inventory];
      let leftover = matchRecipeOutput.count;
      const texture = matchRecipeOutput.texture;

      // Check space in existing stacks
      for (let j = 0; j < 36 && leftover > 0; j++) {
        if (newInv[j]?.texture === texture && newInv[j].count < 64) {
          const space = 64 - newInv[j].count;
          const toAdd = Math.min(space, leftover);
          newInv[j] = { ...newInv[j], count: newInv[j].count + toAdd };
          leftover -= toAdd;
        }
      }

      // Check empty slots
      for (let j = 0; j < 36 && leftover > 0; j++) {
        if (!newInv[j]) {
          const toAdd = Math.min(64, leftover);
          newInv[j] = { texture, count: toAdd };
          leftover -= toAdd;
        }
      }

      // If we couldn't fit the entire crafted result, prevent crafting entirely!
      if (leftover > 0) return {};

      // Space found and item added, now consume grid items
      const newGrid = [...prev.tableGrid];
      for (let i = 0; i < newGrid.length; i++) {
        if (newGrid[i]) {
          newGrid[i] = { ...newGrid[i], count: newGrid[i].count - 1 };
          if (newGrid[i].count <= 0) newGrid[i] = null;
        }
      }

      // Achievement trigger
      setTimeout(
        () =>
          get().unlockAchievement(
            'crafter',
            'Crafter',
            'Craft your first item',
            '🔨'
          ),
        0
      );

      return { tableGrid: newGrid, inventory: newInv };
    }),
});
