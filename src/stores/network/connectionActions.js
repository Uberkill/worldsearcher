import Peer from 'peerjs';
import { getSeed } from '../../worldSeed';
import { flushWAL } from '../../utils/db';
import { playerPosition, playerRotation } from '../../globals';
import { getGameStore } from '../storeLinker';

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

export const createConnectionActions = (set, get) => ({
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
         const useStore = getGameStore();
         if (useStore && useStore.getState().shipHelmPlayerId === id) {
             get().handleNetworkData({ type: 'RELEASE_HELM', playerId: id });
         }
         set(state => {
             const deadConns = state.connections.filter(c => c.metadata?.playerId === id);
             deadConns.forEach(c => {
                 try { c.close(); } catch(e) { console.warn("[Network] Dropped packet/action:", e.message); }
             });
             return {
                 connections: state.connections.filter(c => c.metadata?.playerId !== id)
             };
         });
     }
  },

  disconnect: async (intentional = true) => {
    if (intentional) {
       window.__INTENTIONAL_DISCONNECT__ = true;
    }
    const { peer, connections, unreliableConnections, pingInterval, positionalSyncInterval } = get();
    if (pingInterval) clearInterval(pingInterval);
    if (positionalSyncInterval) clearInterval(positionalSyncInterval);
    connections.forEach(c => c.close());
    unreliableConnections.forEach(c => c.close());
    if (peer) peer.destroy();
    
    // Flush WAL BEFORE changing slot prefix to prevent singleplayer chunks saving to guest!
    await flushWAL();
    
    // Restore default slot for Singleplayer
    const { setDbSlotId } = await import('../../utils/db');
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
              try { conn.send({ type: 'PING', time: Date.now() }); } catch(e) { console.warn("[Network] Dropped binary packet/action:", e.message); }
              
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

        // 30Hz Positional Sync Loop (Host)
        const positionalSyncInterval = setInterval(() => {
          const netState = get();
          if (netState.connectionStatus !== 'connected') return;
          
          // Broadcast our current position to peers
          netState.sendBinary(1, {
             x: playerPosition.x,
             y: playerPosition.y,
             z: playerPosition.z,
             pitch: playerRotation.x,
             yaw: playerRotation.y
          });
          
          // Broadcast ship position if active
          const gameState = getGameStore()?.getState();
          if (gameState && gameState.isShipActive) {
             const transform = window.shipTransforms ? window.shipTransforms.get('default') : null;
             if (transform && transform.actualVelocity) {
                // Only broadcast if the ship is actually moving to save bandwidth
                const moving = Math.abs(transform.actualVelocity.x) > 0.01 || 
                               Math.abs(transform.actualVelocity.y) > 0.01 || 
                               Math.abs(transform.actualVelocity.z) > 0.01;
                
                if (moving || window.__forceShipBroadcast) {
                    const payload = {
                        type: 'SHIP_TRANSFORM',
                        position: [transform.position.x, transform.position.y, transform.position.z],
                        rotation: [transform.rotation.x, transform.rotation.y, transform.rotation.z]
                    };
                    netState.connections.forEach(conn => { try { conn.send(payload); } catch(e) { console.warn("[Network] Dropped packet/action:", e.message); } });
                    
                    if (!moving && window.__forceShipBroadcast) {
                        window.__forceShipBroadcast = false; // Broadcast one resting frame
                    }
                }
             }
          }
        }, 33); // ~30Hz

      set({ pingInterval, positionalSyncInterval });
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
                } catch(e) { console.warn("[Network] Dropped packet/action:", e.message); }
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
                 const useStore = getGameStore();
                 const gameState = useStore ? useStore.getState() : null;
                 
                 let shipData = null;
                 if (gameState && gameState.isShipActive) {
                    const transform = window.shipTransforms ? window.shipTransforms.get('default') : null;
                    const rle = [];
                    const buffer = gameState.shipBuffer;
                    if (buffer) {
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
                    }
                    shipData = {
                        bufferRLE: rle,
                        helmId: gameState.shipHelmPlayerId,
                        position: transform ? [transform.position.x, transform.position.y, transform.position.z] : [0,10000,0],
                        rotation: transform ? [transform.rotation.x, transform.rotation.y, transform.rotation.z] : [0,0,0]
                    };
                 }
                 
                 conn.send({ 
                    type: 'WELCOME', 
                    hostId: get().playerId, 
                    hostName: get().playerName, 
                    worldSeed: getSeed(),
                    lastAttackTimestamps: {},
                    pendingHostAttacks: [],
                    guestState: savedState || null,
                    syncLevel: gameState?.syncLevel || 1,
                    mainQuestProgress: gameState?.mainQuestProgress || null,
                    shipData
                 });
               } catch(e) { console.warn("[Network] Dropped packet/action:", e.message); }
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
              } catch(e) { console.warn("[Network] Dropped binary packet/action:", e.message); }
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
        get().cullDeadConnection(conn.metadata?.playerId);
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

  joinGame: async (code) => {
    await get().disconnect(); // FIX: Prevent Zombie Connections
    set({ connectionStatus: 'connecting' });
    
    // FIX: Isolate Guest world into a temporary slot so it doesn't overwrite their Singleplayer world!
    const { clearSlotDB, setDbSlotId } = await import('../../utils/db');
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
                } catch(e) { console.warn("[Network] Dropped packet/action:", e.message); }
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

          // 30Hz Positional Sync Loop (Guest)
          const positionalSyncInterval = setInterval(() => {
            const netState = get();
            if (netState.connectionStatus !== 'connected') return;
            
            netState.sendBinary(1, {
               x: playerPosition.x,
               y: playerPosition.y,
               z: playerPosition.z,
               pitch: playerRotation.x,
               yaw: playerRotation.y
            });
          }, 33);

          set({ peer, isHost: false, roomCode: code.toUpperCase(), connections: [conn], pingInterval: watchdog, positionalSyncInterval });
        
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
              } catch(e) { console.warn("[Network] Dropped binary packet/action:", e.message); }
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
  }
});
