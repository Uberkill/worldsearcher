import { create } from 'zustand';



export const useFlareStore = create((set, get) => ({
  placedFlares: [],

  placeFlare: (pos, normal, id, isShip = false) => {
    set((prev) => ({
      placedFlares: [
        ...prev.placedFlares,
        { id: id, pos, normal, isShip, emitLight: true },
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
