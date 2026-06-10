import { getGameStore, setNetworkStore } from './storeLinker';
import { useChunkStore } from './chunkSlice';
import { useInventoryStore } from './inventorySlice';
import { useChatStore } from './chatSlice';
import { useSyncStore } from './syncSlice';
import { useConnectionStore } from './connectionSlice';
import { useEnvironmentStore } from './environmentSlice';
import { useFlareStore } from './flareSlice';
import { create } from 'zustand';
import Peer from 'peerjs';
import { getSeed, setWorldSeed } from '../worldSeed';
import { compressRLE, decompressRLE, flushWAL } from '../utils/db';
import { playerPosition } from '../globals';

const chatKeys = new Set(['chatMessages', 'isTyping']);
const syncKeys = new Set(['players', 'guestHealthMap', 'enemySyncBuffers', 'queuedDeltas', 'waypoints']);
const connectionKeys = new Set([
  'peer', 'connections', 'unreliableConnections', 'isHost', 'roomCode', 
  'playerName', 'connectionStatus', 'playerId', 'mods', 'pendingHostAttacks', 
  'chunkRequests', 'chunkQueue', 'inFlightChunkRequests', 'MAX_CONCURRENT_CHUNK_REQUESTS'
]);

let baseGetState = null;

const stateProxy = new Proxy({}, {
  get(target, prop) {
    if (prop === 'then') return undefined;
    if (chatKeys.has(prop)) {
      return useChatStore.getState()[prop];
    }
    if (syncKeys.has(prop)) {
      return useSyncStore.getState()[prop];
    }
    if (connectionKeys.has(prop)) {
      return useConnectionStore.getState()[prop];
    }
    const base = baseGetState ? baseGetState() : {};
    return base[prop];
  },
  has(target, prop) {
    const base = baseGetState ? baseGetState() : {};
    return chatKeys.has(prop) || syncKeys.has(prop) || connectionKeys.has(prop) || (prop in base);
  },
  ownKeys(target) {
    const base = baseGetState ? baseGetState() : {};
    return [
      ...chatKeys,
      ...syncKeys,
      ...connectionKeys,
      ...Reflect.ownKeys(base)
    ];
  },
  getOwnPropertyDescriptor(target, prop) {
    return {
      enumerable: true,
      configurable: true,
      value: this.get(target, prop)
    };
  }
});

const trackPacket = (data, dir) => {
   if (!window.__DEBUG_STATS__ || !window.__DEBUG_STATS__.packetStats) return;
   const stats = window.__DEBUG_STATS__.packetStats[dir];
   if (!stats) return;
   let type = 'UNKNOWN';
   if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
      const typeByte = new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer)[0];
      if (typeByte === 1) type = 'PLAYER_MOVE';
      else if (typeByte === 2) type = 'BLOCK_DELTA';
      else if (typeByte === 3) type = 'ENTITY_STATE';
   } else if (data instanceof Blob) {
      type = 'BLOB_PACKET'; // Async read too slow for sync tracking
   } else if (data && data.type) {
      type = data.type;
   }
   stats[type] = (stats[type] || 0) + 1;
};

const generateRoomCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

