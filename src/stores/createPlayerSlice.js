import { getNetworkStore } from './storeLinker';
import { get as getIDB, set as setIDB } from 'idb-keyval';
import { playerPosition, playerRotation } from '../globals';
import { v4 as uuidV4 } from 'uuid';
import { getSeed } from '../worldSeed';
import { sfxManager } from '../utils/SFXManager';

export const createPlayerSlice = (set, get) => ({
  version: 1,
  texture: 'sword',
  activeHotbarIndex: 0,
  coins: 0,
  isMenuOpen: false,
  isInventoryOpen: false,
  activeChestId: null,
  openChest: (x, y, z) => set(state => {
      if (state.isDead) return {};
      if (document.pointerLockElement) document.exitPointerLock();
      return { activeChestId: `${x},${y},${z}`, isInventoryOpen: false, isCraftingTableOpen: false };
  }),
  closeChest: () => set(state => {
      if (state.activeChestId && state.heldItem) {
          state.executeLocalTransaction(state.heldItem.sourceLoc, null, 'DROP', state.heldItem.count);
          return { activeChestId: null, heldItem: null };
      }
      return { activeChestId: null };
  }),

  pickupFeed: [],
  removePickupFeedItem: (id) => set((prev) => ({ pickupFeed: prev.pickupFeed.filter(item => item.id !== id) })),
  // --- Phase 6: Authoritative Inventory Transactions ---
  // Only executed by the Host
  authoritativeInventories: {}, // { [playerId]: [ ...slots ] }
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
                  const moveAmount = amount ? Math.min(amount, srcData.count) : srcData.count;
                  const remainingAmount = srcData.count - moveAmount;
                  
                  if (!dstData) {
                     setSlotData(destination, { ...srcData, count: moveAmount });
                     setSlotData(source, remainingAmount > 0 ? { ...srcData, count: remainingAmount } : null);
                  } else if (dstData.texture === srcData.texture && !srcData.uuid && !dstData.uuid) {
                     const total = moveAmount + dstData.count;
                     if (total <= 64) {
                        setSlotData(destination, { ...dstData, count: total });
                        setSlotData(source, remainingAmount > 0 ? { ...srcData, count: remainingAmount } : null);
                     } else {
                        const actualMoved = 64 - dstData.count;
                        setSlotData(destination, { ...dstData, count: 64 });
                        setSlotData(source, { ...srcData, count: srcData.count - actualMoved });
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

  
  initAuthoritativeInventory: (playerId) => set(prev => {
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
          if (!intent.source || !intent.destination) return; // Ignore missing destinations
          if (intent.source.id === intent.destination.id && intent.source.slot === intent.destination.slot && intent.source.type === intent.destination.type) return; // Same slot

          const srcData = getSlotData(intent.source);
          const dstData = getSlotData(intent.destination);
          
          if (!srcData) throw new Error("Source slot empty");
          
          const moveAmount = intent.amount ? Math.min(intent.amount, srcData.count) : srcData.count;
          const remainingAmount = srcData.count - moveAmount;
          
          if (!dstData) {
             // Simple move
             setSlotData(intent.destination, { ...srcData, count: moveAmount });
             setSlotData(intent.source, remainingAmount > 0 ? { ...srcData, count: remainingAmount } : null);
          } else if (dstData.texture === srcData.texture && !srcData.uuid && !dstData.uuid) {
             // Merge stacks (Max 64)
             const total = moveAmount + dstData.count;
             if (total <= 64) {
                setSlotData(intent.destination, { ...dstData, count: total });
                setSlotData(intent.source, remainingAmount > 0 ? { ...srcData, count: remainingAmount } : null);
             } else {
                const actualMoved = 64 - dstData.count;
                setSlotData(intent.destination, { ...dstData, count: 64 });
                setSlotData(intent.source, { ...srcData, count: srcData.count - actualMoved });
             }
          } else {
             if (moveAmount < srcData.count) throw new Error("Cannot swap partial stacks");
             // Swap slots
             setSlotData(intent.destination, { ...srcData });
             setSlotData(intent.source, { ...dstData });
          }
      }
      else if (intent.action === 'DROP') {
          const srcData = getSlotData(intent.source);
          if (!srcData) throw new Error("Nothing to drop");
          
          // Drop item entity in world
          let pPos;
          if (senderId === state.playerId) {
              pPos = [playerPosition.x, playerPosition.y, playerPosition.z];
          } else {
              pPos = state.players[senderId]?.pos || [0, 260, 0];
          }
          const spreadX = pPos[0] + (Math.random() - 0.5) * 2;
          const spreadZ = pPos[2] + (Math.random() - 0.5) * 2;
          
          set(prev => ({
             droppedItems: [...(prev.droppedItems || []), {
                id: `drop_${Date.now()}_${Math.random()}`,
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
    ...new Array(16).fill(null)
  ],
  
  isCraftingTableOpen: false,
  tableGrid: Array(9).fill(null),
  tableResult: null,
  
  playerHealth: 100,
  playerMaxHealth: 100,
  playerDamageMult: 1.0,
  playerJumpMult: 1.0,
  isShopOpen: false,
  isDead: false,
  swordSwungAt: 0,
  playerChunkX: 0,
  playerChunkZ: 0,
  
  grappleTarget: null,
  setGrappleTarget: (val) => set({ grappleTarget: val }),
  // Projectiles (Visual only)
  visualProjectiles: [],
  spawnVisualProjectile: (data) => set((state) => {
    // data: { id, origin, velocity }
    const p = { 
        id: data.id, 
        pos: [...data.origin], 
        vel: [...data.velocity], 
        createdAt: performance.now() 
    };
    return { visualProjectiles: [...state.visualProjectiles, p] };
  }),
  destroyVisualProjectile: (id, impactPoint) => set((state) => {
    if (impactPoint && state.requestAreaDamage) {
        // optionally trigger a small visual explosion here, 
        // but damage is handled by host!
    }
    return { visualProjectiles: state.visualProjectiles.filter(p => p.id !== id) };
  }),

  lasers: [],
  addLaser: (start, end) => {
    const id = Date.now() + Math.random();
    set(prev => ({ lasers: [...prev.lasers, { id, start, end }] }));
    setTimeout(() => {
      set(prev => ({ lasers: prev.lasers.filter(l => l.id !== id) }));
    }, 150);
  },

  toggleMenu: () => set(state => {
    if (state.isDead) return {};
    return { isMenuOpen: !state.isMenuOpen };
  }),

  isWorldReady: false,
  loadingProgress: 0,
  playerPos: [0, 260, 0],
  playerRot: [0, 0, 0, 1],
  isUnderground: false,
  setIsUnderground: (val) => set({ isUnderground: val }),
  hasLoadedState: false,
  submergedLiquid: null,
  setSubmergedLiquid: (val) => set({ submergedLiquid: val }),

  loadPlayerState: async () => {
    try {
      const prefix = sessionStorage.getItem('saveSlotId') || 'default';
      const data = await getIDB(`${prefix}_player_state`);
      if (data) {
        // --- Save Migration Logic ---
        if (!data.version) {
          console.log("Migrating save file to v1");
          data.version = 1;
          // Space reserved for future RPG stats (mana, stamina, statistics, etc)
        }
        
        // --- NaN Matrix Rescue ---
        if (data.playerPos) {
           const [px, py, pz] = data.playerPos;
           if (Number.isNaN(px) || Number.isNaN(py) || Number.isNaN(pz) || py < 100) {
              console.warn("[FAILSAFE] Corrupt NaN or Void coordinates detected in save slot! Rescuing player...");
              data.playerPos = [0, 260, 0];
              data.isDead = false; // Auto-revive
              data.playerHealth = data.playerMaxHealth || 100;
           }
        }
        
        set((prev) => ({ ...prev, ...data, hasLoadedState: true }));
        return true;
      }
    } catch (e) {
      console.error("Failed to load player state:", e);
    }
    set({ hasLoadedState: true });
    return false;
  },

  savePlayerState: async (currentPos, currentRot) => {
    const state = get();
    const dataToSave = {
      version: state.version || 1,
      inventory: state.inventory,
      activeHotbarIndex: state.activeHotbarIndex,
      texture: state.texture,
      coins: state.coins,
      playerHealth: state.playerHealth,
      playerMaxHealth: state.playerMaxHealth,
      playerDamageMult: state.playerDamageMult,
      playerJumpMult: state.playerJumpMult,
      playerPos: currentPos || state.playerPos,
      playerRot: currentRot || state.playerRot,
      isDead: state.isDead,
      playtime: state.playtime || 0
    };
    try {
      const prefix = sessionStorage.getItem('saveSlotId') || 'default';
      await setIDB(`${prefix}_player_state`, dataToSave);

      // Save metadata for the Title Screen UI
      localStorage.setItem(`saveMetadata_${prefix}`, JSON.stringify({
         name: `Sector ${prefix.replace('slot', '')}`,
         mode: "Survival", // Hardcoded for now until gameMode is global
         played: state.playtime || 0, 
         date: new Date().toISOString().split('T')[0],
         seed: getSeed()
      }));

      // DO NOT update playerPos in the React store here!
      // Updating state.playerPos triggers the Player.jsx teleport subscription
      // which causes massive rubberbanding every 15 seconds!
    } catch (e) {
      console.error("Failed to save player state:", e);
    }
  },

  incrementPlaytime: () => set((state) => ({ playtime: (state.playtime || 0) + 1 })),


  setPlayerChunk: (cx, cz) => set({ playerChunkX: cx, playerChunkZ: cz }),
  setWorldReady: () => set({ isWorldReady: true }),
  setLoadingProgress: (p) => set({ loadingProgress: p }),
  
  addCoins: (amount) => set((prev) => ({ coins: prev.coins + amount })),
  
  setTexture: (texture) => set(() => ({ texture })),
  
  setActiveHotbarIndex: (idx) => set((state) => {
    const item = state.inventory[idx];
    return { activeHotbarIndex: idx, texture: item ? item.texture : null };
  }),

  toggleInventory: () => set(state => {
    if (state.isDead) return {};
    if (state.isInventoryOpen && state.heldItem) {
        state.executeLocalTransaction(state.heldItem.sourceLoc, null, 'DROP', state.heldItem.count);
        return { isInventoryOpen: false, heldItem: null };
    }
    return { isInventoryOpen: !state.isInventoryOpen };
  }),
  toggleCraftingTable: () => set(state => {
    if (state.isDead) return {};
    if (state.isCraftingTableOpen && state.heldItem) {
        state.executeLocalTransaction(state.heldItem.sourceLoc, null, 'DROP', state.heldItem.count);
        return { isCraftingTableOpen: false, heldItem: null };
    }
    return { isCraftingTableOpen: !state.isCraftingTableOpen };
  }),
  
  moveInventoryItem: (fromIdx, toIdx) => set((prev) => {
    const newInv = [...prev.inventory];
    const temp = newInv[fromIdx];
    newInv[fromIdx] = newInv[toIdx];
    newInv[toIdx] = temp;
    
    // Update active texture if hotbar changed
    let activeTex = prev.texture;
    if (fromIdx === prev.activeHotbarIndex) activeTex = newInv[fromIdx] ? newInv[fromIdx].texture : null;
    if (toIdx === prev.activeHotbarIndex) activeTex = newInv[toIdx] ? newInv[toIdx].texture : null;
    
    return { inventory: newInv, texture: activeTex };
  }),

  splitStack: (type, idx) => set((prev) => {
    let newInv = [...prev.inventory];
    let newTable = [...prev.tableGrid];
    
    let item = type === 'inventory' ? newInv[idx] : newTable[idx];
    if (!item || item.count <= 1) return {}; // Can't split

    const half = Math.floor(item.count / 2);
    const remainder = item.count - half;

    // Halve the original item
    if (type === 'inventory') newInv[idx] = { ...item, count: remainder };
    else newTable[idx] = { ...item, count: remainder };

    // Find first empty slot in main inventory to dump the other half
    let dumped = false;
    for (let i = 0; i < 36; i++) {
      if (!newInv[i]) {
        newInv[i] = { ...item, count: half };
        dumped = true;
        break;
      }
    }

    // If inventory is completely full, we can't split (or we would have to drop it on the floor)
    if (!dumped) return {}; // Cancel split if no room
    
    return { inventory: newInv, tableGrid: newTable };
  }),

  moveItemGeneric: (srcType, srcIdx, destType, destIdx) => set((prev) => {
      if (srcIdx === destIdx && srcType === destType) return {};
      let newInv = [...prev.inventory];
      let newTable = [...prev.tableGrid];
    
    let getSrc = () => {
      if (srcType === 'inventory') return newInv[srcIdx];
      if (srcType === 'table') return newTable[srcIdx];
    };
    
    let getDest = () => {
      if (destType === 'inventory') return newInv[destIdx];
      if (destType === 'table') return newTable[destIdx];
    };

    let srcItem = getSrc();
    let destItem = getDest();
    
    // Check if we can stack
      if (srcItem && destItem && srcItem.texture === destItem.texture) {
        const mergedCount = srcItem.count + destItem.count;
        if (mergedCount <= 64) {
          if (destType === 'inventory') newInv[destIdx] = { ...destItem, count: mergedCount };
          else if (destType === 'table') newTable[destIdx] = { ...destItem, count: mergedCount };
          
          if (srcType === 'inventory') newInv[srcIdx] = null;
          else if (srcType === 'table') newTable[srcIdx] = null;
        } else {
          if (destType === 'inventory') newInv[destIdx] = { ...destItem, count: 64 };
          else if (destType === 'table') newTable[destIdx] = { ...destItem, count: 64 };
          
          if (srcType === 'inventory') newInv[srcIdx] = { ...srcItem, count: mergedCount - 64 };
          else if (srcType === 'table') newTable[srcIdx] = { ...srcItem, count: mergedCount - 64 };
        }
      } else {
      // Swap
      if (srcType === 'inventory') newInv[srcIdx] = destItem;
      else if (srcType === 'table') newTable[srcIdx] = destItem;
      
      if (destType === 'inventory') newInv[destIdx] = srcItem;
      else if (destType === 'table') newTable[destIdx] = srcItem;
    }
    
    // Update active texture if hotbar changed
    let activeTex = prev.texture;
    if (srcType === 'inventory' && srcIdx === prev.activeHotbarIndex) activeTex = newInv[srcIdx] ? newInv[srcIdx].texture : null;
    if (destType === 'inventory' && destIdx === prev.activeHotbarIndex) activeTex = newInv[destIdx] ? newInv[destIdx].texture : null;
    
    return { inventory: newInv, tableGrid: newTable, texture: activeTex };
  }),

  addInventoryItem: (texture, count = 1) => {
    let leftover = count;
    set((prev) => {
      const newInv = [...prev.inventory];
      
      // Group pickup feed spam
      let newFeed = [...prev.pickupFeed];
      const lastItem = newFeed[newFeed.length - 1];
      if (lastItem && lastItem.texture === texture && Date.now() - lastItem.time < 2000) {
        newFeed[newFeed.length - 1] = { ...lastItem, count: lastItem.count + count, time: Date.now() };
      } else {
        newFeed.push({ id: Date.now() + Math.random(), texture, count, time: Date.now() });
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
      
      return { inventory: newInv, texture: activeTex, pickupFeed: newFeed };
    });
    return leftover; // Return how many items could not be added
  },

  consumeActiveItem: () => set((prev) => {
    // Creative mode: unlimited blocks
    if (get().gameMode?.toLowerCase() === 'creative') return {};

    const idx = prev.activeHotbarIndex;
    const item = prev.inventory[idx];
    if (!item) return {}; // shouldn't happen if texture isn't null, but safe
    
    // Tools are non-consumable (they stay in the slot forever)
    const NON_CONSUMABLE = new Set(['sword', 'pickaxe', 'gun', 'gauss_rifle', 'grapple', 'lantern']);
    if (NON_CONSUMABLE.has(item.texture)) return {};

    const newInv = [...prev.inventory];
    if (item.count > 1) {
      newInv[idx] = { ...item, count: item.count - 1 };
      return { inventory: newInv };
    } else {
      newInv[idx] = null;
      return { inventory: newInv, texture: null };
    }
  }),

  toggleShop: () => set(state => {
    if (state.isDead) return {};
    return { isShopOpen: !state.isShopOpen };
  }),
  
  buyUpgrade: (type, cost, amount) => set((prev) => {
    if (prev.coins >= cost) {
      if (type === 'health') return { coins: prev.coins - cost, playerMaxHealth: prev.playerMaxHealth + amount, playerHealth: prev.playerMaxHealth + amount };
      if (type === 'damage') return { coins: prev.coins - cost, playerDamageMult: prev.playerDamageMult + amount };
      if (type === 'jump') return { coins: prev.coins - cost, playerJumpMult: prev.playerJumpMult + amount };
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
     }
     
     set(prev => ({
        ...prev,
        inventory: data.inventory || prev.inventory,
        activeHotbarIndex: data.activeHotbarIndex ?? prev.activeHotbarIndex,
        texture: data.texture || prev.texture,
        coins: data.coins ?? prev.coins,
        playerHealth: data.playerHealth ?? prev.playerHealth,
        playerMaxHealth: data.playerMaxHealth ?? prev.playerMaxHealth,
        playerPos: data.playerPos || prev.playerPos,
        playerRot: data.playerRot || prev.playerRot,
        isDead: data.isDead ?? prev.isDead,
        hasLoadedState: true,
        lastSpawnTime: Date.now() // Trigger spawn protection window
     }));
  },
  
  swingSword: () => set({ swordSwungAt: Date.now() }),
  damagePlayer: (amount) => set((prev) => {
      // Creative mode: invincible
      if (get().gameMode?.toLowerCase() === 'creative') return {};
  
      // Spawn Protection (5 seconds)
      if (prev.lastSpawnTime && Date.now() - prev.lastSpawnTime < 5000) return {};
      
      const netStore = typeof window !== 'undefined' && window.__NETWORK_STORE__;
      const isGuest = netStore && netStore.getState().connectionStatus === 'connected' && !netStore.getState().isHost;
      
      if (isGuest) {
         // HOST-AUTHORITATIVE HEALTH: Guests cannot lower their own health!
         // They must ask the Host to damage them.
         netStore.getState().unreliableConnections[0]?.send({
             type: 'TAKE_DAMAGE',
             id: netStore.getState().playerId,
             amount: amount,
             deathPos: get().playerPos, // Supply location just in case they die
             inventory: [...prev.inventory, ...prev.tableGrid].filter(Boolean)
         });
         return {}; // Do not update local health
      }
  
      // Local Host/Singleplayer Damage Execution
      const newHealth = Math.max(0, prev.playerHealth - amount);
      if (newHealth === 0 && prev.playerHealth > 0) {
        const px = get().playerPos[0];
        const py = get().playerPos[1];
        const pz = get().playerPos[2];
        
        // TOMBSTONE LOOT DROP
        const fullInventory = [...prev.inventory, ...prev.tableGrid].filter(Boolean);
        if (fullInventory.length > 0) {
           get().addTombstone({
              id: `tombstone_host_${Date.now()}`,
              pos: [px, py, pz],
              inventory: fullInventory,
              ownerName: netStore ? netStore.getState().playerName : 'Player'
           });
        }
        
        return { 
          playerHealth: 0, 
          isDead: true,
          inventory: Array(36).fill(null),
          tableGrid: Array(9).fill(null)
        };
      }
      sfxManager.play('damage');
      return { playerHealth: newHealth };
    }),
  
  respawnPlayer: async () => {
    if (get().gameMode?.toLowerCase() === 'hardcore') return;
    playerPosition.set(0, 260, 0);
    set({ playerHealth: get().playerMaxHealth, isDead: false, playerPos: [0, 260, 0], lastSpawnTime: Date.now() });
  },
  
  healPlayer: (amount) => set((prev) => {
    if (prev.isDead) return {};
    return { playerHealth: Math.min(prev.playerMaxHealth, prev.playerHealth + amount) };
  }),

  setTableResult: (result) => set({ tableResult: result }),
  
  ejectTableGrid: () => set((prev) => {
    let newInv = [...prev.inventory];
    const newGrid = [...prev.tableGrid];
    const toDrop = [];

    for (let i = 0; i < 9; i++) {
      if (newGrid[i]) {
        let leftover = newGrid[i].count;
        const texture = newGrid[i].texture;
        
        // Fill existing stacks
        for (let j = 0; j < 36 && leftover > 0; j++) {
          if (newInv[j]?.texture === texture && newInv[j].count < 64) {
            const space = 64 - newInv[j].count;
            const toAdd = Math.min(space, leftover);
            newInv[j] = { ...newInv[j], count: newInv[j].count + toAdd };
            leftover -= toAdd;
          }
        }
        
        // Fill empty slots
        for (let j = 0; j < 36 && leftover > 0; j++) {
          if (!newInv[j]) {
            const toAdd = Math.min(64, leftover);
            newInv[j] = { texture, count: toAdd };
            leftover -= toAdd;
          }
        }
        
        // Drop remainder
        if (leftover > 0) {
          toDrop.push({ texture, count: leftover });
        }
      }
    }
    
    // Directly push to droppedItems to prevent Rapier memory crash
    const newDropped = [...(get().droppedItems || [])];
    toDrop.forEach(item => {
      newDropped.push({
        key: uuidV4(),
        pos: [playerPosition.x, playerPosition.y + 1, playerPosition.z],
        texture: item.texture,
        count: item.count
      });
    });

    return { inventory: newInv, tableGrid: Array(9).fill(null), droppedItems: newDropped };
  }),

  dropItemFromSlot: (type, idx, dropAll = false) => set((prev) => {
    if (prev.isDead) return {};
    let newInv = [...prev.inventory];
    let newTable = [...prev.tableGrid];
    
    let item = type === 'inventory' ? newInv[idx] : newTable[idx];
    if (!item) return {};

    const amountToDrop = dropAll ? item.count : 1;
    
    if (item.count <= amountToDrop) {
      if (type === 'inventory') newInv[idx] = null;
      else newTable[idx] = null;
    } else {
      if (type === 'inventory') newInv[idx] = { ...item, count: item.count - amountToDrop };
      else newTable[idx] = { ...item, count: item.count - amountToDrop };
    }

      // Spawn physics item in world
      const xOffset = -Math.sin(playerRotation.y) * 1.5;
      const zOffset = -Math.cos(playerRotation.y) * 1.5;
      const spawnPos = [
        playerPosition.x + xOffset,
        playerPosition.y + 1.2, 
        playerPosition.z + zOffset
      ];
      
      const newDropped = [...(get().droppedItems || [])];
      newDropped.push({
        key: uuidV4(),
        pos: spawnPos,
        texture: item.texture,
        count: amountToDrop
      });
      
      let activeTex = prev.texture;
      if (type === 'inventory' && idx === prev.activeHotbarIndex) {
        activeTex = newInv[idx] ? newInv[idx].texture : null;
      }
      
      return { inventory: newInv, tableGrid: newTable, texture: activeTex, droppedItems: newDropped };
    }),

  craftItem: (matchRecipeOutput) => set((prev) => {
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
    setTimeout(() => get().unlockAchievement('crafter', 'Crafter', 'Craft your first item', '🔨'), 0);
    
    return { tableGrid: newGrid, inventory: newInv };
  }),

});
