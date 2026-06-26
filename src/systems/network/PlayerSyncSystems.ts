// @ts-nocheck
/* eslint-disable no-unused-vars */
import { NetworkEventBus } from '../../utils/NetworkEventBus';
import { getGameStore } from '../../stores/storeLinker';
import { _useInventoryStore } from '../../stores/inventorySlice';
import { _playerPosition, _playerRotation } from '../../globals';

const initializePlayerSyncSystems = () => {
    NetworkEventBus.on('GUEST_SAVE', (payload) => {
        const { data, senderConn, getNetworkState, setNetworkState } = payload;
        const get = getNetworkState;
        const _set = setNetworkState;
        const state = get();

      if (state.isHost) {
         import('idb-keyval').then(({ set: idbSet }) => {
            const prefix = sessionStorage.getItem('saveSlotId') || 'default';
            const guestKey = `${prefix}_guest_${senderConn.metadata?.playerId}`;
            idbSet(guestKey, data.state).catch(e => console.error("Host failed to save guest state", e));
         });
      }
    
    });
    NetworkEventBus.on('XP_GAIN', (payload) => {
        const { data, senderConn: _senderConn, getNetworkState, setNetworkState } = payload;
        const get = getNetworkState;
        const _set = setNetworkState;
        const _state = get();

      const useStore = getGameStore();
                    if (useStore) {
                      if (useStore.getState().addData) {
                        useStore.getState().addData(data.amount);
                      }
         get().addChatMessage(`> Collected ${data.amount} KB Data`, 'system', 'System');
         // Dispatch event for UI audio/pulse
         window.dispatchEvent(new CustomEvent('XP_GAINED', { detail: { amount: data.amount } }));
      }
    
    });
    NetworkEventBus.on('ATTACK_INTENT', (payload) => {
        const { data, senderConn, getNetworkState, setNetworkState } = payload;
        const get = getNetworkState;
        const set = setNetworkState;
        const state = get();

       if (!state.isHost) return;
       const senderId = senderConn.metadata?.playerId;
       if (!senderId) return;

       const useStore = getGameStore();
       if (!useStore) return;
       
       // 1. Validate Cooldown
       const { weaponId, dir, origin } = data;
       
       set(prev => ({
           pendingHostAttacks: [...prev.pendingHostAttacks, { senderId, weaponId, dir, origin, timestamp: Date.now() }]
       }));
    
    });
};



initializePlayerSyncSystems();

