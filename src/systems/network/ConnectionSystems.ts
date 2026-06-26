// @ts-nocheck
import { NetworkEventBus } from '../../utils/NetworkEventBus';
import { setWorldSeed } from '../../worldSeed';
import { getGameStore } from '../../stores/storeLinker';

const initializeConnectionSystems = () => {
  NetworkEventBus.on('PING', (payload) => {
    const { data, senderConn } = payload;
    window.__lastPingTime = Date.now();
    try { senderConn.send({ type: 'PONG', time: data.time }); } catch { /* ignore */ }
  });

  NetworkEventBus.on('PONG', (payload) => {
    const { data } = payload;
    if (window.__DEBUG_STATS__) {
      window.__DEBUG_STATS__.ping = Date.now() - data.time;
    }
  });

  NetworkEventBus.on('WELCOME', (payload) => {
    const { data, setNetworkState } = payload;
    
    // Guest received welcome from host, store host's name and set world seed!
    if (data.worldSeed) {
       setWorldSeed(data.worldSeed);
    }
    
    // If Host sent us a saved profile, inject it into the GameEngine immediately!
    if (data.guestState !== undefined) {
       const injectGuestState = () => {
           const useStore = getGameStore();
           if (useStore) {
               useStore.getState().applyPlayerState(data.guestState);
           } else {
               setTimeout(injectGuestState, 100);
           }
       };
       injectGuestState();
    }
    
    // Load ship state if provided
    if (data.shipData) {
       const loadShipState = () => {
           const useStore = getGameStore();
           if (useStore) {
               const gameState = useStore.getState();
               const buffer = new Uint32Array(32768);
               let idx = 0;
               const rle = data.shipData.bufferRLE;
               for (let i = 0; i < rle.length; i += 2) {
                   const val = rle[i];
                   const count = rle[i+1];
                   if (idx < 32768) {
                       buffer.fill(val, idx, Math.min(idx + count, 32768));
                       idx += count;
                   }
               }
               gameState.setShipBufferRaw(buffer);
               gameState.setShipTransform('default', data.shipData.position, data.shipData.rotation);
               gameState.setShipHelmPlayerId(data.shipData.helmId);
               useStore.setState({ isShipActive: true });
           } else {
               setTimeout(loadShipState, 100);
           }
       };
       loadShipState();
    }
    
    if (data.mainQuestProgress) {
       const useStore = getGameStore();
       if (useStore && useStore.getState().setMainQuestSync) {
          useStore.getState().setMainQuestSync(data.syncLevel, data.mainQuestProgress);
       }
    }
    
    if (data.hostId && data.hostName) {
       setNetworkState(prev => ({
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
  });

  NetworkEventBus.on('GUEST_STATE_SYNC', (payload) => {
     const { data, getNetworkState } = payload;
     if (!getNetworkState().isHost) return;
     
     import('idb-keyval').then(({ set: idbSet }) => {
        const prefix = sessionStorage.getItem('saveSlotId') || 'default';
        const guestKey = `${prefix}_guest_${data.playerId}`;
        idbSet(guestKey, data.savedState).catch(err => console.error("Failed to save guest state:", err));
     });
  });
};

// Auto-initialize when imported
initializeConnectionSystems();

