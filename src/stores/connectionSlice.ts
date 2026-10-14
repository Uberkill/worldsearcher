import { create } from 'zustand';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'hosting';

interface ConnectionSlice {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  peer: any | null; // TODO(ts-migration): type PeerJS peer
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connections: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  unreliableConnections: any[];
  isHost: boolean;
  roomCode: string | null;
  playerName: string;
  connectionStatus: ConnectionStatus;
  playerId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mods: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pendingHostAttacks: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chunkRequests: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  playerId: (typeof localStorage !== 'undefined' ? localStorage.getItem('ws_playerId') : null) || (() => {
     const newId = Math.random().toString(36).substring(2, 9);
     if (typeof localStorage !== 'undefined') localStorage.setItem('ws_playerId', newId);
     return newId;
  })(),
  mods: [],

  pendingHostAttacks: [],

  chunkRequests: {},
  chunkQueue: [],
  inFlightChunkRequests: 0,
  MAX_CONCURRENT_CHUNK_REQUESTS: 20,
}));
