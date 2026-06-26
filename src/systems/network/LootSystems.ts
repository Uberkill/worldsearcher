// @ts-nocheck
/* eslint-disable no-unused-vars */
import { NetworkEventBus } from '../../utils/NetworkEventBus';
import { getGameStore } from '../../stores/storeLinker';
import { useInventoryStore } from '../../stores/inventorySlice';
import { playerPosition, _playerRotation } from '../../globals';

const initializeLootSystems = () => {
    NetworkEventBus.on('SPAWN_LOOT', (payload) => {
        const { data, senderConn: _senderConn, getNetworkState, setNetworkState } = payload;
        const get = getNetworkState;
        const _set = setNetworkState;
        const _state = get();

        const useStore = getGameStore();
        if (useStore) {
            useStore.getState().spawnLoot(data);
        }
    
    });
    NetworkEventBus.on('DESPAWN_LOOT', (payload) => {
        const { data, senderConn: _senderConn, getNetworkState, setNetworkState } = payload;
        const get = getNetworkState;
        const _set = setNetworkState;
        const _state = get();

        const useStore = getGameStore();
        if (useStore) {
            useStore.getState().despawnLoot(data.dropId);
        }
    
    });
    NetworkEventBus.on('UPDATE_LOOT_AMOUNT', (payload) => {
        const { data, senderConn: _senderConn, getNetworkState, setNetworkState } = payload;
        const get = getNetworkState;
        const _set = setNetworkState;
        const _state = get();

        const useStore = getGameStore();
        if (useStore) {
            useStore.getState().updateLootAmount(data.dropId, data.count);
        }
    
    });
    NetworkEventBus.on('LOOT_REJECTED', (payload) => {
        const { data, senderConn: _senderConn, getNetworkState, setNetworkState } = payload;
        const get = getNetworkState;
        const _set = setNetworkState;
        const _state = get();

        window.dispatchEvent(new CustomEvent('LOOT_REJECTED', { detail: data.dropId }));
    
    });
    NetworkEventBus.on('LOOT_INTENT', (payload) => {
        const { data, senderConn, getNetworkState, setNetworkState } = payload;
        const get = getNetworkState;
        const _set = setNetworkState;
        const state = get();

        if (!state.isHost) return;
        
        const senderId = senderConn.metadata?.playerId;
        if (!senderId) return;
        const dropId = data.dropId;
        if (!dropId) return;

        try {
            const useStore = getGameStore();
            if (!useStore) throw new Error("Store unavailable");
            const wState = useInventoryStore.getState();
            
            // 3. Find drop and calculate distance
            const drop = wState.droppedItems.find(d => d.key === data.dropId);
            if (!drop) throw new Error("Drop doesn't exist");
            
            let pPos;
            if (senderId === state.playerId) {
               pPos = [playerPosition.x, playerPosition.y, playerPosition.z];
            } else {
               pPos = state.players[senderId]?.pos;
            }
            if (!pPos) throw new Error("Player unknown");
            
            const dx = pPos[0] - drop.pos[0];
            const dy = pPos[1] - drop.pos[1];
            const dz = pPos[2] - drop.pos[2];
            const distSq = dx*dx + dy*dy + dz*dz;
            
            // 4. Validate Distance (Magnetic Radius is 3, allow 4.5 for network variance)
            if (distSq > 20) {
               throw new Error("Loot too far away");
            }
            
            // --- RPG System: XP ORB INTERCEPT ---
            if (drop.texture === 'xp_orb') {
                const xpAmount = drop.count;
                
                // Despawn the orb globally
                wState.despawnLoot(data.dropId);
                get().broadcastEvent({ type: 'DESPAWN_LOOT', dropId: data.dropId });
                
                // Grant XP
                if (senderId === state.playerId) {
                  if (wState.addData) {
                    wState.addData(xpAmount);
                  }
                  get().addChatMessage(`> Collected ${xpAmount} KB Data`, 'system', 'System');
                  window.dispatchEvent(new CustomEvent('XP_GAINED', { detail: { amount: xpAmount } }));
                } else {
                    try { senderConn.send({ type: 'XP_GAIN', amount: xpAmount }); } catch { /* ignore */ }
                }
                
                return;
            }
            // --- END RPG ---

            // 5. Add to Player Inventory (Server Authority)
            const authInvs = { ...wState.authoritativeInventories };
            const pInv = [...(authInvs[senderId] || Array(36).fill(null))];
            
            let remaining = drop.count;
            
            // Try stacking
            for (let i = 0; i < pInv.length && remaining > 0; i++) {
               if (pInv[i] && pInv[i].texture === drop.itemId && pInv[i].count < 64) {
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
                   pInv[i] = { texture: drop.itemId, count: add };
                   remaining -= add;
               }
            }
            
            if (remaining < drop.count) {
               // Successfully looted some or all
               authInvs[senderId] = pInv;
               useStore.setState({ authoritativeInventories: authInvs });
               
               if (remaining === 0) {
                  wState.despawnLoot(data.dropId);
                  get().broadcastEvent({ type: 'DESPAWN_LOOT', dropId: data.dropId });
               } else {
                  // Partial loot: The looter took what they could, leaving the rest on the floor.
                  wState.updateLootAmount(data.dropId, remaining);
                  get().broadcastEvent({ type: 'UPDATE_LOOT_AMOUNT', dropId: data.dropId, count: remaining });
                  
                  // Reject the looter so their visual tween resets and enters cooldown
                  if (senderId === state.playerId) {
                      window.dispatchEvent(new CustomEvent('LOOT_REJECTED', { detail: data.dropId }));
                  } else {
                      try { senderConn.send({ type: 'LOOT_REJECTED', dropId: data.dropId }); } catch { /* ignore */ }
                  }
               }
               
               get().broadcastEvent({ 
                   type: 'INVENTORY_SYNC',
                   authoritativeInventories: authInvs
               });
            } else {
               throw new Error("Inventory full");
            }
            
        } catch (err) {
            console.warn("Tombstone loot rejected:", err.message);
            // Send rejection to reset visual tween
            if (senderId === state.playerId) {
                window.dispatchEvent(new CustomEvent('LOOT_REJECTED', { detail: data.dropId }));
            } else {
                try { senderConn.send({ type: 'LOOT_REJECTED', dropId: data.dropId }); } catch { /* ignore */ }
            }
            // Unlock! Wait, if looted successfully, we delete it anyway.
        }
    
    });
};



initializeLootSystems();

