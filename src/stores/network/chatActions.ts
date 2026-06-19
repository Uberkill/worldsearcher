import { getGameStore } from '../storeLinker';
import { useEnvironmentStore } from '../environmentSlice';
import { playerPosition } from '../../globals';

export const createChatActions = (set: any, get: any): Record<string, any> => ({
    setTyping: (val) => set({ isTyping: val }),
    
    addChatMessage: (text, type = 'chat', sender = 'System') => set(state => {
       const newMsg = { id: Math.random().toString(36).substring(2, 9), text, type, sender, timestamp: Date.now() };
       return { chatMessages: [...state.chatMessages, newMsg].slice(-50) };
    }),

  broadcastChatMessage: (text) => {
     const { connections, playerName, isHost } = get();
     const senderName = playerName || (isHost ? 'Host' : 'Guest');
     const msgData = { type: 'CHAT_MESSAGE', text, sender: senderName };
     connections.forEach(conn => { try { conn.send(msgData); } catch(e) { console.warn("[Network] Dropped packet/action:", e.message); } });
     get().addChatMessage(text, 'chat', senderName);
  },
  
  broadcastSystemMessage: (text) => {
     const { connections, isHost } = get();
     if (!isHost) return;
     const msgData = { type: 'SYSTEM_MESSAGE', text };
     connections.forEach(conn => { try { conn.send(msgData); } catch(e) { console.warn("[Network] Dropped packet/action:", e.message); } });
     get().addChatMessage(text, 'system', 'System');
  },
  
  executeCommand: (text) => {
    const args = text.trim().split(/\s+/);
    const cmd = args[0].toLowerCase();
    const state = get();
    const useStore = getGameStore();
    if (!useStore) return;

    if (cmd === '/help') {
      state.addChatMessage('Commands: /help, /gamemode <mode>, /weather <clear|rain>, /time set <day|night>, /tp @s <x y z>, /give @s <item> [amount], /op <player>, /deop <player>, /kick <player>', 'system', 'System');
      return;
    }

    if (state.isHost) {
      state.processCommandIntent(cmd, args, state.playerId);
    } else {
      if (state.connections[0]) {
        try {
           state.connections[0].send({ type: 'COMMAND_INTENT', cmd, args });
        } catch(e) { console.warn("[Network] Dropped packet/action:", e.message); }
      }
    }
  },

  processCommandIntent: (cmd, args, senderId) => {
    const state = get();
    const useStore = getGameStore();
    if (!useStore) return;

    const isSelf = senderId === state.playerId;
    const isOp = isSelf || state.mods.includes(senderId);

    const sendFeedback = (msg) => {
      if (isSelf) state.addChatMessage(msg, 'system', 'System');
      else {
        const conn = state.connections.find(c => c.metadata?.playerId === senderId);
        if (conn) {
          try { conn.send({ type: 'SYSTEM_MESSAGE', text: msg }); } catch(e) { console.warn("[Network] Dropped packet/action:", e.message); }
        }
      }
    };

    if (cmd === '/refuel') {
      if (!isOp) return sendFeedback('You do not have permission to use this command.');
      useStore.setState({ shipCorePower: 100 });
      sendFeedback('Ship refueled to 100%.');
      return;
    }

    if (cmd === '/gamemode') {
      if (!isOp) return sendFeedback('You do not have permission to use this command.');
      const mode = args[1]?.toLowerCase();
      if (['survival', 'creative', 'adventure'].includes(mode)) {
        if (isSelf) {
          useStore.getState().setGameMode(mode);
          sendFeedback(`Set own game mode to ${mode}`);
        } else {
          const conn = state.connections.find(c => c.metadata?.playerId === senderId);
          if (conn) {
            try { conn.send({ type: 'SET_GAMEMODE', mode }); } catch(e) { console.warn("[Network] Dropped packet/action:", e.message); }
          }
        }
        state.broadcastSystemMessage(`[Server] ${state.players[senderId]?.name || senderId} set their game mode to ${mode}`);
      } else {
        sendFeedback('Usage: /gamemode <survival|creative|adventure>');
      }
    }
    else if (cmd === '/weather') {
      if (!isOp) return sendFeedback('You do not have permission to use this command.');
      const w = args[1]?.toLowerCase();
      if (w === 'clear') {
        useEnvironmentStore.getState().setWorldTime(useEnvironmentStore.getState().worldTime, useEnvironmentStore.getState().daysElapsed, false);
        state.broadcastSystemMessage(`[Server] Weather cleared by ${state.players[senderId]?.name || senderId}`);
        state.broadcastEvent({ type: 'TIME_SYNC', worldTime: useEnvironmentStore.getState().worldTime, isRaining: false });
      } else if (w === 'rain') {
        useEnvironmentStore.getState().setWorldTime(useEnvironmentStore.getState().worldTime, useEnvironmentStore.getState().daysElapsed, true);
        state.broadcastSystemMessage(`[Server] Rain started by ${state.players[senderId]?.name || senderId}`);
        state.broadcastEvent({ type: 'TIME_SYNC', worldTime: useEnvironmentStore.getState().worldTime, isRaining: true });
      } else {
        sendFeedback('Usage: /weather <clear|rain>');
      }
    }
    else if (cmd === '/ship') {
      if (!isOp) return sendFeedback('You do not have permission to use this command.');
      
      const useStore = getGameStore();
      if (!useStore) return sendFeedback('Store not ready.');
      
      let pPos = null;
      if (isSelf) {
         pPos = [playerPosition.x, playerPosition.y, playerPosition.z];
      } else {
         pPos = state.players[senderId]?.pos;
      }
      
      if (!pPos) return sendFeedback('Player position unknown.');
      
      const px = Math.floor(pPos[0]);
      const py = Math.floor(pPos[1]);
      const pz = Math.floor(pPos[2]);

      // Host generates the prefab ship
      useStore.getState().initializeShip();
      
      const shipPos = [px, py + 45, pz];
      useStore.getState().setShipTransform('default', shipPos, [0, 0, 0], true);
      state.broadcastEvent({ type: 'SHIP_TRANSFORM', position: shipPos, rotation: [0, 0, 0] });
      
      // Compress and broadcast the new ship buffer
      const buffer = useStore.getState().shipBuffer;
      const rle = [];
      let currentVal = buffer[0];
      let count = 0;
      for (let i = 0; i < buffer.length; i++) {
          if (buffer[i] === currentVal) {
              count++;
          } else {
              rle.push(currentVal, count);
              currentVal = buffer[i];
              count = 1;
          }
      }
      rle.push(currentVal, count);
      state.broadcastEvent({ type: 'SHIP_BUFFER_SYNC', shipBufferRLE: rle });
      
      sendFeedback('Ship spawned successfully from prefab!');
    }
    else if (cmd === '/time') {
      if (!isOp) return sendFeedback('You do not have permission to use this command.');
      if (args[1] === 'set') {
        let t;
        if (args[2] === 'day') t = 8.0;
        else if (args[2] === 'night') t = 20.0;
        else t = parseFloat(args[2]);
        if (isNaN(t)) return sendFeedback('Usage: /time set <day|night|number>');
        
        useEnvironmentStore.getState().setWorldTime(t, useEnvironmentStore.getState().daysElapsed);
        state.broadcastSystemMessage(`[Server] Time set to ${t} by ${state.players[senderId]?.name || senderId}`);
        state.broadcastEvent({ type: 'TIME_SYNC', worldTime: t, isRaining: useEnvironmentStore.getState().isRaining });
      } else {
        sendFeedback('Usage: /time set <day|night|number>');
      }
    }
    else if (cmd === '/tp') {
      if (!isOp) return sendFeedback('You do not have permission to use this command.');
      const target = args[1]; // "@s"
      if (target === '@s' && args.length >= 5) {
        const x = parseFloat(args[2]);
        const y = parseFloat(args[3]);
        const z = parseFloat(args[4]);
        if (isNaN(x) || isNaN(y) || isNaN(z)) return sendFeedback('Invalid coordinates');
        if (isSelf) {
          useStore.getState().executeTeleport([x, y, z]);
          sendFeedback(`Teleported to ${x} ${y} ${z}`);
        } else {
          const conn = state.connections.find(c => c.metadata?.playerId === senderId);
          if (conn) {
            try { conn.send({ type: 'TELEPORT', pos: [x, y, z] }); } catch(e) { console.warn("[Network] Dropped packet/action:", e.message); }
          }
        }
      } else {
        sendFeedback('Usage: /tp @s <x> <y> <z>');
      }
    }
    else if (cmd === '/give') {
      if (!isOp) return sendFeedback('You do not have permission to use this command.');
      const target = args[1]; // "@s"
      if (target === '@s') {
        const item = args[2];
        const amount = parseInt(args[3]) || 64;
        if (!item) return sendFeedback('Usage: /give @s <item> [amount]');
        
        const authInvs = { ...useStore.getState().authoritativeInventories };
        const pInv = [...(authInvs[senderId] || Array(36).fill(null))];
        let remaining = amount;
        for (let i = 0; i < pInv.length && remaining > 0; i++) {
           if (pInv[i] && pInv[i].texture === item && pInv[i].count < 64) {
               const space = 64 - pInv[i].count;
               const add = Math.min(space, remaining);
               pInv[i] = { ...pInv[i], count: pInv[i].count + add };
               remaining -= add;
           }
        }
        for (let i = 0; i < pInv.length && remaining > 0; i++) {
           if (!pInv[i]) {
               const add = Math.min(64, remaining);
               pInv[i] = { texture: item, count: add };
               remaining -= add;
           }
        }
        authInvs[senderId] = pInv;
        useStore.setState({ authoritativeInventories: authInvs });
        if (isSelf) {
           useStore.setState({ inventory: pInv });
        }
        state.broadcastEvent({ type: 'INVENTORY_SYNC', authoritativeInventories: authInvs });
        sendFeedback(`Given ${amount - remaining} of ${item}`);
      } else {
        sendFeedback('Usage: /give @s <item> [amount]');
      }
    }
    else if (cmd === '/op') {
      if (!isSelf) return sendFeedback('Only the true Host can use /op.');
      const pName = args[1];
      const pId = Object.keys(state.players).find(k => state.players[k].name === pName);
      if (pId) {
        state.addMod(pId);
        sendFeedback(`Made ${pName} a server operator.`);
        state.broadcastSystemMessage(`[Server] ${pName} is now a server operator.`);
      } else {
        sendFeedback(`Player ${pName} not found.`);
      }
    }
    else if (cmd === '/deop') {
      if (!isSelf) return sendFeedback('Only the true Host can use /deop.');
      const pName = args[1];
      const pId = Object.keys(state.players).find(k => state.players[k].name === pName);
      if (pId) {
        state.removeMod(pId);
        sendFeedback(`Removed ${pName}'s operator status.`);
        state.broadcastSystemMessage(`[Server] ${pName} is no longer a server operator.`);
      } else {
        sendFeedback(`Player ${pName} not found.`);
      }
    }
    else if (cmd === '/kick') {
      if (!isOp) return sendFeedback('You do not have permission to use this command.');
      const pName = args[1];
      const conn = state.connections.find(c => state.players[c.metadata?.playerId]?.name === pName);
      if (conn) {
        try { conn.send({ type: 'KICK', reason: 'Kicked by operator.' }); } catch(e) { console.warn("[Network] Dropped packet/action:", e.message); }
        setTimeout(() => conn.close(), 100);
        state.broadcastSystemMessage(`[Server] ${pName} was kicked.`);
      } else {
        sendFeedback(`Player ${pName} not found.`);
      }
    }
    else {
      sendFeedback(`Unknown command: ${cmd}`);
    }
  }
});
