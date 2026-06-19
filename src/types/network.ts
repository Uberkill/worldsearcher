export interface NetworkState {
  isConnected: boolean;
  playerId: string | null;
  roomId: string | null;
  peers: Record<string, PeerState>;
}

export interface PeerState {
  id: string;
  position: [number, number, number];
  rotation: [number, number, number];
  heldItem: string | null;
  username: string;
}

export interface SyncDelta {
  chunkKey: string;
  deltas: number[];
}
