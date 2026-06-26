import { NetworkEventBus } from '../utils/NetworkEventBus';
import { getGameStore } from '../stores/storeLinker';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useEnvironmentStore } from '../stores/environmentSlice';
import { playerPosition } from '../globals';
import { networkActions } from '../stores/networkActions';
import { NetworkPacket } from '../types/network';

export const initCommandSystem = () => {
  NetworkEventBus.on('SERVER_COMMAND', (payload: unknown) => {
    const p = payload as Extract<NetworkPacket, { type: 'SERVER_COMMAND' }>;
    const cmd = p.cmd;
    const args = p.args;
    const senderId = p.senderId;
    
    const state = networkActions.getState();
    const useStore = getGameStore();
    if (!useStore) return;

    const isSelf = senderId === state.playerId;
    const isOp = isSelf || state.mods.includes(senderId);

    const sendFeedback = (msg: string) => {
      if (isSelf) {
        state.addChatMessage(msg, 'system', 'System');
      } else {
        const conn = state.connections.find((c: import('peerjs').DataConnection) => c.metadata?.playerId === senderId);
        if (conn) {
          try { 
            conn.send({ type: 'SYSTEM_MESSAGE', text: msg }); 
          } catch(e) { 
            console.warn("[Network] Dropped packet/action:", (e as Error).message); 
          }
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
          useSettingsStore.getState().setGameMode(mode as 'survival' | 'creative' | 'adventure');
          sendFeedback(`Set own game mode to ${mode}`);
        } else {
          const conn = state.connections.find((c: import('peerjs').DataConnection) => c.metadata?.playerId === senderId);
          if (conn) {
            try { conn.send({ type: 'SET_GAMEMODE', mode }); } catch(e) { console.warn("[Network] Dropped packet/action:", (e as Error).message); }
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
      
      let pPos: number[] | null = null;
      if (isSelf) {
         pPos = [playerPosition.x, playerPosition.y, playerPosition.z];
      } else {
         pPos = state.players[senderId]?.pos || null;
      }
      
      if (!Array.isArray(pPos) || pPos.length < 3 || pPos.some(isNaN)) {
         return sendFeedback('Player position unknown or invalid.');
      }
      
      const px = Math.floor(pPos[0]);
      const py = Math.floor(pPos[1]);
      const pz = Math.floor(pPos[2]);

      useStore.getState().initializeShip();
      
      const shipPos = [px, py + 45, pz];
      useStore.getState().setShipTransform('default', shipPos as [number, number, number], [0, 0, 0], true);
      state.broadcastEvent({ type: 'SHIP_TRANSFORM', position: shipPos, rotation: [0, 0, 0] });
      
      const buffer = useStore.getState().shipBuffer;
      const rle: number[] = [];
      if (buffer && buffer.length > 0) {
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
      }
      
      sendFeedback('Ship spawned successfully from prefab!');
    }
    else if (cmd === '/time') {
      if (!isOp) return sendFeedback('You do not have permission to use this command.');
      if (args[1] === 'set') {
        let t: number;
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
          const conn = state.connections.find((c: import('peerjs').DataConnection) => c.metadata?.playerId === senderId);
          if (conn) {
            try { conn.send({ type: 'TELEPORT', pos: [x, y, z] }); } catch(e) { console.warn("[Network] Dropped packet/action:", (e as Error).message); }
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
        const userInv = authInvs[senderId];
        const pInv = [...(Array.isArray(userInv) ? userInv : Array(36).fill(null))];
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
      const conn = state.connections.find((c: import('peerjs').DataConnection) => state.players[c.metadata?.playerId]?.name === pName);
      if (conn) {
        try { conn.send({ type: 'KICK', reason: 'Kicked by operator.' }); } catch(e) { console.warn("[Network] Dropped packet/action:", (e as Error).message); }
        setTimeout(() => conn.close(), 100);
        state.broadcastSystemMessage(`[Server] ${pName} was kicked.`);
      } else {
        sendFeedback(`Player ${pName} not found.`);
      }
    }
    else {
      sendFeedback(`Unknown command: ${cmd}`);
    }
  });
};
