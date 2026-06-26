// @ts-nocheck
/* eslint-disable no-unused-vars */
import { NetworkEventBus } from '../../utils/NetworkEventBus';
import { getGameStore } from '../../stores/storeLinker';
import { useInventoryStore } from '../../stores/inventorySlice';
import { _playerPosition, _playerRotation } from '../../globals';

const initializeInventorySystems = () => {
    NetworkEventBus.on('INVENTORY_SYNC', (payload) => {
        const { data, senderConn: _senderConn, getNetworkState, setNetworkState } = payload;
        const get = getNetworkState;
        const _set = setNetworkState;
        const _state = get();

       const useStore = getGameStore();
       if (useStore) {
           if (data.reason) {
              console.warn("Inventory Sync (Rejection Rubber-band):", data.reason);
              useStore.setState({ heldItem: null });
           }
           
           // --- INTENT QUEUE VALIDATION ---
           if (data.intentId && window.__intentQueue) {
               window.__intentQueue = window.__intentQueue.filter(id => id !== data.intentId);
           }
           
           const queueEmpty = !window.__intentQueue || window.__intentQueue.length === 0;

           if (data.authoritativeInventories) {
               useStore.setState({ authoritativeInventories: data.authoritativeInventories });
               // If we are a Guest, snap our local inventory prediction to the Host's authority ONLY IF no intents pending
               const myId = get().playerId;
               if (data.authoritativeInventories[myId] && queueEmpty) {
                   useStore.setState({ inventory: data.authoritativeInventories[myId] });
               }
           }
           if (data.chests) {
               useInventoryStore.setState({ chests: data.chests });
           }
           if (data.machines) {
               useInventoryStore.setState({ machines: data.machines });
           }
           
           // --- DELTA SYNCING ---
           if (data.delta) {
               if (data.delta.player) {
                   useStore.setState(prev => ({
                       authoritativeInventories: { ...prev.authoritativeInventories, [data.delta.player.id]: data.delta.player.inv }
                   }));
                   if (data.delta.player.id === get().playerId && queueEmpty) {
                       useStore.setState({ inventory: data.delta.player.inv });
                   }
               }
               if (data.delta.chest) {
                   useInventoryStore.setState(prev => ({
                       chests: { ...prev.chests, [data.delta.chest.id]: data.delta.chest.inv }
                   }));
               }
           }
       }
    
    });
    NetworkEventBus.on('INVENTORY_INTENT', (payload) => {
        const { data, senderConn, getNetworkState, setNetworkState } = payload;
        const get = getNetworkState;
        const _set = setNetworkState;
        const state = get();

       if (!state.isHost) return; // Only Host processes intents
       
       const senderId = senderConn.metadata?.playerId;
       if (!senderId) return;


       try {
           // 3. Distance Validation for Containers
           const pPos = state.players[senderId]?.pos;
           if (!pPos) throw new Error("Player position unknown");
           
           const checkDistance = (loc) => {
              if (loc.type === 'container') {
                 // loc.id is "chest_12,64,-5"
                 const coords = loc.id.replace('chest_', '').split(',').map(Number);
                 if (coords.length === 3) {
                    const dx = pPos[0] - coords[0];
                    const dy = pPos[1] - coords[1];
                    const dz = pPos[2] - coords[2];
                    const distSq = dx*dx + dy*dy + dz*dz;
                    if (distSq > 25) { // Distance > 5
                       throw new Error("Container too far away!");
                    }
                 }
              }
           };
           checkDistance(data.source);
           checkDistance(data.destination);
           
           // 4. Perform Transaction Logic
           const useStore = getGameStore();
           if (useStore) {
               useStore.getState().processInventoryTransaction(data, senderId);
               console.log("Valid Transaction:", data.action, data.source, "->", data.destination);
               
               const newState = useStore.getState();
               const delta = {};
               
               const getActualId = (loc) => loc.id === 'player' ? senderId : loc.id;
               
               const inventoryState = useInventoryStore.getState();
               if (data.source.type === 'player') delta.player = { id: getActualId(data.source), inv: newState.authoritativeInventories[getActualId(data.source)] };
               else if (data.source.type === 'container') delta.chest = { id: data.source.id, inv: inventoryState.chests[data.source.id] };
               
               if (data.destination) {
                   if (data.destination.type === 'player') delta.player = { id: getActualId(data.destination), inv: newState.authoritativeInventories[getActualId(data.destination)] };
                   else if (data.destination.type === 'container') delta.chest = { id: data.destination.id, inv: inventoryState.chests[data.destination.id] };
               }
               
               // Broadcast success delta-sync (Host broadcasts authoritative state to all peers)
               get().broadcastEvent({ 
                   type: 'INVENTORY_SYNC',
                   intentId: data.intentId,
                   delta
               });
           }
           
       } catch (err) {
           console.warn("Transaction Rejected:", err.message);
           try { senderConn.send({ type: 'INVENTORY_SYNC', intentId: data.intentId, reason: 'VALIDATION_FAILED' }); } catch { /* ignore */ }
       }
    
    });
    NetworkEventBus.on('GRANT_ITEM_INTENT', (payload) => {
        const { data, senderConn, getNetworkState, setNetworkState } = payload;
        const get = getNetworkState;
        const _set = setNetworkState;
        const state = get();

        if (!state.isHost) return;
        const senderId = senderConn.metadata?.playerId;
        if (!senderId) return;

        try {
            const useStore = getGameStore();
            if (!useStore) return;
            
            const authInvs = { ...useStore.getState().authoritativeInventories };
            const pInv = [...(authInvs[senderId] || Array(36).fill(null))];
            
            let remaining = data.count;
            // Try stacking
            for (let i = 0; i < pInv.length && remaining > 0; i++) {
               if (pInv[i] && pInv[i].texture === data.texture && pInv[i].count < 64) {
                   const space = 64 - pInv[i].count;
                   const add = Math.min(space, remaining);
                   pInv[i] = { ...pInv[i], count: pInv[i].count + add };
                   remaining -= add;
               }
            }
            // Empty slots
            for (let i = 0; i < pInv.length && remaining > 0; i++) {
               if (!pInv[i]) {
                   const add = Math.min(64, remaining);
                   pInv[i] = { texture: data.texture, count: add };
                   remaining -= add;
               }
            }
            
            authInvs[senderId] = pInv;
            useStore.setState({ authoritativeInventories: authInvs });
            
            get().broadcastEvent({ 
                type: 'INVENTORY_SYNC',
                authoritativeInventories: authInvs
            });
            
            // If they had leftover items, spawn them!
            if (remaining > 0) {
               const pPos = state.players[senderId]?.pos;
               if (pPos) {
                   const dropIntent = { 
                      type: 'SPAWN_LOOT', 
                      id: Math.random().toString(36), 
                      itemId: data.texture, 
                      amount: remaining, 
                      position: [pPos[0], pPos[1] + 1, pPos[2]] 
                   };
                   useStore.getState().spawnLoot(dropIntent);
                   get().broadcastEvent(dropIntent);
               }
            }
            
        } catch (err) {
            console.warn("Grant Item Failed:", err.message);
        }
    
    });

    NetworkEventBus.on('OUTBOUND_SHIP_CONTAINER_PLACED', (payload) => {
        const { x, y, z, newVal } = payload;
        const invStore = useInventoryStore.getState();
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
};



initializeInventorySystems();

