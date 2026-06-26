// @ts-nocheck
/* eslint-disable no-unused-vars */
import { NetworkEventBus } from '../../utils/NetworkEventBus';
import { getGameStore } from '../../stores/storeLinker';
import { _useInventoryStore } from '../../stores/inventorySlice';
import { _playerPosition, _playerRotation } from '../../globals';

const initializeChatSystems = () => {
    NetworkEventBus.on('CHAT_MESSAGE', (payload) => {
        const { data, senderConn, getNetworkState, setNetworkState } = payload;
        const get = getNetworkState;
        const _set = setNetworkState;
        const state = get();

      get().addChatMessage(data.text, 'chat', data.sender);
      if (state.isHost) {
         state.connections.forEach(conn => {
            if (conn.peer !== senderConn.peer) try { conn.send(data); } catch { /* ignore */ }
         });
      }
    
    });
    NetworkEventBus.on('SYSTEM_MESSAGE', (payload) => {
        const { data, senderConn: _senderConn, getNetworkState, setNetworkState } = payload;
        const get = getNetworkState;
        const _set = setNetworkState;
        const _state = get();

      get().addChatMessage(data.text, 'system', 'System');
    
    });
};



initializeChatSystems();