export const networkActions = create((rawSet, rawGet) => {
  baseGetState = rawGet;
  const get = () => stateProxy;

  const set = (updater) => {
    const prevState = get();
    const patch = typeof updater === 'function' ? updater(prevState) : updater;
    
    if (patch.chatMessages !== undefined) {
      useChatStore.setState({ chatMessages: patch.chatMessages });
      delete patch.chatMessages;
    }
    if (patch.isTyping !== undefined) {
      useChatStore.setState({ isTyping: patch.isTyping });
      delete patch.isTyping;
    }
    if (patch.players !== undefined) {
      useSyncStore.setState({ players: patch.players });
      delete patch.players;
    }
    if (patch.guestHealthMap !== undefined) {
      useSyncStore.setState({ guestHealthMap: patch.guestHealthMap });
      delete patch.guestHealthMap;
    }
    if (patch.enemySyncBuffers !== undefined) {
      useSyncStore.setState({ enemySyncBuffers: patch.enemySyncBuffers });
      delete patch.enemySyncBuffers;
    }
    if (patch.queuedDeltas !== undefined) {
      useSyncStore.setState({ queuedDeltas: patch.queuedDeltas });
      delete patch.queuedDeltas;
    }
    if (patch.waypoints !== undefined) {
      useSyncStore.setState({ waypoints: patch.waypoints });
      delete patch.waypoints;
    }
    
    const connectionKeys = ['peer', 'connections', 'unreliableConnections', 'isHost', 'roomCode', 'playerName', 'connectionStatus', 'playerId', 'mods', 'pendingHostAttacks', 'chunkRequests', 'chunkQueue', 'inFlightChunkRequests'];
    const connectionPatch = {};
    for (const key of connectionKeys) {
       if (patch[key] !== undefined) {
          connectionPatch[key] = patch[key];
          delete patch[key];
       }
    }
    if (Object.keys(connectionPatch).length > 0) {
       useConnectionStore.setState(connectionPatch);
    }

    if (Object.keys(patch).length > 0) {
      rawSet(patch);
    }
  };

  return {
    setPlayerName: (name) => set({ playerName: name }),
    popPendingAttacks: () => {
       const queue = get().pendingHostAttacks;
       if (queue.length === 0) return [];
       set({ pendingHostAttacks: [] });
       return queue;
    },
    
    // Mod Roles
    addMod: (id) => set(s => ({ mods: [...new Set([...s.mods, id])] })),
    removeMod: (id) => set(s => ({ mods: s.mods.filter(m => m !== id) })),

    setTyping: (val) => set({ isTyping: val }),
    addChatMessage: (text, type = 'chat', sender = 'System') => set(state => {
       const newMsg = { id: Math.random().toString(36).substring(2, 9), text, type, sender, timestamp: Date.now() };
       return { chatMessages: [...state.chatMessages, newMsg].slice(-50) };
    }),

  broadcastChatMessage: (text) => {
     const { connections, playerName, isHost } = get();
     const senderName = playerName || (isHost ? 'Host' : 'Guest');
     const msgData = { type: 'CHAT_MESSAGE', text, sender: senderName };
     connections.forEach(conn => { try { conn.send(msgData); } catch { /* ignore */ } });
     get().addChatMessage(text, 'chat', senderName);
  },
  broadcastSystemMessage: (text) => {
     const { connections, isHost } = get();
     if (!isHost) return;
     const msgData = { type: 'SYSTEM_MESSAGE', text };
     connections.forEach(conn => { try { conn.send(msgData); } catch { /* ignore */ } });
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
        } catch { /* ignore */ }
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
          try { conn.send({ type: 'SYSTEM_MESSAGE', text: msg }); } catch { /* ignore */ }
        }
      }
    };

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
            try { conn.send({ type: 'SET_GAMEMODE', mode }); } catch { /* ignore */ }
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
    else if (cmd === '/time') {
      if (!isOp) return sendFeedback('You do not have permission to use this command.');
      if (args[1] === 'set') {
        let t = 8.0;
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
            try { conn.send({ type: 'TELEPORT', pos: [x, y, z] }); } catch { /* ignore */ }
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
        try { conn.send({ type: 'KICK', reason: 'Kicked by operator.' }); } catch { /* ignore */ }
        setTimeout(() => conn.close(), 100);
        state.broadcastSystemMessage(`[Server] ${pName} was kicked.`);
      } else {
        sendFeedback(`Player ${pName} not found.`);
      }
    }
    else {
      sendFeedback(`Unknown command: ${cmd}`);
    }
  },
  
    // Waypoint System
    addWaypoint: (x, y, z, color, ownerId) => set(state => {
       const newWp = { id: ownerId, x, y, z, color, timestamp: Date.now() };
       const filtered = useSyncStore.getState().waypoints.filter(w => w.id !== ownerId);
       return { waypoints: [...filtered, newWp] };
    }),
  broadcastWaypoint: (x, y, z) => {
     const { connections, playerId } = get();
     connections.forEach(conn => { try { conn.send({ type: 'WAYPOINT_PING', x, y, z, ownerId: playerId }); } catch { /* ignore */ } });
     get().addWaypoint(x, y, z, '#22d3ee', playerId);
  },

  // Host a game
  hostGame: async () => {
    await get().disconnect(); // FIX: Prevent Zombie Connections
    set({ connectionStatus: 'connecting' });
    const code = generateRoomCode();
    
    // Prefix room code to ensure uniqueness on public peerjs server
    const peerId = `ws-game-${code}`;
    
    const peer = new Peer(peerId, {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' }
        ]
      }
    });
    
    peer.on('open', (_id) => {
      console.log('Host ready. Room Code:', code);
      set({ peer, isHost: true, roomCode: code, connectionStatus: 'connected' });
            // Ping interval & Active Guest Saving
        const pingInterval = setInterval(() => {
           const netState = get();
           const useStore = typeof window !== 'undefined' && window.__GAME_STORE__ ? window.__GAME_STORE__.getState() : null;
           
           netState.connections.forEach(conn => {
              try { conn.send({ type: 'PING', time: Date.now() }); } catch(_e) {}
              
              // Active Guest Saving: Don't rely on the Guest to send GUEST_SAVE
              if (useStore && conn.metadata?.playerId) {
                 const guestId = conn.metadata.playerId;
                 import('idb-keyval').then(({ get: idbGet, set: idbSet }) => {
                    const prefix = typeof window !== 'undefined' && window.sessionStorage ? sessionStorage.getItem('saveSlotId') || 'default' : 'default';
                    const guestKey = `${prefix}_guest_${guestId}`;
                    idbGet(guestKey).then((savedState) => {
                       const currentState = savedState || { version: 1 };
                       // Merge authoritative Host knowledge
                       if (useStore.authoritativeInventories[guestId]) {
                          currentState.inventory = useStore.authoritativeInventories[guestId];
                       }
                       if (netState.players[guestId]) {
                          currentState.playerPos = netState.players[guestId].pos;
                          currentState.playerRot = netState.players[guestId].rot;
                       }
                       idbSet(guestKey, currentState).catch(e => console.error("Host active save failed", e));
                    });
                 });
              }
           });
        }, 5000);
      set({ pingInterval });
    });

    peer.on('connection', (conn) => {
      if (conn.label === 'movement') {
        const onMoveOpen = () => set((state) => ({ unreliableConnections: [...state.unreliableConnections, conn] }));
        if (conn.open) onMoveOpen();
        else conn.on('open', onMoveOpen);
        conn.on('data', (data) => get().handleNetworkData(data, conn));
        conn.on('close', () => set(state => ({ unreliableConnections: state.unreliableConnections.filter(c => c.peer !== conn.peer) })));
        return;
      }

      console.log('Guest connected:', conn.peer);
      
      const onConnectionOpen = () => {
        // Intercept send to count bytes
        const originalSend = conn.send;
        conn.send = (data) => {
          if (window.__DEBUG_STATS__) {
             trackPacket(data, 'sent');
             if (data instanceof ArrayBuffer || data instanceof Uint8Array) window.__DEBUG_STATS__.bytesSent += data.byteLength;
             else if (data instanceof Blob) window.__DEBUG_STATS__.bytesSent += data.size;
             else {
                try { 
                   if (data.type === 'WORLD_SYNC_RLE' && data.rle) window.__DEBUG_STATS__.bytesSent += data.rle.length * 4 + 100;
                   else window.__DEBUG_STATS__.bytesSent += JSON.stringify(data).length; 
                } catch { /* ignore */ }
             }
          }
          originalSend.call(conn, data);
        };
        
        set(state => ({ connections: [...state.connections, conn] }));
        
        // Fetch the Guest's saved profile if it exists
        import('idb-keyval').then(({ get: idbGet }) => {
           const prefix = sessionStorage.getItem('saveSlotId') || 'default';
           const guestKey = `${prefix}_guest_${conn.metadata?.playerId}`;
           idbGet(guestKey).then((savedState) => {
               try {
                 conn.send({ 
                    type: 'WELCOME', 
                    hostId: get().playerId, 
                    hostName: get().playerName, 
                    worldSeed: getSeed(),
                    lastAttackTimestamps: {},
                    pendingHostAttacks: [],
                    guestState: savedState || null,
                    syncLevel: getGameStore()?.getState()?.syncLevel || 1,
                    mainQuestProgress: getGameStore()?.getState()?.mainQuestProgress || null
                 });
               } catch { /* ignore */ }
           });
        });
        // Note: Bulk Sync removed! We now use Lazy REQUEST_CHUNK architecture.
      };

      if (conn.open) {
        onConnectionOpen();
      } else {
        conn.on('open', onConnectionOpen);
      }

      conn.on('data', (data) => {
        if (window.__DEBUG_STATS__) {
           trackPacket(data, 'recv');
           if (data instanceof ArrayBuffer || data instanceof Uint8Array) window.__DEBUG_STATS__.bytesReceived += data.byteLength;
           else if (data instanceof Blob) window.__DEBUG_STATS__.bytesReceived += data.size;
           else {
              try {
                 if (data.type === 'WORLD_SYNC_RLE' && data.rle) window.__DEBUG_STATS__.bytesReceived += data.rle.length * 4 + 100;
                 else window.__DEBUG_STATS__.bytesReceived += JSON.stringify(data).length;
              } catch(_e) {}
           }
        }
        get().handleNetworkData(data, conn);
      });

      conn.on('close', () => {
        console.log('Guest disconnected:', conn.peer);
        set(state => ({ 
          connections: state.connections.filter(c => c.peer !== conn.peer) 
        }));
        
        const guestName = conn.metadata?.playerName || (conn.metadata?.playerId ? `Guest-${conn.metadata.playerId.substring(0,4)}` : 'A guest');
        get().broadcastSystemMessage(`${guestName} left the game.`);
        get().removePlayer(conn.metadata?.playerId);
      });
      
      // If the guest provided their name in the initial metadata, save it!
      if (conn.metadata?.playerId) {
         const guestName = conn.metadata.playerName || `Guest-${conn.metadata.playerId.substring(0,4)}`;
         set(prev => ({
            players: {
               ...prev.players,
               [conn.metadata.playerId]: {
                  ...(prev.players[conn.metadata.playerId] || {}),
                  name: conn.metadata.playerName
               }
            }
         }));
         get().broadcastSystemMessage(`${guestName} joined the game.`);
      } else {
         get().broadcastSystemMessage(`A guest joined the game.`);
      }
    });
    
    peer.on('error', (err) => {
      console.error('Peer error:', err);
      set({ connectionStatus: 'disconnected', connections: [], unreliableConnections: [] });
    });
  },

  // Join a game
  joinGame: async (code) => {
    await get().disconnect(); // FIX: Prevent Zombie Connections
    set({ connectionStatus: 'connecting' });
    
    // FIX: Isolate Guest world into a temporary slot so it doesn't overwrite their Singleplayer world!
    const { clearSlotDB, setDbSlotId } = await import('../utils/db');
    setDbSlotId('multiplayer_guest');
    await clearSlotDB('multiplayer_guest');
    
    const peer = new Peer(undefined, {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' }
        ]
      }
    });
    
    peer.on('open', (_id) => {
      console.log('Guest ready. Connecting to host...');
      
      const hostId = `ws-game-${code.toUpperCase()}`;
      const conn = peer.connect(hostId, {
        metadata: { playerId: get().playerId, playerName: get().playerName }
      });

      const moveConn = peer.connect(hostId, {
        label: 'movement',
        reliable: false,
        metadata: { playerId: get().playerId }
      });

      moveConn.on('open', () => set((_state) => ({ unreliableConnections: [moveConn] })));
      moveConn.on('data', (data) => get().handleNetworkData(data, moveConn));

      conn.on('open', () => {
        console.log('Connected to host, waiting for handshake...');
        
        // Intercept send to count bytes
        const originalSend = conn.send;
        conn.send = (data) => {
          if (window.__DEBUG_STATS__) {
             trackPacket(data, 'sent');
             if (data instanceof ArrayBuffer || data instanceof Uint8Array) window.__DEBUG_STATS__.bytesSent += data.byteLength;
             else if (data instanceof Blob) window.__DEBUG_STATS__.bytesSent += data.size;
             else {
                try { 
                   if (data.type === 'WORLD_SYNC_RLE' && data.rle) window.__DEBUG_STATS__.bytesSent += data.rle.length * 4 + 100;
                   else window.__DEBUG_STATS__.bytesSent += JSON.stringify(data).length; 
                } catch { /* ignore */ }
             }
          }
          originalSend.call(conn, data);
        };

          // Guest Watchdog Timer
          window.__lastPingTime = Date.now();
          const watchdog = setInterval(() => {
             if (get().connectionStatus === 'connected' && window.__lastPingTime) {
                if (Date.now() - window.__lastPingTime > 15000) {
                   console.error("Host Watchdog Timeout! Disconnecting...");
                   sessionStorage.setItem('kickReason', 'Connection to Host lost (Timed Out).');
                   get().disconnect(false);
                   window.location.reload();
                }
             }
          }, 5000);

          set({ peer, isHost: false, roomCode: code.toUpperCase(), connections: [conn], pingInterval: watchdog });
        
        // Phase 2: Ghost Rooms Timeout Failsafe
        setTimeout(() => {
           if (get().connectionStatus === 'connecting') {
              console.error('Handshake timed out! Ghost Room detected.');
              sessionStorage.setItem('kickReason', 'Room Timed Out or Closed. The Host may have left.');
              get().disconnect(false);
              window.location.reload();
           }
        }, 10000); // 10s strict timeout
      });

      conn.on('data', (data) => {
        if (window.__DEBUG_STATS__) {
           trackPacket(data, 'recv');
           if (data instanceof ArrayBuffer || data instanceof Uint8Array) window.__DEBUG_STATS__.bytesReceived += data.byteLength;
           else if (data instanceof Blob) window.__DEBUG_STATS__.bytesReceived += data.size;
           else {
              try {
                 if (data.type === 'WORLD_SYNC_RLE' && data.rle) window.__DEBUG_STATS__.bytesReceived += data.rle.length * 4 + 100;
                 else window.__DEBUG_STATS__.bytesReceived += JSON.stringify(data).length;
              } catch(_e) {}
           }
        }
        get().handleNetworkData(data, conn);
      });

      conn.on('close', () => {
        console.log('Lost connection to host');
        const wasConnected = get().connectionStatus === 'connected';
        set({ connections: [], unreliableConnections: [], connectionStatus: 'disconnected', players: {} });
        if (!get().isHost && wasConnected && !window.__INTENTIONAL_DISCONNECT__) {
           sessionStorage.setItem('kickReason', 'Signal lost. Try again.');
           window.location.reload();
        }
      });
    });

    peer.on('error', (err) => {
      console.error('Peer error:', err);
      set({ connectionStatus: 'disconnected', connections: [], unreliableConnections: [] });
    });
  },

  // Leave game
  disconnect: async (intentional = true) => {
    if (intentional) {
       window.__INTENTIONAL_DISCONNECT__ = true;
    }
    const { peer, connections, unreliableConnections, pingInterval } = get();
    if (pingInterval) clearInterval(pingInterval);
    connections.forEach(c => c.close());
    unreliableConnections.forEach(c => c.close());
    if (peer) peer.destroy();
    
    // Flush WAL BEFORE changing slot prefix to prevent singleplayer chunks saving to guest!
    await flushWAL();
    
    // Restore default slot for Singleplayer
    const { setDbSlotId } = await import('../utils/db');
    setDbSlotId('default');
    
    set({
      peer: null,
      connections: [],
      unreliableConnections: [],
      isHost: true,
      roomCode: null,
      connectionStatus: 'disconnected',
      players: {},
      enemySyncBuffers: {},
      chunkRequests: {},
      pendingChunkRequests: [],
      inFlightChunkRequests: 0,
      pingInterval: null
    });
  },

  processChunkQueue: () => {
     const state = get();
     if (state.inFlightChunkRequests >= state.MAX_CONCURRENT_CHUNK_REQUESTS || state.chunkQueue.length === 0) return;
     
     // Sort pendingChunkRequests by distance to player
     let px = 0, pz = 0;
     const useStore = window.useStore || (typeof getGameStore === 'function' ? getGameStore() : null);
     if (useStore) {
        px = playerPosition.x;
        pz = playerPosition.z;
     }
     
     const sortedQueue = [...state.chunkQueue].sort((a, b) => {
        const [ax, az] = a.chunkKey.split(',').map(Number);
        const [bx, bz] = b.chunkKey.split(',').map(Number);
        const distA = Math.pow(ax * 16 - px, 2) + Math.pow(az * 16 - pz, 2);
        const distB = Math.pow(bx * 16 - px, 2) + Math.pow(bz * 16 - pz, 2);
        return distA - distB;
     });
     
     const nextReq = sortedQueue[0];
     
     set(prev => ({ 
         chunkQueue: prev.chunkQueue.filter(r => r.chunkKey !== nextReq.chunkKey),
         inFlightChunkRequests: prev.inFlightChunkRequests + 1,
         chunkRequests: { ...prev.chunkRequests, [nextReq.chunkKey]: nextReq.resolve }
     }));
     
     const hostConn = get().connections[0];
     
     const sendRequest = (retryCount = 0) => {
        try {
           hostConn.send({ type: 'REQUEST_CHUNK', chunkKey: nextReq.chunkKey });
        } catch(_e) {
           if (retryCount > 3) {
              nextReq.resolve('PRISTINE');
              set(prev => {
                  const next = { ...prev.chunkRequests };
                  delete next[nextReq.chunkKey];
                  return { chunkRequests: next, inFlightChunkRequests: Math.max(0, prev.inFlightChunkRequests - 1) };
              });
              setTimeout(() => get().processChunkQueue(), 0);
              return;
           }
        }
        
        setTimeout(() => {
           const requests = get().chunkRequests;
           if (requests[nextReq.chunkKey]) {
              console.warn(`Chunk request timed out for ${nextReq.chunkKey}. Retrying (${retryCount + 1})...`);
              if (retryCount >= 4) { // Hard limit 5 retries (10s, 20s, 40s...)
                 console.error(`Chunk request FATAL timeout for ${nextReq.chunkKey}. Disconnecting to save data.`);
                 sessionStorage.setItem('kickReason', 'Network Sync Failure: Missing Chunks.');
                 window.location.reload();
                 return;
              }
              sendRequest(retryCount + 1);
           }
        }, 10000 * Math.pow(1.5, retryCount)); // Exponential backoff
     };
     sendRequest();
     
     get().processChunkQueue();
  },

  requestChunkFromHost: (chunkKey) => {
     return new Promise((resolve) => {
        const { connections, isHost } = get();
        if (isHost || connections.length === 0) {
           resolve('PRISTINE');
           return;
        }
        
        set(state => ({ chunkQueue: [...state.chunkQueue, { chunkKey, resolve }] }));
        get().processChunkQueue();
     });
  },

  // Data router
  handleNetworkData: (data, senderConn) => {
    const state = get();
    
    if (data.type === 'PING') {
      window.__lastPingTime = Date.now();
      try { senderConn.send({ type: 'PONG', time: data.time }); } catch { /* ignore */ }
    }
    else if (data.type === 'PONG') {
      if (window.__DEBUG_STATS__) {
         window.__DEBUG_STATS__.ping = Date.now() - data.time;
      }
    }
    else if (data.type === 'WELCOME') {
      // Guest received welcome from host, store host's name and set world seed!
      if (data.worldSeed) {
         setWorldSeed(data.worldSeed);
      }
      
      // If Host sent us a saved profile, inject it into the GameEngine immediately!
      if (data.guestState !== undefined) {
         import('./createPlayerSlice').then(() => {
            if (window.useStore) window.useStore.getState().applyPlayerState(data.guestState);
         });
      }
      
      if (data.mainQuestProgress) {
         const useStore = getGameStore();
         if (useStore && useStore.getState().setMainQuestSync) {
            useStore.getState().setMainQuestSync(data.syncLevel, data.mainQuestProgress);
         }
      }
      
      if (data.hostId && data.hostName) {
         set(prev => ({
            connectionStatus: 'connected', // Boot the guest into the GameEngine now that seed is synced!
            players: {
               ...prev.players,
               [data.hostId]: {
                  ...(prev.players[data.hostId] || {}),
                  name: data.hostName
               }
            }
         }));
      }
    }
    else if (data.type === 'GUEST_SAVE') {
      if (state.isHost) {
         import('idb-keyval').then(({ set: idbSet }) => {
            const prefix = sessionStorage.getItem('saveSlotId') || 'default';
            const guestKey = `${prefix}_guest_${senderConn.metadata?.playerId}`;
            idbSet(guestKey, data.state).catch(e => console.error("Host failed to save guest state", e));
         });
      }
    }
    else if (data.type === 'CHAT_MESSAGE') {
      get().addChatMessage(data.text, 'chat', data.sender);
      if (state.isHost) {
         state.connections.forEach(conn => {
            if (conn.peer !== senderConn.peer) try { conn.send(data); } catch { /* ignore */ }
         });
      }
    }
    else if (data.type === 'SYSTEM_MESSAGE') {
      get().addChatMessage(data.text, 'system', 'System');
    }
    else if (data.type === 'XP_GAIN') {
      const useStore = getGameStore();
                    if (useStore) {
                      if (useStore.getState().addData) {
                        useStore.getState().addData(data.amount);
                      }
         get().addChatMessage(`> Collected ${data.amount} KB Data`, 'system', 'System');
         // Dispatch event for UI audio/pulse
         window.dispatchEvent(new CustomEvent('XP_GAINED', { detail: { amount: data.amount } }));
      }
    }
    else if (data.type === 'WAYPOINT_PING') {
      get().addWaypoint(data.x, data.y, data.z, '#facc15', data.ownerId); // Yellow for guests/others
      if (state.isHost) {
         state.connections.forEach(conn => {
            if (conn.peer !== senderConn.peer) try { conn.send(data); } catch { /* ignore */ }
         });
      }
    }

    else if (data.type === 'MAIN_QUEST_PROGRESS') {
       const useStore = getGameStore();
       if (useStore && useStore.getState().setMainQuestSync && !state.isHost) {
          useStore.getState().setMainQuestSync(data.syncLevel, data.progress);
       }
    }
    else if (data.type === 'MAIN_QUEST_INTENT') {
       if (state.isHost) {
          const useStore = getGameStore();
          if (useStore && useStore.getState().updateObjectiveProgress) {
             useStore.getState().updateObjectiveProgress(data.update.type, data.update.target, data.update.amount);
          }
       }
    }
    else if (data.type === 'SKILL_SYNC') {
       // A player unlocked a skill. We can store this in the player list to render visual effects
       set(prev => ({
          players: {
             ...prev.players,
             [data.playerId]: {
                ...(prev.players[data.playerId] || {}),
                skills: [...((prev.players[data.playerId] || {}).skills || []), data.skillId]
             }
          }
       }));
       if (state.isHost) {
          state.connections.forEach(conn => {
             if (conn.peer !== senderConn.peer) try { conn.send(data); } catch { /* ignore */ }
          });
       }
    }
    else if (data.type === 'INVENTORY_SYNC') {
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
    }
    else if (data.type === 'WORLD_SYNC') {
      const useStore = getGameStore();
      if (useStore) {
        useStore.getState().applyWorldSync({ [data.chunkKey]: data.buffer });
      }
    }
    else if (data.type === 'INVENTORY_INTENT') {
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
    }
    else if (data.type === 'GRANT_ITEM_INTENT') {
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
    }
    else if (data.type === 'SPAWN_LOOT') {
        const useStore = getGameStore();
        if (useStore) {
            useStore.getState().spawnLoot(data);
        }
    }
    else if (data.type === 'DESPAWN_LOOT') {
        const useStore = getGameStore();
        if (useStore) {
            useStore.getState().despawnLoot(data.dropId);
        }
    }
    else if (data.type === 'UPDATE_LOOT_AMOUNT') {
        const useStore = getGameStore();
        if (useStore) {
            useStore.getState().updateLootAmount(data.dropId, data.count);
        }
    }
    else if (data.type === 'LOOT_REJECTED') {
        window.dispatchEvent(new CustomEvent('LOOT_REJECTED', { detail: data.dropId }));
    }
    else if (data.type === 'LOOT_INTENT') {
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
    }
    else if (data.type === 'ATTACK_INTENT') {
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
    }
    else if (data.type === 'COMMAND_INTENT') {
      if (!state.isHost) return;
      const senderId = senderConn.metadata?.playerId;
      if (!senderId) return;
      get().processCommandIntent(data.cmd, data.args, senderId);
    }
    else if (data.type === 'SET_GAMEMODE') {
      const useStore = getGameStore();
      if (useStore) useStore.getState().setGameMode(data.mode);
    }
    else if (data.type === 'TELEPORT') {
      const useStore = getGameStore();
      if (useStore) useStore.getState().executeTeleport(data.pos);
    }
    else if (data.type === 'FORCE_TELEPORT') {
      const useStore = getGameStore();
      if (useStore) {
        useStore.getState().executeTeleport([data.x, data.y, data.z]);
      }
    }
    else if (data.type === 'KICK') {
      sessionStorage.setItem('kickReason', data.reason || 'Kicked from server.');
      window.location.reload();
    }

    else if (data.type === 'REQUEST_CHUNK') {
       if (state.isHost) {
          const useStore = getGameStore();
          if (useStore) {
             const chunk = useChunkStore.getState().chunks[data.chunkKey];
             if (chunk && chunk.isModified && chunk.buffer) {
                 try { senderConn.send({ type: 'WORLD_SYNC_RLE', chunkKey: data.chunkKey, rle: compressRLE(chunk.buffer) }); } catch { /* ignore */ }
             } else if (chunk && !chunk.isModified) {
                 try { senderConn.send({ type: 'CHUNK_PRISTINE', chunkKey: data.chunkKey }); } catch { /* ignore */ }
             } else {
                 import('../utils/db').then(({ loadChunkFromDB }) => {
                    loadChunkFromDB(data.chunkKey).then(dbChunk => {
                       if (dbChunk && dbChunk.isModified && dbChunk.buffer) {
                           try { senderConn.send({ type: 'WORLD_SYNC_RLE', chunkKey: data.chunkKey, rle: compressRLE(dbChunk.buffer) }); } catch { /* ignore */ }
                       } else {
                           try { senderConn.send({ type: 'CHUNK_PRISTINE', chunkKey: data.chunkKey }); } catch { /* ignore */ }
                       }
                    });
                 });
             }
          }
       }
    }
    else if (data.type === 'CHUNK_PRISTINE') {
       const resolver = state.chunkRequests[data.chunkKey];
       if (resolver) {
          resolver('PRISTINE');
          set(prev => {
             const next = { ...prev.chunkRequests };
             delete next[data.chunkKey];
             return { chunkRequests: next, inFlightChunkRequests: Math.max(0, prev.inFlightChunkRequests - 1) };
          });
          get().processChunkQueue();
       }
    }
    else if (data.type === 'WORLD_SYNC_RLE') {
       const resolver = state.chunkRequests[data.chunkKey];
       if (resolver) {
          resolver(decompressRLE(data.rle).buffer);
          set(prev => {
             const next = { ...prev.chunkRequests };
             delete next[data.chunkKey];
             return { chunkRequests: next, inFlightChunkRequests: Math.max(0, prev.inFlightChunkRequests - 1) };
          });
          get().processChunkQueue();
          
          // Process queued deltas
          setTimeout(() => {
              const queued = get().queuedDeltas[data.chunkKey];
              if (queued && queued.length > 0) {
                  const useStore = getGameStore();
                  if (useStore) {
                      queued.forEach(delta => useStore.getState().applyNetworkDelta(data.chunkKey, delta));
                  }
                  set(prev => {
                      const nextQ = { ...prev.queuedDeltas };
                      delete nextQ[data.chunkKey];
                      return { queuedDeltas: nextQ };
                  });
              }
          }, 0);
       } else {
          const useStore = getGameStore();
          if (useStore) {
            useStore.getState().applyWorldSync({ [data.chunkKey]: decompressRLE(data.rle).buffer });
          }
       }
    }
    else if (data.type === 'PLAYER_MOVE') {
      if (state.isHost) {
          const prevData = state.players[data.id];
          if (prevData) {
             const dx = data.x - prevData.x;
             const dy = data.y - prevData.y;
             const dz = data.z - prevData.z;
             const distSq = dx*dx + dy*dy + dz*dz;
             
             // Sanity Check: Prevent teleport hacks. Max 3 blocks per tick (60 blk/sec).
             if (distSq > 9) {
                 console.warn(`[SECURITY] Player ${data.id} moved illegally! Rubber-banding.`);
                 const reliableConn = state.connections.find(c => c.peer === senderConn.peer);
                 if (reliableConn) {
                     try {
                        reliableConn.send({
                           type: 'FORCE_TELEPORT',
                           x: prevData.x,
                           y: prevData.y,
                           z: prevData.z
                        });
                     } catch { /* ignore */ }
                 }
                 return; // Reject packet entirely
             }
          }
      }

      set(prev => {
        const currentBuffer = prev.players[data.id]?.positionBuffer || [];
        const newSnapshot = { 
           pos: [data.x, data.y, data.z], 
           rot: [data.rx, data.ry, data.rz], 
           timestamp: Date.now() 
        };
        const newBuffer = [...currentBuffer, newSnapshot].slice(-20); // Keep 1 second of history at 20Hz
        
        return {
          players: {
            ...prev.players,
            [data.id]: {
              ...(prev.players[data.id] || {}),
              x: data.x, y: data.y, z: data.z,
              rx: data.rx, ry: data.ry, rz: data.rz,
              name: data.name || prev.players[data.id]?.name,
              lastUpdate: Date.now(),
              positionBuffer: newBuffer
            }
          }
        };
      });
      
      // If we are host, broadcast this movement to OTHER guests so everyone sees each other
      if (state.isHost) {
        get().unreliableConnections.forEach(conn => {
          if (conn.peer !== senderConn.peer) {
            try { conn.send(data); } catch { /* ignore */ }
          }
        });
      }
    }
    else if (data.type === 'TIME_SYNC') {
       useEnvironmentStore.getState().setWorldTime(data.worldTime, data.daysElapsed);
       // Host rebroadcasts to any other guests
       if (state.isHost) {
          get().connections.forEach(conn => {
             if (conn.peer !== senderConn.peer) try { conn.send(data); } catch { /* ignore */ }
          });
       }
    }
    else if (data.type === 'ACTION_INTENT') {
       const useStore = getGameStore();
       if (useStore) {
           if (data.action === 'REMOVE_ITEM') {
             useInventoryStore.setState(prev => ({ droppedItems: prev.droppedItems.filter(i => i.key !== data.key) }));
           } else if (data.action === 'UPDATE_ITEM_COUNT') {
              useInventoryStore.setState(prev => ({
                 droppedItems: prev.droppedItems.map(i => i.key === data.key ? { ...i, count: data.count } : i)
              }));
           } else if (data.action === 'REMOVE_BULLET') {
              useStore.setState(prev => ({ bullets: (prev.bullets || []).filter(b => b.key !== data.key) }));
           } else if (data.action === 'REMOVE_TOMBSTONE') {
              useInventoryStore.setState(prev => ({ tombstones: (prev.tombstones || []).filter(t => t.id !== data.key) }));
           } else if (data.action === 'AREA_DAMAGE') {
              const id = Date.now() + Math.random().toString();
              useStore.setState(prev => ({
                 damageQueue: [...(prev.damageQueue || []), { id, pos: data.pos, radius: data.radius, amount: data.amount, timestamp: Date.now() }]
              }));
              setTimeout(() => useStore.getState().shiftDamageQueue(id), 500);
           }
       }
       if (state.isHost) {
         get().connections.forEach(conn => {
            if (conn.peer !== senderConn.peer) try { conn.send(data); } catch { /* ignore */ }
         });
       }
    }
    else if (data.type === 'TAKE_DAMAGE') {
       if (state.isHost) {
          const currentHP = state.guestHealthMap[data.id] ?? 100;
          const newHP = Math.max(0, currentHP - data.amount);
          
          set(prev => ({ guestHealthMap: { ...prev.guestHealthMap, [data.id]: newHP } }));
          
          if (newHP <= 0) {
             console.log(`[SERVER] Guest ${data.id} died! Triggering Death Sequence.`);
             
             // 1. Broadcast death animation event
             get().connections.forEach(conn => {
                try { conn.send({ type: 'PLAYER_DIED', id: data.id }); } catch { /* ignore */ }
             });
             
             // 2. Force teleport the dead guest back to spawn
             try {
                senderConn.send({ type: 'FORCE_TELEPORT', x: 0, y: 260, z: 0 });
             } catch { /* ignore */ }
             
             // 3. Drop Tombstone Entity with Guest's Inventory
             const useStore = getGameStore();
             if (useStore) {
                 let spawnY = data.deathPos[1];
                 if (typeof useStore.getState().findSafeSpawnY === 'function') {
                     const groundY = useStore.getState().findSafeSpawnY(data.deathPos[0], data.deathPos[2]);
                     if (groundY !== 400 && groundY > 0) {
                         spawnY = groundY - 0.5;
                     }
                 }
                 
                 useStore.getState().addTombstone({
                    id: `tombstone_${data.id}_${Date.now()}`,
                    pos: [data.deathPos[0], spawnY, data.deathPos[2]], // Adjusted height
                    inventory: data.inventory || [], // The items they dropped
                    ownerName: state.players[data.id]?.name || 'Unknown'
                 });
             }
             
             // 4. Reset Host-side health
             set(prev => ({ guestHealthMap: { ...prev.guestHealthMap, [data.id]: 100 } }));
          }
       }
    }
    else if (data.type === 'PLAYER_DIED') {
       // Display death animation / chat message for the player who died
       const diedPlayer = state.players[data.id]?.name || 'A player';
       get().addChatMessage(`${diedPlayer} died!`, 'system', 'System');
       
       // Note: If THIS client is the one who died, their local useStore will handle the UI
    }
    else if (data.type === 'BLOCK_DELTA') {
      // Handled in WorldSlice later
      // The network store receives the message and pushes it into the game state
      const useStore = getGameStore();
      if (useStore) {
        useStore.getState().applyNetworkDelta(data.chunkKey, data.deltas);
      }
      
      // Host rebroadcasts delta to other clients
      if (state.isHost) {
         get().connections.forEach(conn => {
            if (conn.peer !== senderConn.peer) {
               try { conn.send(data); } catch { /* ignore */ }
            }
         });
      }
    }
    else if (data.type === 'ENTITY_SPAWN_EVENT') {
       const useStore = getGameStore();
       if (useStore) {
           if (data.entityType === 'droppedItem') {
              // Directly add to store to trigger local physics simulation
              useInventoryStore.setState(prev => {
                 const newDrops = [...(prev.droppedItems || []), { key: data.key, pos: data.pos, texture: data.texture }];
                 return { droppedItems: newDrops.length > 1000 ? newDrops.slice(-1000) : newDrops };
              });
           } else if (data.entityType === 'flare') {
             useStore.getState().placeFlare(data.pos, data.color);
          } else if (data.entityType === 'bullet') {
             useStore.setState(prev => ({ bullets: [...prev.bullets, data.bullet] }));
           } else if (data.entityType === 'tombstone') {
             useInventoryStore.setState(prev => ({ tombstones: [...(prev.tombstones || []), data.tombstone] }));
          }
       }
       // Host rebroadcast
       if (state.isHost) {
          get().connections.forEach(conn => {
             if (conn.peer !== senderConn.peer) {
                try { conn.send(data); } catch { /* ignore */ }
             }
          });
       }
    }

    else if (data instanceof ArrayBuffer || data instanceof Uint8Array || data instanceof Blob) {
       // --- BINARY PACKET PARSING ---
       
       // Handle Blob (some browsers give Blobs instead of ArrayBuffers via WebRTC)
       if (data instanceof Blob) {
          data.arrayBuffer().then(buffer => state.handleNetworkData(buffer, senderConn));
          return;
       }
       
       // Edge Case: If data is a Uint8Array view into a larger pooled ArrayBuffer,
       // we MUST slice it to ensure our byte offsets (0, 4, 12, etc) are correctly aligned.
       const buffer = data instanceof Uint8Array 
          ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) 
          : data;
          
       const view = new DataView(buffer);
       const packetType = view.getUint8(0);
       
       if (!window.__seqCache) window.__seqCache = {};
       
       if (packetType === 1) { // PLAYER_MOVE
          const seq = view.getUint16(61, true);
          const cacheKey = `${senderConn.peer}_1`;
          const lastSeq = window.__seqCache[cacheKey] || 0;
          // Handle 16-bit sequence wrapping (e.g., 65535 -> 0)
          if (seq < lastSeq && lastSeq - seq < 32768) return; // Out of order, discard
          window.__seqCache[cacheKey] = seq;

          // Byte 1-36: ID String
          let id = "";
          for (let i = 0; i < 36; i++) {
             const charCode = view.getUint8(1 + i);
             if (charCode !== 0) id += String.fromCharCode(charCode);
          }
          
          const x = view.getFloat32(37, true);
          const y = view.getFloat32(41, true);
          const z = view.getFloat32(45, true);
          const rx = view.getFloat32(49, true);
          const ry = view.getFloat32(53, true);
          const rz = view.getFloat32(57, true);
          
          set(prev => {
             const currentBuffer = prev.players[id]?.positionBuffer || [];
             const lastTime = currentBuffer.length > 0 ? currentBuffer[currentBuffer.length - 1].timestamp : Date.now() - 50;
             // Smooth jitter: assume 50ms pacing, but resync if drift exceeds 250ms
             let newTimestamp = lastTime + 50;
             if (Math.abs(newTimestamp - Date.now()) > 250) newTimestamp = Date.now();
             
             const newSnapshot = { 
                pos: [x, y, z], 
                rot: [rx, ry, rz], 
                timestamp: newTimestamp 
             };
             const newBuffer = [...currentBuffer, newSnapshot].slice(-20);
             
             return {
                players: {
                   ...prev.players,
                   [id]: {
                      ...prev.players[id],
                      x, y, z, rx, ry, rz,
                      positionBuffer: newBuffer,
                      lastUpdate: Date.now()
                   }
                }
             };
          });
          
          if (state.isHost) {
            get().unreliableConnections.forEach(conn => {
              if (conn.peer !== senderConn.peer) try { conn.send(buffer); } catch { /* ignore */ }
            });
          }
       }
       else if (packetType === 2) { // BLOCK_DELTA
           const cx = view.getInt32(4, true);
           const cz = view.getInt32(8, true);
           const chunkKey = `${cx},${cz}`;
           
           // Deltas start at byte 12
           const deltas = new Uint32Array(buffer, 12);
           
           // If chunk is in flight, queue the delta!
           if (get().chunkRequests[chunkKey]) {
               set(prev => ({
                   queuedDeltas: {
                       ...prev.queuedDeltas,
                       [chunkKey]: [...(prev.queuedDeltas[chunkKey] || []), deltas]
                   }
               }));
           } else {
               const useStore = getGameStore();
               if (useStore) {
                 useStore.getState().applyNetworkDelta(chunkKey, deltas);
               }
           }
           
           if (state.isHost) {
              get().connections.forEach(conn => {
                 if (conn.peer !== senderConn.peer) try { conn.send(buffer); } catch { /* ignore */ }
              });
           }
        }
       else if (packetType === 3) { // ENTITY_STATE_SYNC
          const seq = view.getUint16(4, true);
          const subType = view.getUint8(1);
          
          const cacheKey = `${senderConn.peer}_3_${subType}`;
          const lastSeq = window.__seqCache[cacheKey] || 0;
          if (seq < lastSeq && lastSeq - seq < 32768) return; // Discard older packets
          window.__seqCache[cacheKey] = seq;

          const count = view.getUint16(2, true);
          
          const entities = [];
          for (let i = 0; i < count; i++) {
             const offset = 6 + (i * 24);
             entities.push({
                id: view.getUint16(offset, true),
                mode: view.getUint8(offset + 2),
                health: view.getFloat32(offset + 4, true),
                x: view.getFloat32(offset + 8, true),
                y: view.getFloat32(offset + 12, true),
                z: view.getFloat32(offset + 16, true),
                yaw: view.getFloat32(offset + 20, true)
             });
          }
          
          set(prev => ({
             enemySyncBuffers: {
                ...prev.enemySyncBuffers,
                [subType]: entities
             }
          }));
          
          if (state.isHost) {
             get().unreliableConnections.forEach(conn => {
                if (conn.peer !== senderConn.peer) try { conn.send(buffer); } catch { /* ignore */ }
             });
          }
       }
    }
  },

  broadcastMovement: (() => {
    const buffer = new ArrayBuffer(64);
    const view = new DataView(buffer);
    return (playerId, x, y, z, rx, ry, rz) => {
      // Phase 2: NaN Network Contagion Preventer
      if (
        !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) ||
        !Number.isFinite(rx) || !Number.isFinite(ry) || !Number.isFinite(rz)
      ) {
        console.warn('[Network Sanitizer] Dropped outbound movement packet containing NaN');
        return;
      }
  
      const { unreliableConnections } = get();
      if (!unreliableConnections || unreliableConnections.length === 0) return;
      
      view.setUint8(0, 1);
      for (let i = 0; i < 36; i++) {
         view.setUint8(1 + i, i < playerId.length ? playerId.charCodeAt(i) : 0);
      }
      
      view.setFloat32(37, x, true);
      view.setFloat32(41, y, true);
      view.setFloat32(45, z, true);
      view.setFloat32(49, rx, true);
      view.setFloat32(53, ry, true);
      view.setFloat32(57, rz, true);
      
      if (typeof window.__packetSeq === 'undefined') window.__packetSeq = 0;
      view.setUint16(61, window.__packetSeq++, true);
      
      const state = get();
      unreliableConnections.forEach(conn => {
         const guestId = conn.metadata?.playerId;
         if (guestId && state.players[guestId]) {
            const guestPos = state.players[guestId];
            const dx = guestPos.x - x;
            const dy = guestPos.y - y;
            const dz = guestPos.z - z;
            const distSq = dx*dx + dy*dy + dz*dz;
            
            if (distSq > 16384) { // > 128 blocks away: CULL
               return; 
            }
            if (distSq > 1024) { // > 32 blocks away: THROTTLE (1 in 4)
               if (Math.random() > 0.25) return;
            }
         }
         
         try { conn.send(buffer); } catch(_e) {}
      });
    };
  })(),

  broadcastEntityState: (subType, entities) => {
    const { unreliableConnections, isHost } = get();
    if (unreliableConnections.length === 0 || !isHost) return;
    
    const count = entities.length;
    const buffer = new ArrayBuffer(6 + (count * 24));
    const view = new DataView(buffer);
    
    view.setUint8(0, 3); // Type 3: ENTITY_STATE_SYNC
    view.setUint8(1, subType);
    view.setUint16(2, count, true);
    
    if (typeof window.__packetSeq === 'undefined') window.__packetSeq = 0;
    view.setUint16(4, window.__packetSeq++, true);
    
    for (let i = 0; i < count; i++) {
       const offset = 6 + (i * 24);
       const ent = entities[i];
       view.setUint16(offset, ent.id, true);
       view.setUint8(offset + 2, ent.mode);
       view.setFloat32(offset + 4, ent.health, true);
       view.setFloat32(offset + 8, ent.x, true);
       view.setFloat32(offset + 12, ent.y, true);
       view.setFloat32(offset + 16, ent.z, true);
       view.setFloat32(offset + 20, ent.yaw, true);
    }
    
    unreliableConnections.forEach(conn => {
       try { conn.send(buffer); } catch(_e) {}
    });
  },
  
  broadcastEvent: (data) => {
    const { connections } = get();
    if (connections.length === 0) return;
    connections.forEach(conn => {
      try { conn.send(data); } catch(_e) {}
    });
  },
  
  broadcastDelta: (chunkKey, deltas) => {
     const { connections } = get();
     if (connections.length === 0) return;
     
     if (!window.__PENDING_DELTAS) window.__PENDING_DELTAS = {};
     if (!window.__PENDING_DELTAS[chunkKey]) window.__PENDING_DELTAS[chunkKey] = [];
     
     window.__PENDING_DELTAS[chunkKey].push(...deltas);
     
     if (!window.__DELTA_TIMER) {
        window.__DELTA_TIMER = setTimeout(() => {
           const { connections } = get();
           if (connections.length > 0) {
               for (const ck in window.__PENDING_DELTAS) {
                  const deltaPayload = window.__PENDING_DELTAS[ck];
                  if (deltaPayload && deltaPayload.length > 0) {
                     const [cx, cz] = ck.split(',').map(Number);
                     
                     // Binary Packet Structure:
                     // 0: Type (2)
                     // 1-3: Padding
                     // 4-7: cx (Int32)
                     // 8-11: cz (Int32)
                     // 12+: Uint32Array deltas
                     const buffer = new ArrayBuffer(12 + deltaPayload.length * 4);
                     const view = new DataView(buffer);
                     view.setUint8(0, 2);
                     view.setInt32(4, cx, true);
                     view.setInt32(8, cz, true);
                     
                     const uint32View = new Uint32Array(buffer, 12);
                     uint32View.set(deltaPayload);
                     
                     connections.forEach(conn => {
                        try {
                           conn.send(buffer);
                        } catch(err) {
                           console.error('Failed to broadcast delta chunk:', err);
                        }
                     });
                     delete window.__PENDING_DELTAS[ck];
                  }
               }
           }
           window.__PENDING_DELTAS = {};
           window.__DELTA_TIMER = null;
        }, 0);
     }
  },

  removePlayer: (id) => set(state => {
    const newPlayers = { ...state.players };
    delete newPlayers[id];
    return { players: newPlayers };
  }),
  
  cullDeadConnection: (id) => {
     const state = get();
     const p = state.players[id];
     if (p) {
        const pName = p.name || `Guest-${id.substring(0,4)}`;
        if (state.isHost) state.broadcastSystemMessage(`${pName} timed out.`);
     }
     
     get().removePlayer(id);
     if (get().isHost) {
         set(state => {
             const deadConns = state.connections.filter(c => c.metadata?.playerId === id);
             deadConns.forEach(c => {
                 try { c.close(); } catch { /* ignore */ }
             });
             return {
                 connections: state.connections.filter(c => c.metadata?.playerId !== id)
             };
         });
     }
  }
  };
});

