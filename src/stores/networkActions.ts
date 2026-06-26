// @ts-nocheck
/* eslint-disable no-unused-vars */
import { getGameStore, setNetworkStore } from './storeLinker';
import { useChunkStore } from './chunkSlice';
import { useInventoryStore } from './inventorySlice';
import { BlockKeyById } from '../registry/BlockRegistry';
import { useChatStore } from './chatSlice';
import { useSyncStore } from './syncSlice';
import { useConnectionStore } from './connectionSlice';
import { useEnvironmentStore } from './environmentSlice';
import { create } from 'zustand';
import { NetworkEventBus } from '../utils/NetworkEventBus';

import '../systems/network/ConnectionSystems';
import '../systems/network/ChatSystems';
import '../systems/network/ShipSystems';
import '../systems/network/InventorySystems';
import '../systems/network/LootSystems';
import '../systems/network/WorldSyncSystems';
import '../systems/network/PlayerSyncSystems';

import { createChatActions } from './network/chatActions';
import { createConnectionActions } from './network/connectionActions';
import { createBroadcastActions } from './network/broadcastActions';
import { createChunkActions } from './network/chunkActions';
import { parseBinaryPacket } from './network/packetParser';

const chatKeys = new Set(['chatMessages', 'isTyping']);
const syncKeys = new Set(['players', 'guestHealthMap', 'enemySyncBuffers', 'queuedDeltas', 'waypoints']);
const connectionKeys = new Set([
  'peer', 'connections', 'unreliableConnections', 'isHost', 'roomCode', 
  'playerName', 'connectionStatus', 'playerId', 'mods', 'pendingHostAttacks', 
  'chunkRequests', 'chunkQueue', 'inFlightChunkRequests', 'MAX_CONCURRENT_CHUNK_REQUESTS'
]);

let baseGetState: any = null;

const getFacadeState = () => {
  const base = baseGetState ? baseGetState() : {};
  return {
    ...base,
    ...useChatStore.getState(),
    ...useSyncStore.getState(),
    ...useConnectionStore.getState()
  };
};

export const networkActions = create((rawSet: any, rawGet: any) => {
  baseGetState = rawGet;
  const get = getFacadeState;

  const set = (updater: any) => {
    const prevState = get();
    const rawPatch = typeof updater === 'function' ? updater(prevState) : updater;
    if (!rawPatch) return;
    
    // Non-destructive destructuring
    const {
      chatMessages, isTyping,
      players, guestHealthMap, enemySyncBuffers, queuedDeltas, waypoints,
      ...rest
    } = rawPatch;

    if (chatMessages !== undefined) useChatStore.setState({ chatMessages });
    if (isTyping !== undefined) useChatStore.setState({ isTyping });
    
    if (players !== undefined) useSyncStore.setState({ players });
    if (guestHealthMap !== undefined) useSyncStore.setState({ guestHealthMap });
    if (enemySyncBuffers !== undefined) useSyncStore.setState({ enemySyncBuffers });
    if (queuedDeltas !== undefined) useSyncStore.setState({ queuedDeltas });
    if (waypoints !== undefined) useSyncStore.setState({ waypoints });
    
    const connectionKeysList = ['peer', 'connections', 'unreliableConnections', 'isHost', 'roomCode', 'playerName', 'connectionStatus', 'playerId', 'mods', 'pendingHostAttacks', 'chunkRequests', 'chunkQueue', 'inFlightChunkRequests'];
    const connectionPatch: any = {};
    const basePatch: any = {};
    
    for (const key of Object.keys(rest)) {
      if (connectionKeysList.includes(key)) {
        connectionPatch[key] = rest[key];
      } else {
        basePatch[key] = rest[key];
      }
    }
    
    if (Object.keys(connectionPatch).length > 0) {
       useConnectionStore.setState(connectionPatch);
    }

    if (Object.keys(basePatch).length > 0) {
      rawSet(basePatch);
    }
  };

  return {
    setPlayerName: (name: string) => set({ playerName: name }),
    popPendingAttacks: () => {
       const queue = get().pendingHostAttacks;
       if (queue.length === 0) return [];
       set({ pendingHostAttacks: [] });
       return queue;
    },
    
    // Mod Roles
    addMod: (id: string) => set((s: any) => ({ mods: [...new Set([...s.mods, id])] })),
    removeMod: (id: string) => set((s: any) => ({ mods: s.mods.filter((m: string) => m !== id) })),

    // Waypoints
    addWaypoint: (wp: any) => set((state: any) => ({ waypoints: [...state.waypoints, wp] })),
    broadcastWaypoint: (wp: any) => {
      const { connections, isHost } = get();
      if (!isHost) return;
      connections.forEach((conn: any) => {
        try { conn.send({ type: 'SYNC_WAYPOINTS', waypoints: [wp] }); } catch(e: any) { console.warn("[Network] Dropped packet/action:", e.message); }
      });
      get().addWaypoint(wp);
    },

    ...createChatActions(set, get),
    ...createConnectionActions(set, get),
    ...createBroadcastActions(set, get),
    ...createChunkActions(set, get),

    handleNetworkData: (data: any, senderConn: any) => {
      if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
          parseBinaryPacket(data, set, get);
          return;
      }

      NetworkEventBus.emit(data.type, { data, senderConn, getNetworkState: get, setNetworkState: set });
    }
  };
});

window.networkActions = networkActions;

setNetworkStore(networkActions);

const originalGetState = networkActions.getState;
baseGetState = originalGetState;
networkActions.getState = getFacadeState;

const originalSubscribe = networkActions.subscribe;
networkActions.subscribe = (listener: any) => {
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
networkActions.setState = (updater: any) => {
  const prevState = networkActions.getState();
  const rawPatch = typeof updater === 'function' ? updater(prevState) : updater;
  if (!rawPatch) return;
  
  const {
    chatMessages, isTyping,
    players, guestHealthMap, enemySyncBuffers, queuedDeltas, waypoints,
    ...rest
  } = rawPatch;
  
  if (chatMessages !== undefined) useChatStore.setState({ chatMessages });
  if (isTyping !== undefined) useChatStore.setState({ isTyping });
  if (players !== undefined) useSyncStore.setState({ players });
  if (guestHealthMap !== undefined) useSyncStore.setState({ guestHealthMap });
  if (enemySyncBuffers !== undefined) useSyncStore.setState({ enemySyncBuffers });
  if (queuedDeltas !== undefined) useSyncStore.setState({ queuedDeltas });
  if (waypoints !== undefined) useSyncStore.setState({ waypoints });
  
  const connectionKeysList = ['peer', 'connections', 'unreliableConnections', 'isHost', 'roomCode', 'playerName', 'connectionStatus', 'playerId', 'mods', 'pendingHostAttacks', 'chunkRequests', 'chunkQueue', 'inFlightChunkRequests'];
  const connectionPatch: any = {};
  const basePatch: any = {};
  
  for (const key of Object.keys(rest)) {
     if (connectionKeysList.includes(key)) {
        connectionPatch[key] = rest[key];
     } else {
        basePatch[key] = rest[key];
     }
  }
  
  if (Object.keys(connectionPatch).length > 0) {
     useConnectionStore.setState(connectionPatch);
  }

  if (Object.keys(basePatch).length > 0) {
    originalSetState(basePatch);
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
