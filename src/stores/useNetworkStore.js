import { getGameStore, setNetworkStore } from './storeLinker';
import { create } from 'zustand';
import Peer from 'peerjs';
import { getSeed, setWorldSeed } from '../worldSeed';
import { compressRLE, decompressRLE, flushWAL } from '../utils/db';
import { playerPosition } from '../globals';

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

export const useNetworkStore = create((set, get) => ({
  peer: null,
  connections: [], // List of active DataChannels
  unreliableConnections: [], // Fast UDP-like channels for movement
  isHost: true,
  roomCode: null,
  playerName: '',
  setPlayerName: (name) => set({ playerName: name }),
  connectionStatus: 'disconnected', // disconnected, connecting, connected
  playerId: localStorage.getItem('ws_playerId') || (() => {
     const newId = Math.random().toString(36).substring(2, 9);
     localStorage.setItem('ws_playerId', newId);
     return newId;
  })(),
  players: {}, // { id: { x, y, z, rx, ry, rz, name, ping } }
  guestHealthMap: {}, // { id: 100 } — Host authoritative health tracking
  enemySyncBuffers: {}, // { subType: [ {id, mode, health, x, y, z, yaw }, ... ] }
  
  pendingHostAttacks: [],
  popPendingAttacks: () => {
     const queue = get().pendingHostAttacks;
     if (queue.length === 0) return [];
     set({ pendingHostAttacks: [] });
     return queue;
  },
  
  pendingChunkRequests: [], // queue of { chunkKey, resolve }
  inFlightChunkRequests: 0,
  
  // Chat & Notification State
  chatMessages: [], // { id, text, type: 'chat'|'system', sender, timestamp }
  isTyping: false,
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
  
  // Waypoint System
  waypoints: [], // { id, x, y, z, color, timestamp }
  addWaypoint: (x, y, z, color, ownerId) => set(state => {
     const newWp = { id: ownerId, x, y, z, color, timestamp: Date.now() };
     const filtered = state.waypoints.filter(w => w.id !== ownerId);
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
    
    peer.on('open', (id) => {
      console.log('Host ready. Room Code:', code);
      set({ peer, isHost: true, roomCode: code, connectionStatus: 'connected' });
      
      // Ping interval
      const pingInterval = setInterval(() => {
         get().connections.forEach(conn => {
            try { conn.send({ type: 'PING', time: Date.now() }); } catch(e) {}
         });
      }, 5000);
      set({ pingInterval });
    });

    peer.on('connection', (conn) => {
      if (conn.label === 'movement') {
        const onMoveOpen = () => set(state => ({ unreliableConnections: [...state.unreliableConnections, conn] }));
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
                    lockedSlots: new Set(),
                    lastAttackTimestamps: {},
                    pendingHostAttacks: [],
                    guestState: savedState || null
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
              } catch(e) {}
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
    sessionStorage.setItem('saveSlotId', 'multiplayer_guest');
    const { clearSlotDB } = await import('../utils/db');
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
    
    peer.on('open', (id) => {
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

      moveConn.on('open', () => set(state => ({ unreliableConnections: [moveConn] })));
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

        set({ peer, isHost: false, roomCode: code.toUpperCase(), connections: [conn] });
        
        // Timeout if Host fails to send WELCOME handshake
        setTimeout(() => {
           if (get().connectionStatus === 'connecting') {
              console.error('Handshake timed out!');
              sessionStorage.setItem('kickReason', 'Connection Failed: Invalid room code or Host unreachable.');
              get().disconnect(false);
              window.location.reload();
           }
        }, 20000);
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
              } catch(e) {}
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
    sessionStorage.setItem('saveSlotId', 'default');
    
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
     if (state.inFlightChunkRequests >= 2 || state.pendingChunkRequests.length === 0) return;
     
     // Sort pendingChunkRequests by distance to player
     let px = 0, pz = 0;
     const useStore = window.useStore || (typeof getGameStore === 'function' ? getGameStore() : null);
     if (useStore) {
        const playerPos = useStore.getState().playerPos;
        if (playerPos) { px = playerPos[0]; pz = playerPos[2]; }
     }
     
     const sortedQueue = [...state.pendingChunkRequests].sort((a, b) => {
        const [ax, az] = a.chunkKey.split(',').map(Number);
        const [bx, bz] = b.chunkKey.split(',').map(Number);
        const distA = Math.pow(ax * 16 - px, 2) + Math.pow(az * 16 - pz, 2);
        const distB = Math.pow(bx * 16 - px, 2) + Math.pow(bz * 16 - pz, 2);
        return distA - distB;
     });
     
     const nextReq = sortedQueue[0];
     
     set(prev => ({ 
         pendingChunkRequests: prev.pendingChunkRequests.filter(r => r.chunkKey !== nextReq.chunkKey),
         inFlightChunkRequests: prev.inFlightChunkRequests + 1,
         chunkRequests: { ...prev.chunkRequests, [nextReq.chunkKey]: nextReq.resolve }
     }));
     
     const hostConn = get().connections[0];
     try {
        hostConn.send({ type: 'REQUEST_CHUNK', chunkKey: nextReq.chunkKey });
     } catch(e) {
        nextReq.resolve('PRISTINE');
        set(prev => {
            const next = { ...prev.chunkRequests };
            delete next[nextReq.chunkKey];
            return { chunkRequests: next, inFlightChunkRequests: Math.max(0, prev.inFlightChunkRequests - 1) };
        });
        setTimeout(() => get().processChunkQueue(), 0);
        return;
     }
     
     setTimeout(() => {
        const requests = get().chunkRequests;
        if (requests[nextReq.chunkKey]) {
           console.warn("Chunk request timed out for", nextReq.chunkKey);
           requests[nextReq.chunkKey]('PRISTINE');
           set(prev => {
              const next = { ...prev.chunkRequests };
              delete next[nextReq.chunkKey];
              return { chunkRequests: next, inFlightChunkRequests: Math.max(0, prev.inFlightChunkRequests - 1) };
           });
           get().processChunkQueue();
        }
     }, 10000);
     
     get().processChunkQueue();
  },

  requestChunkFromHost: (chunkKey) => {
     return new Promise((resolve) => {
        const { connections, isHost } = get();
        if (isHost || connections.length === 0) {
           resolve('PRISTINE');
           return;
        }
        
        set(state => ({ pendingChunkRequests: [...state.pendingChunkRequests, { chunkKey, resolve }] }));
        get().processChunkQueue();
     });
  },

  // Data router
  handleNetworkData: (data, senderConn) => {
    const state = get();
    
    if (data.type === 'PING') {
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
    else if (data.type === 'WAYPOINT_PING') {
      get().addWaypoint(data.x, data.y, data.z, '#facc15', data.ownerId); // Yellow for guests/others
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
           if (data.authoritativeInventories) {
               useStore.setState({ authoritativeInventories: data.authoritativeInventories });
               // If we are a Guest, snap our local inventory prediction to the Host's authority
               const myId = get().playerId;
               if (data.authoritativeInventories[myId]) {
                   useStore.setState({ inventory: data.authoritativeInventories[myId] });
               }
           }
           if (data.chests) {
               useStore.setState({ chests: data.chests });
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

       // 1. Generate Lock Keys
       const getLockKey = (loc) => {
          if (!loc) return null;
          if (loc.type === 'player') return `player_${loc.id}_slot_${loc.slot}`;
          if (loc.type === 'container') return `container_${loc.id}_slot_${loc.slot}`;
          return null;
       };
       
       const srcKey = getLockKey(data.source);
       const dstKey = getLockKey(data.destination);
       
       const keysToLock = [];
       if (srcKey) keysToLock.push(srcKey);
       if (dstKey) keysToLock.push(dstKey);
       
       // 2. Attempt Mutex Lock
       if (!get().lockSlots(keysToLock)) {
           // Collision! Send rejection sync
           try { senderConn.send({ type: 'INVENTORY_SYNC', reason: 'LOCKED' }); } catch { /* ignore */ }
           return;
       }
       
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
               // Broadcast success sync (Host broadcasts authoritative state to all peers)
               get().broadcastEvent({ 
                   type: 'INVENTORY_SYNC',
                   authoritativeInventories: useStore.getState().authoritativeInventories,
                   chests: useStore.getState().chests
               });
           }
           
       } catch (err) {
           console.warn("Transaction Rejected:", err.message);
           try { senderConn.send({ type: 'INVENTORY_SYNC', reason: 'VALIDATION_FAILED' }); } catch { /* ignore */ }
       } finally {
           // 5. Release Mutex Locks NO MATTER WHAT
           get().unlockSlots(keysToLock);
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

        // 1. Generate Lock Key
        const lockKey = `drop_${data.dropId}`;
        
        // 2. Attempt Mutex Lock
        if (!get().lockSlots([lockKey])) {
            return; // Collision or already looted
        }
        
        try {
            const useStore = getGameStore();
            if (!useStore) throw new Error("Store unavailable");
            const wState = useStore.getState();
            
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
            console.warn("Loot Rejected:", err.message);
            // Send rejection to reset visual tween
            if (senderId === state.playerId) {
                window.dispatchEvent(new CustomEvent('LOOT_REJECTED', { detail: data.dropId }));
            } else {
                try { senderConn.send({ type: 'LOOT_REJECTED', dropId: data.dropId }); } catch { /* ignore */ }
            }
        } finally {
            // Unlock! Wait, if looted successfully, we delete it anyway.
            get().unlockSlots([lockKey]);
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

    else if (data.type === 'REQUEST_CHUNK') {
       if (state.isHost) {
          const useStore = getGameStore();
          if (useStore) {
             const chunk = useStore.getState().chunks[data.chunkKey];
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
             
             // Sanity Check: Prevent teleport hacks. Max ~10 blocks per tick (200 blk/sec).
             if (distSq > 100) {
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
       const useStore = getGameStore();
       if (useStore) {
          useStore.getState().setWorldTime(data.worldTime, data.daysElapsed);
       }
       // Host rebroadcasts to any other guests
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
                 useStore.getState().addTombstone({
                    id: `tombstone_${data.id}_${Date.now()}`,
                    pos: data.deathPos, // Supplied by the client's last known location
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
             useStore.setState(prev => {
                const newDrops = [...(prev.droppedItems || []), { key: data.key, pos: data.pos, texture: data.texture }];
                return { droppedItems: newDrops.length > 1000 ? newDrops.slice(-1000) : newDrops };
             });
          } else if (data.entityType === 'flare') {
             useStore.getState().placeFlare(data.pos, data.color);
          } else if (data.entityType === 'bullet') {
             useStore.setState(prev => ({ bullets: [...prev.bullets, data.bullet] }));
          } else if (data.entityType === 'tombstone') {
             useStore.setState(prev => ({ tombstones: [...(prev.tombstones || []), data.tombstone] }));
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
    else if (data.type === 'ACTION_INTENT') {
       const useStore = getGameStore();
       if (useStore) {
          if (data.action === 'REMOVE_ITEM') {
             useStore.setState(prev => ({ droppedItems: prev.droppedItems.filter(i => i.key !== data.key) }));
          } else if (data.action === 'UPDATE_ITEM_COUNT') {
             useStore.setState(prev => ({
                droppedItems: prev.droppedItems.map(i => i.key === data.key ? { ...i, count: data.count } : i)
             }));
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
       
       if (packetType === 1) { // PLAYER_MOVE
          // Byte 1-7: ID String
          let id = "";
          for (let i = 0; i < 7; i++) {
             const charCode = view.getUint8(1 + i);
             if (charCode !== 0) id += String.fromCharCode(charCode);
          }
          
          const x = view.getFloat32(8, true);
          const y = view.getFloat32(12, true);
          const z = view.getFloat32(16, true);
          const rx = view.getFloat32(20, true);
          const ry = view.getFloat32(24, true);
          const rz = view.getFloat32(28, true);
          
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
          
          const useStore = getGameStore();
          if (useStore) {
            useStore.getState().applyNetworkDelta(chunkKey, deltas);
          }
          
          if (state.isHost) {
             get().connections.forEach(conn => {
                if (conn.peer !== senderConn.peer) try { conn.send(buffer); } catch { /* ignore */ }
             });
          }
       }
       else if (packetType === 3) { // ENTITY_STATE_SYNC
          const subType = view.getUint8(1);
          const count = view.getUint16(2, true);
          
          const entities = [];
          for (let i = 0; i < count; i++) {
             const offset = 4 + (i * 24);
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

  broadcastMovement: (x, y, z, rx, ry, rz) => {
    const { unreliableConnections, playerId } = get();
    if (unreliableConnections.length === 0) return;
    
    // Binary Packet Structure (32 bytes):
    // 0: Type (1)
    // 1-7: ID string ASCII bytes
    // 8-31: x, y, z, rx, ry, rz (Float32)
    const buffer = new ArrayBuffer(32);
    const view = new DataView(buffer);
    
    view.setUint8(0, 1);
    for (let i = 0; i < Math.min(playerId.length, 7); i++) {
       view.setUint8(1 + i, playerId.charCodeAt(i));
    }
    
    view.setFloat32(8, x, true);
    view.setFloat32(12, y, true);
    view.setFloat32(16, z, true);
    view.setFloat32(20, rx, true);
    view.setFloat32(24, ry, true);
    view.setFloat32(28, rz, true);
    
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
       
       try { conn.send(buffer); } catch(e) {}
    });
  },

  broadcastEntityState: (subType, entities) => {
    const { unreliableConnections, isHost } = get();
    if (unreliableConnections.length === 0 || !isHost) return;
    
    const count = entities.length;
    const buffer = new ArrayBuffer(4 + (count * 24));
    const view = new DataView(buffer);
    
    view.setUint8(0, 3); // Type 3: ENTITY_STATE_SYNC
    view.setUint8(1, subType);
    view.setUint16(2, count, true);
    
    for (let i = 0; i < count; i++) {
       const offset = 4 + (i * 24);
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
       try { conn.send(buffer); } catch(e) {}
    });
  },
  
  broadcastEvent: (data) => {
    const { connections } = get();
    if (connections.length === 0) return;
    connections.forEach(conn => {
      try { conn.send(data); } catch(e) {}
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
                        } catch (e) {
                           console.error('Failed to broadcast delta chunk:', e);
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
}));

window.useNetworkStore = useNetworkStore;


setNetworkStore(useNetworkStore);

// --- Telemetry Hook ---
setInterval(() => {
  if (window.__DEBUG_STATS__) {
    const state = useNetworkStore.getState();
    window.__DEBUG_STATS__.netRequests = Object.keys(state.chunkRequests || {}).length;
  }
}, 200);
