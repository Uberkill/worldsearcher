// @ts-nocheck
import { create } from 'zustand';
import type { ChunkData } from '../types/world';

// This is the Strangler Fig shadow slice for Core Terrain Chunk management.
interface ChunkSlice {
  chunks: Record<string, ChunkData>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pendingMeshMounts: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  overflowChunks: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  activePhysicsChunks: any[];
  validateStateParity: (oldChunks: Record<string, ChunkData>) => void;
  shadowSetChunks: (newChunks: Record<string, ChunkData>) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shadowSetMounts: (pendingMounts: any[], overflow: any[]) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shadowSetActivePhysics: (physicsChunks: any[]) => void;
}

export const useChunkStore = create<ChunkSlice>((set, get) => ({
  chunks: {},
  pendingMeshMounts: [],
  overflowChunks: [],
  activePhysicsChunks: [],

  // Shadow validators
  validateStateParity: (oldChunks) => {
    const newChunks = get().chunks;
    const oldKeys = Object.keys(oldChunks);
    const newKeys = Object.keys(newChunks);
    if (oldKeys.length !== newKeys.length) {
      console.warn('[State Parity Error] chunk count mismatch:', newKeys.length, oldKeys.length);
      return;
    }
    // We avoid deep-comparing massive ArrayBuffers on every tick,
    // but we can check if a key exists and if its rebuildId matches.
    for (const key of oldKeys) {
      if (!newChunks[key]) {
        console.warn(`[State Parity Error] chunk ${key} missing in new store`);
      } else if (newChunks[key].rebuildId !== oldChunks[key].rebuildId) {
        console.warn(`[State Parity Error] chunk ${key} rebuildId mismatch:`, newChunks[key].rebuildId, oldChunks[key].rebuildId);
      }
    }
  },

  // Shadow methods that just blindly mirror the legacy store's output for now.
  // In Phase 3, these will be populated with the actual implementation logic.
  shadowSetChunks: (newChunks) => {
    set({ chunks: newChunks });
  },

  shadowSetMounts: (pendingMounts, overflow) => {
    set({ pendingMeshMounts: pendingMounts, overflowChunks: overflow });
  },

  shadowSetActivePhysics: (physicsChunks) => {
    set({ activePhysicsChunks: physicsChunks });
  }
}));

if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).useChunkStore = useChunkStore;
}

