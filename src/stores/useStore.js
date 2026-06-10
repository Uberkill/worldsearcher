import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { worldActions, pass1Cache } from './worldActions';
import { createPlayerSlice } from './createPlayerSlice';
import { createEntitySlice } from './createEntitySlice';
import { createSettingsSlice } from './createSettingsSlice';
import { createAchievementSlice } from './createAchievementSlice';
import { createQuestSlice } from './createQuestSlice';
import { setGameStore } from './storeLinker';
import { injectWorkerDependencies } from '../utils/workerPool';

export const useStore = create(subscribeWithSelector((...a) => ({
  ...worldActions(...a),
  ...createPlayerSlice(...a),
  ...createEntitySlice(...a),
  ...createSettingsSlice(...a),
  ...createAchievementSlice(...a),
  ...createQuestSlice(...a),
})));

window.__USE_STORE__ = useStore;
setGameStore(useStore);

// Break circular dependency by injecting the state getter directly
injectWorkerDependencies(() => pass1Cache);

// Run fluid cellular automata ticking at a steady rate
const fluidInterval = setInterval(() => {
  const s = useStore.getState();
  // Don't tick fluids while in the main menu, loading screen, or death screen.
  if (!s.isWorldReady || !s.hasLoadedState || s.isDead) return;
  if (s.tickFluids) s.tickFluids();
}, 800);

if (import.meta.hot) {
  import.meta.hot.dispose(() => clearInterval(fluidInterval));
}

window.useStore = useStore;
