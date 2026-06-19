import { create } from 'zustand';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'hosting';

interface ConnectionSlice {
  peer: any | null; // TODO(ts-migration): type PeerJS peer
  connections: any[];
  unreliableConnections: any[];
  isHost: boolean;
  roomCode: string | null;
  playerName: string;
  connectionStatus: ConnectionStatus;
  players: Record<string, any>; // TODO(ts-migration): type player sync objects
  playerId: string;
  mods: any[];
  pendingHostAttacks: any[];
  chunkRequests: Record<string, any>;
  chunkQueue: any[];
  inFlightChunkRequests: number;
  MAX_CONCURRENT_CHUNK_REQUESTS: number;
}

export const useConnectionStore = create<ConnectionSlice>((_set) => ({
  peer: null,
  connections: [],
  unreliableConnections: [],
  isHost: true,
  roomCode: null,
  playerName: '',
  connectionStatus: 'disconnected',
  players: {},
  playerId: localStorage.getItem('ws_playerId') || (() => {
     const newId = Math.random().toString(36).substring(2, 9);
     localStorage.setItem('ws_playerId', newId);
     return newId;
  })(),
  mods: [],

  pendingHostAttacks: [],

  chunkRequests: {},
  chunkQueue: [],
  inFlightChunkRequests: 0,
  MAX_CONCURRENT_CHUNK_REQUESTS: 20,
}));
