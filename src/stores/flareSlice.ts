import { create } from 'zustand';

interface Flare {
  id: string;
  pos: [number, number, number];
  normal: [number, number, number];
  isShip: boolean;
  emitLight: boolean;
}

interface FlareSlice {
  placedFlares: Flare[];
  placeFlare: (pos: [number, number, number], normal: [number, number, number], id: string, isShip?: boolean) => void;
  removeFlare: (id: string) => void;
  validateStateParity: (oldPlacedFlares: Flare[]) => void;
}

export const useFlareStore = create<FlareSlice>((set, get) => ({
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
