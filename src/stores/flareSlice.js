import { create } from 'zustand';

// Temporary local cache for flare light mapping, mirroring the old file's functionality.
// In Phase 3, this will be fully internalized here.
export const newFlareLightMap = new Map();

export const useFlareStore = create((set, get) => ({
  placedFlares: [],

  placeFlare: (pos, normal, id) => {
    set((prev) => ({
      placedFlares: [
        ...prev.placedFlares,
        { id: id, pos, normal, emitLight: true },
      ],
    }));
  },

  removeFlare: (id) => {
    set((prev) => ({
      placedFlares: prev.placedFlares.filter((t) => t.id !== id),
    }));
  },

  validateStateParity: (oldPlacedFlares) => {
    const state = get();
    if (state.placedFlares.length !== oldPlacedFlares.length) {
      console.warn('[State Parity Error] placedFlares length mismatch:', state.placedFlares.length, oldPlacedFlares.length);
    }
  }
}));
