import { create } from 'zustand';
import { createWorldSlice } from './createWorldSlice';
import { createPlayerSlice } from './createPlayerSlice';
import { createEntitySlice } from './createEntitySlice';
import { createSettingsSlice } from './createSettingsSlice';
import { createAchievementSlice } from './createAchievementSlice';
import { setGameStore } from './storeLinker';

export const useStore = create((...a) => ({
  ...createWorldSlice(...a),
  ...createPlayerSlice(...a),
  ...createEntitySlice(...a),
  ...createSettingsSlice(...a),
  ...createAchievementSlice(...a),
}));

window.__USE_STORE__ = useStore;
setGameStore(useStore);

// Run fluid cellular automata ticking at a steady rate
setInterval(() => {
  const s = useStore.getState();
  // Don't tick fluids while in the main menu, loading screen, or death screen.
  if (!s.isWorldReady || !s.hasLoadedState || s.isDead) return;
  if (s.tickFluids) s.tickFluids();
}, 800);

window.useStore = useStore;
