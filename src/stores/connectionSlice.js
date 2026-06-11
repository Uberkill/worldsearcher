import { create } from 'zustand';

export const useConnectionStore = create((_set) => ({
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
