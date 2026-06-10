import { create } from 'zustand';

export const useInventoryStore = create((set, get) => ({
  chests: {},
  droppedItems: [],
  tombstones: [],
  debris: [],
  fallingStructures: [],

  shadowSetState: (newState) => {
    const updates = {};
    if (newState.chests !== undefined) updates.chests = newState.chests;
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
