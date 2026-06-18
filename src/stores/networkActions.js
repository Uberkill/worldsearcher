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
  ownKeys(_target) {
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

export const networkActions = create((rawSet, rawGet) => {
  baseGetState = rawGet;
  const get = () => stateProxy;

  const set = (updater) => {
    const prevState = get();
    const patch = typeof updater === 'function' ? updater(prevState) : updater;
    if (!patch) return;
    
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
    
    const connectionKeysList = ['peer', 'connections', 'unreliableConnections', 'isHost', 'roomCode', 'playerName', 'connectionStatus', 'playerId', 'mods', 'pendingHostAttacks', 'chunkRequests', 'chunkQueue', 'inFlightChunkRequests'];
    const connectionPatch = {};
    for (const key of connectionKeysList) {
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

    // Waypoints
    addWaypoint: (wp) => set(state => ({ waypoints: [...state.waypoints, wp] })),
    broadcastWaypoint: (wp) => {
      const { connections, isHost } = get();
      if (!isHost) return;
      connections.forEach(conn => {
        try { conn.send({ type: 'SYNC_WAYPOINTS', waypoints: [wp] }); } catch(e) { console.warn("[Network] Dropped packet/action:", e.message); }
      });
      get().addWaypoint(wp);
    },

    ...createChatActions(set, get),
    ...createConnectionActions(set, get),
    ...createBroadcastActions(set, get),
    ...createChunkActions(set, get),

    handleNetworkData: (data, senderConn) => {
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
  
  const connectionKeysList = ['peer', 'connections', 'unreliableConnections', 'isHost', 'roomCode', 'playerName', 'connectionStatus', 'playerId', 'mods', 'pendingHostAttacks', 'chunkRequests', 'chunkQueue', 'inFlightChunkRequests'];
  const connectionPatch = {};
  for (const key of connectionKeysList) {
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
