/* eslint-disable no-unused-vars */
import { NetworkEventBus } from '../../utils/NetworkEventBus';
import { getGameStore } from '../../stores/storeLinker';
import { useInventoryStore } from '../../stores/inventorySlice';
import { playerPosition, playerRotation } from '../../globals';

const initializeChatSystems = () => {
    NetworkEventBus.on('CHAT_MESSAGE', (payload) => {
        const { data, senderConn, getNetworkState, setNetworkState } = payload;
        const get = getNetworkState;
        const set = setNetworkState;
        const state = get();

      get().addChatMessage(data.text, 'chat', data.sender);
      if (state.isHost) {
         state.connections.forEach(conn => {
            if (conn.peer !== senderConn.peer) try { conn.send(data); } catch { /* ignore */ }
         });
      }
    
    });
    NetworkEventBus.on('SYSTEM_MESSAGE', (payload) => {
        const { data, senderConn, getNetworkState, setNetworkState } = payload;
        const get = getNetworkState;
        const set = setNetworkState;
        const state = get();

      get().addChatMessage(data.text, 'system', 'System');
    
    });
};



initializeChatSystems();
