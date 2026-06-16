import * as THREE from 'three';
import { ShipStructure } from '../utils/structures';
import { BlockIds } from '../registry/BlockRegistry';
import { shipTransforms } from '../globals';

export const SHIP_SIZE_X = 32;
export const SHIP_SIZE_Y = 32;
export const SHIP_SIZE_Z = 32;

export const SHIP_CENTER_X = Math.floor(SHIP_SIZE_X / 2);
export const SHIP_CENTER_Y = Math.floor(SHIP_SIZE_Y / 2);
export const SHIP_CENTER_Z = Math.floor(SHIP_SIZE_Z / 2);
const SHIP_BASE_Y = Math.floor(SHIP_SIZE_Y / 2) - 2;

// 32x32x32 ship = 8 sub-chunks of 16x16x16
export const SHIP_VOLUME = SHIP_SIZE_X * SHIP_SIZE_Y * SHIP_SIZE_Z;

export const getShipIndex = (x, y, z) => {
  return y * (SHIP_SIZE_X * SHIP_SIZE_Z) + z * SHIP_SIZE_X + x;
};

export const createShipSlice = (set, get) => ({
  shipBuffer: new Uint32Array(SHIP_VOLUME),
  shipVisualOffset: [0, 50, 0], // The offset of the visual Ghost Ship
  isShipActive: false, // Tracks if a ship exists in the world
  shipTransform: null, // Legacy hook for Canary CI Test
  
  // Piloting State
  shipHelmPlayerId: null,
  setShipHelmPlayerId: (id) => set({ shipHelmPlayerId: id }),
  seatOffset: null,
  setSeatOffset: (offset) => set({ seatOffset: offset }),

  // Health Tracking
  shipHealth: 100,
  shipMaxHealth: 100,
  lastDamageTime: 0,
  
  damageShip: (amount) => set((state) => {
      const now = Date.now();
      if (now - state.lastDamageTime < 1000) return state; // 1-second debounce
      
      const newHealth = Math.max(0, state.shipHealth - amount);
      let newState = { shipHealth: newHealth, lastDamageTime: now };
      
      if (newHealth <= 0 && state.shipCorePower > 0) {
         newState.shipCorePower = 0; // Trigger Limp Mode
         import('./networkActions').then(({ networkActions }) => {
             networkActions.getState().addChatMessage('> CRITICAL ALERT: SHIP HULL BREACHED. ENGINES OFFLINE.', 'system', 'System');
             networkActions.getState().broadcastEvent({ type: 'CHAT_MESSAGE', message: '> CRITICAL ALERT: SHIP HULL BREACHED. ENGINES OFFLINE.', author: 'System' });
         });
      }
  
      import('./networkActions').then(({ networkActions }) => {
         const net = networkActions.getState();
         if (net.isHost) {
             net.broadcastEvent({ type: 'SHIP_HEALTH_UPDATE', health: newHealth });
         } else {
             net.connections[0]?.send({ type: 'SHIP_DAMAGE_INTENT', amount });
         }
      });
      
      return newState;
    }),
    healShip: (amount) => set((state) => {
      const newHealth = Math.min(state.shipMaxHealth, state.shipHealth + amount);
      import('./networkActions').then(({ networkActions }) => {
         const net = networkActions.getState();
         if (net.isHost) {
             net.broadcastEvent({ type: 'SHIP_HEALTH_UPDATE', health: newHealth });
         } else {
             net.connections[0]?.send({ type: 'SHIP_HEAL_INTENT', amount });
         }
      });
      return { shipHealth: newHealth };
    }),

  // Hardware Tracking
  shipHardwareCounts: { engine: 0, capacitor: 0 },
  
  // Ship Battery Core
  shipCorePower: 10000,
  shipMaxPower: 10000,
  
  // Warp Drive Internal Storage
  shipVoidCanisters: 0,
  setShipVoidCanisters: (val) => set({ shipVoidCanisters: val }),
  
  // Void Defense Minigame
  activeFires: [],
  spawnFire: (id, pos) => set((state) => ({ 
      activeFires: [...state.activeFires, { id, pos }] 
  })),
  extinguishFire: (id) => set((state) => ({ 
      activeFires: state.activeFires.filter(f => f.id !== id) 
  })),
  clearFires: () => set({ activeFires: [] }),
  
  // Lunar Anchor
  isTransitMode: false,
  toggleTransitMode: () => set((state) => ({ isTransitMode: !state.isTransitMode })),
  
  isLongWarping: false,
  setLongWarping: (val) => set({ isLongWarping: val }),

  // Ship Transform Data (Decoupled UI from 60fps Physics)
  shipRegion: { x: 0, z: 0 },
  setShipRegion: (x, z) => set({ shipRegion: { x, z } }),
  setShipTransform: (shipId, position, rotation) => {
    // Legacy support for networkActions calling this. Just mutate global.
    if (!shipTransforms.has(shipId)) {
       shipTransforms.set(shipId, { 
           position: new THREE.Vector3(), 
           rotation: new THREE.Euler(),
           actualPosition: new THREE.Vector3(),
           actualRotation: new THREE.Euler()
       });
    }
    const transform = shipTransforms.get(shipId);
    if (position) transform.position.set(position[0], position[1], position[2]);
    if (rotation) transform.rotation.set(rotation[0], rotation[1], rotation[2], 'XYZ');
  },
  
  shipSteerIntents: {},
  setShipSteerIntent: (playerId, intent) => set((state) => ({ 
      shipSteerIntents: { ...state.shipSteerIntents, [playerId]: intent } 
  })),

  deconstructShip: () => {
      import('./networkActions').then(({ networkActions }) => {
          if (get().shipHelmPlayerId) {
             networkActions.getState().handleNetworkData({ type: 'RELEASE_HELM', playerId: get().shipHelmPlayerId });
          }
      });
      set((state) => ({
          shipBuffer: new Uint32Array(SHIP_VOLUME),
          isShipActive: false,
          shipHardwareCounts: { engine: 0, capacitor: 0 },
          activeFires: [],
          shipVoidCanisters: 0,
          isTransitMode: false,
          shipFullRebuildId: (state.shipFullRebuildId || 0) + 1
      }));
  },

  shipDestination: null,
  setShipDestination: (seed) => set({ shipDestination: seed }),

  recalculateShipHardware: (buffer) => set((state) => {
      let engine = 0;
      let capacitor = 0;
      let totalBlocks = 0;
      for (let i = 0; i < buffer.length; i++) {
          const id = buffer[i] & 0xff;
          if (id !== 0) totalBlocks++;
          if (id === 31) engine++;
          if (id === 32) capacitor++;
      }
      
      const newMaxHealth = Math.max(100, totalBlocks * 50);
      const healthPercentage = state.shipMaxHealth > 0 ? state.shipHealth / state.shipMaxHealth : 1;
      
      return { 
          shipHardwareCounts: { engine, capacitor },
          shipMaxPower: capacitor > 0 ? 20000 : 10000,
          shipMaxHealth: newMaxHealth,
          shipHealth: Math.min(newMaxHealth, newMaxHealth * healthPercentage)
      };
  }),

  initializeShip: () => {
    const buffer = new Uint32Array(SHIP_VOLUME);
    ShipStructure.forEach(block => {
      const x = SHIP_CENTER_X + block.dx;
      const y = SHIP_BASE_Y + block.dy; // Base height offset
      const z = SHIP_CENTER_Z + block.dz;
      if (x >= 0 && x < SHIP_SIZE_X && y >= 0 && y < SHIP_SIZE_Y && z >= 0 && z < SHIP_SIZE_Z) {
        const id = BlockIds[block.texture];
        if (id !== undefined) {
          buffer[getShipIndex(x, y, z)] = id;
        }
      }
    });

    set(state => ({ 
        shipBuffer: buffer, 
        shipRebuildId: state.shipRebuildId + 1, 
        shipFullRebuildId: state.shipFullRebuildId + 1, 
        isShipActive: true, 
        shipCorePower: 100, 
        shipHealth: 1000 
    }));
    // Recalculate hardware
    import('./useStore').then(({ useStore }) => {
        useStore.getState().recalculateShipHardware(buffer);
    });
  },

  loadShipState: async () => {
     const { loadShipFromDB } = await import('../utils/db');
     const buffer = await loadShipFromDB();
     if (buffer) {
        set({ shipBuffer: buffer, shipRebuildId: 1, shipFullRebuildId: 1, isShipActive: true });
        // Need to require useStore lazily or call from the state
        import('./useStore').then(({ useStore }) => {
            useStore.getState().recalculateShipHardware(buffer);
        });
     }
  },

  setShipBufferRaw: (buffer) => {
      set((state) => ({ 
          shipBuffer: buffer, 
          shipRebuildId: (state.shipRebuildId || 0) + 1,
          shipFullRebuildId: (state.shipFullRebuildId || 0) + 1,
          lastShipVoxelChange: null,
          isShipActive: true
      }));
      import('./useStore').then(({ useStore }) => {
          const store = useStore.getState();
          store.recalculateShipHardware(buffer);
          
          if (store.isSeated && store.seatOffset) {
             const cx = store.seatOffset[0] + SHIP_CENTER_X;
             const cy = store.seatOffset[1] + SHIP_CENTER_Y;
             const cz = store.seatOffset[2] + SHIP_CENTER_Z;
             const idx = getShipIndex(cx, cy, cz);
             const val = buffer[idx] & 0xff;
             if (val === 0) {
                 store.releaseHelm(store.playerId);
             }
          }
      });
  },

  setShipVoxel: (x, y, z, val) => {
    if (x < 0 || x >= SHIP_SIZE_X || y < 0 || y >= SHIP_SIZE_Y || z < 0 || z >= SHIP_SIZE_Z) return;
    set((state) => {
      const idx = getShipIndex(x, y, z);
      const oldVal = state.shipBuffer[idx] & 0xff;
      
      // Mutate directly to avoid 131KB array cloning per block (Memory Leak Fix)
      state.shipBuffer[idx] = val;
      
      const newCounts = { ...state.shipHardwareCounts };
      const newVal = val & 0xff;
      
      if (oldVal === 31) newCounts.engine--;
      if (oldVal === 32) newCounts.capacitor--;
      if (newVal === 31) newCounts.engine++;
      if (newVal === 32) newCounts.capacitor++;
      
      let newMaxHealth = state.shipMaxHealth;
      let newHealth = state.shipHealth;
      
      // Building is Damage Bug Fix: simultaneously scale health when block placed
      if (oldVal === 0 && newVal !== 0) {
          newMaxHealth += 50;
          newHealth += 50;
          
          // Container Placement Initialization
          if (newVal === 19 || newVal === 28 || newVal === 38) {
              import('./inventorySlice').then(({ useInventoryStore }) => {
                 const invStore = useInventoryStore.getState();
                 // VERY IMPORTANT: Use 'ship_x_y_z' prefix to differentiate from world containers!
                 const chestKey = `ship_${x}_${y}_${z}`;
                 if (!invStore.chests[chestKey]) {
                     const nextChests = { ...invStore.chests, [chestKey]: new Array(27).fill(null) };
                     const nextMachines = { ...invStore.machines };
                     if (newVal === 28 || newVal === 38) {
                         nextMachines[chestKey] = { cookProgress: 0, currentCookMax: 100, burnTimeLeft: 0, currentFuelMax: 100 };
                     }
                     useInventoryStore.setState({ chests: nextChests, machines: nextMachines });
                 }
              });
          }
      } else if (oldVal !== 0 && newVal === 0) {
          newMaxHealth = Math.max(100, newMaxHealth - 50);
          newHealth = Math.min(newMaxHealth, newHealth);
      }
      
      const currentState = get();
      const seat = currentState.seatOffset;
      if (currentState.isSeated && seat && seat[0] === x - SHIP_CENTER_X && seat[1] === y - SHIP_CENTER_Y && seat[2] === z - SHIP_CENTER_Z) {
          set({ isSeated: false, seatOffset: null });
          import('./networkActions').then(({ networkActions }) => {
                  const net = networkActions.getState();
                  if (currentState.shipHelmPlayerId === net.playerId) {
                      const intent = { type: 'RELEASE_HELM', playerId: net.playerId };
                      net.broadcastEvent(intent);
                      if (net.isHost) net.handleNetworkData(intent);
                  }
              });
      }
      
      const nextJobId = (state.shipJobId || 0) + 1;
      
      return { 
          shipBuffer: state.shipBuffer, 
          shipRebuildId: (state.shipRebuildId || 0) + 1,
          shipJobId: nextJobId,
          lastShipVoxelChange: { x, y, z, val, jobId: nextJobId },
          shipHardwareCounts: newCounts,
          shipMaxPower: newCounts.capacitor > 0 ? 20000 : 10000,
          shipMaxHealth: newMaxHealth,
          shipHealth: newHealth
      };
    });
  },
  
  drainShipPower: (amount) => {
    set((state) => ({ shipCorePower: Math.max(0, state.shipCorePower - amount) }));
  },
  
  chargeShipPower: (amount) => {
    set((state) => ({ shipCorePower: Math.min(state.shipMaxPower, state.shipCorePower + amount) }));
  },
  
  triggerShortWarp: (x, z) => {
     import('./networkActions').then(({ networkActions }) => {
         const net = networkActions.getState();
         const intent = { type: 'SHORT_WARP_INTENT', x, z };
         if (net.isHost) {
             net.handleNetworkData(intent, { peer: 'local' });
         } else {
             net.connections[0]?.send(intent);
         }
     });
  }
});
