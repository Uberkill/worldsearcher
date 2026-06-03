const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/stores/useNetworkStore.js');
let code = fs.readFileSync(filePath, 'utf-8');

const oldStateInit = `export const useNetworkStore = create((set, get) => ({
  peer: null,
  connections: [], // List of active DataChannels
  unreliableConnections: [], // Fast UDP-like channels for movement
  isHost: false,
  roomCode: null,
  playerName: '',
  playerId: null,
  connectionStatus: 'disconnected', // 'disconnected', 'connecting', 'connected'
  players: {}, // { [id]: { pos: [0,0,0], rot: [0,0,0,1], name: "...", texture: "..." } }
  pingInterval: null,`;

const newStateInit = `export const useNetworkStore = create((set, get) => ({
  peer: null,
  connections: [], // List of active DataChannels
  unreliableConnections: [], // Fast UDP-like channels for movement
  isHost: false,
  roomCode: null,
  playerName: '',
  playerId: null,
  connectionStatus: 'disconnected', // 'disconnected', 'connecting', 'connected'
  players: {}, // { [id]: { pos: [0,0,0], rot: [0,0,0,1], name: "...", texture: "..." } }
  pingInterval: null,

  // 🔹 Atomic Inventory Locks (Phase 6) 🔹
  transactionLocks: new Set(),
  lockSlots: (slotKeys) => {
    const locks = get().transactionLocks;
    for (const key of slotKeys) {
      if (locks.has(key)) return false; // Collision detected!
    }
    const newLocks = new Set(locks);
    slotKeys.forEach(key => newLocks.add(key));
    set({ transactionLocks: newLocks });
    return true;
  },
  unlockSlots: (slotKeys) => {
    const locks = new Set(get().transactionLocks);
    slotKeys.forEach(key => locks.delete(key));
    set({ transactionLocks: locks });
  },
`;

code = code.replace(oldStateInit, newStateInit);

fs.writeFileSync(filePath, code);
console.log('useNetworkStore patched for Mutex locks!');
