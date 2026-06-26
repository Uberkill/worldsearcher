import { create } from 'zustand';

interface InventorySlice {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chests: Record<string, any>;       // TODO(ts-migration): type chest contents
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  machines: Record<string, any>;    // TODO(ts-migration): type machine contents
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  droppedItems: any[];              // TODO(ts-migration): type dropped items
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tombstones: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  debris: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fallingStructures: any[];
  shadowSetState: (newState: Partial<Pick<InventorySlice, 'chests' | 'machines' | 'droppedItems' | 'tombstones' | 'debris' | 'fallingStructures'>>) => void;
  validateStateParity: (oldState: Partial<InventorySlice>) => void;
}

export const useInventoryStore = create<InventorySlice>((set, get) => ({
  chests: {},
  machines: {},
  droppedItems: [],
  tombstones: [],
  debris: [],
  fallingStructures: [],

  shadowSetState: (newState) => {
    const updates: Partial<InventorySlice> = {};
    if (newState.chests !== undefined) updates.chests = newState.chests;
    if (newState.machines !== undefined) updates.machines = newState.machines;
    if (newState.droppedItems !== undefined) updates.droppedItems = newState.droppedItems;
    if (newState.tombstones !== undefined) updates.tombstones = newState.tombstones;
    if (newState.debris !== undefined) updates.debris = newState.debris;
    if (newState.fallingStructures !== undefined) updates.fallingStructures = newState.fallingStructures;
    set(updates);
  },

  validateStateParity: (oldState) => {
    const state = get();
    if (oldState.droppedItems && state.droppedItems.length !== oldState.droppedItems.length) {
      console.warn('[State Parity Error] droppedItems length mismatch');
    }
  }
}));