window.networkActions = networkActions;

setNetworkStore(networkActions);

const originalGetState = networkActions.getState;
baseGetState = originalGetState;
networkActions.getState = () => stateProxy;

const originalSubscribe = networkActions.subscribe;
networkActions.subscribe = (listener) => {
  const unsubBase = originalSubscribe(listener);
  const unsubChat = useChatStore.subscribe(listener);
  const unsubSync = useSyncStore.subscribe(listener);
  const unsubConn = useConnectionStore.subscribe(listener);
  return () => {
    unsubBase();
    unsubChat();
    unsubSync();
    unsubConn();
  };
};

const originalSetState = networkActions.setState;
networkActions.setState = (updater) => {
  const prevState = networkActions.getState();
  const rawPatch = typeof updater === 'function' ? updater(prevState) : updater;
  if (!rawPatch) return;
  const patch = { ...rawPatch };
  
  if (patch.chatMessages !== undefined) {
    useChatStore.setState({ chatMessages: patch.chatMessages });
    delete patch.chatMessages;
  }
  if (patch.isTyping !== undefined) {
    useChatStore.setState({ isTyping: patch.isTyping });
    delete patch.isTyping;
  }
  if (patch.players !== undefined) {
    useSyncStore.setState({ players: patch.players });
    delete patch.players;
  }
  if (patch.guestHealthMap !== undefined) {
    useSyncStore.setState({ guestHealthMap: patch.guestHealthMap });
    delete patch.guestHealthMap;
  }
  if (patch.enemySyncBuffers !== undefined) {
    useSyncStore.setState({ enemySyncBuffers: patch.enemySyncBuffers });
    delete patch.enemySyncBuffers;
  }
  if (patch.queuedDeltas !== undefined) {
    useSyncStore.setState({ queuedDeltas: patch.queuedDeltas });
    delete patch.queuedDeltas;
  }
  if (patch.waypoints !== undefined) {
    useSyncStore.setState({ waypoints: patch.waypoints });
    delete patch.waypoints;
  }
  
  const connectionKeys = ['peer', 'connections', 'unreliableConnections', 'isHost', 'roomCode', 'playerName', 'connectionStatus', 'playerId', 'mods', 'pendingHostAttacks', 'chunkRequests', 'chunkQueue', 'inFlightChunkRequests'];
  const connectionPatch = {};
  for (const key of connectionKeys) {
     if (patch[key] !== undefined) {
        connectionPatch[key] = patch[key];
        delete patch[key];
     }
  }
  if (Object.keys(connectionPatch).length > 0) {
     useConnectionStore.setState(connectionPatch);
  }

  if (Object.keys(patch).length > 0) {
    originalSetState(patch);
  }
};

// --- Telemetry Hook ---
const telemetryInterval = setInterval(() => {
  if (window.__DEBUG_STATS__) {
    const state = networkActions.getState();
    window.__DEBUG_STATS__.netRequests = Object.keys(state.chunkRequests || {}).length;
  }
}, 200);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    clearInterval(telemetryInterval);
  });
}


