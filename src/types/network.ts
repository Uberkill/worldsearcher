export interface NetworkState {
  isConnected: boolean;
  playerId: string | null;
  roomId: string | null;
  peers: Record<string, PeerState>;
}

interface PeerState {
  id: string;
  position: [number, number, number];
  rotation: [number, number, number];
  heldItem: string | null;
  username: string;
}

interface SyncDelta {
  chunkKey: string;
  deltas: number[];
}

export type NetworkPacket = 
  | { type: 'CHAT_MESSAGE'; text: string; sender: string }
  | { type: 'SYSTEM_MESSAGE'; text: string }
  | { type: 'COMMAND_INTENT'; cmd: string; args: string[] }
  | { type: 'TELEPORT'; pos: [number, number, number] }
  | { type: 'SET_GAMEMODE'; mode: string }
  | { type: 'TIME_SYNC'; worldTime: number; isRaining: boolean }
  | { type: 'INVENTORY_SYNC'; authoritativeInventories: Record<string, any[]> }
  | { type: 'SHIP_TRANSFORM'; position: [number, number, number]; rotation: [number, number, number] }
  | { type: 'SHIP_BUFFER_SYNC'; shipBufferRLE: number[] }
  | { type: 'KICK'; reason: string }
  | { type: 'SERVER_COMMAND'; cmd: string; args: string[]; senderId: string };

type CompositeNetworkState = any; // We will just use 'any' for the root facade in this iteration to avoid over-engineering, since we mainly care about chatActions strictly typed.
