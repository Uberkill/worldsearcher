import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { worldActions, pass1Cache } from './worldActions';
import { createPlayerSlice } from './createPlayerSlice';
import { createEntitySlice } from './createEntitySlice';
import { createSettingsSlice } from './createSettingsSlice';
import { createAchievementSlice } from './createAchievementSlice';
import { createQuestSlice } from './createQuestSlice';
import { createShipSlice } from './createShipSlice';
import { setGameStore } from './storeLinker';
import { injectWorkerDependencies } from '../utils/workerPool';
import { useSettingsStore } from './useSettingsStore';

export const useStore = create(subscribeWithSelector((...a) => ({
  ...worldActions(...a),
  ...createPlayerSlice(...a),
  ...createEntitySlice(...a),
  ...createSettingsSlice(...a),
  ...createAchievementSlice(...a),
  ...createQuestSlice(...a),
  ...createShipSlice(...a),
})));

window.__USE_STORE__ = useStore;
setGameStore(useStore);

let isSyncingSettings = false;

useSettingsStore.subscribe(
  (state) => state,
  (settings) => {
    if (isSyncingSettings) return;
    isSyncingSettings = true;
    useStore.setState({
      spectorData: settings.spectorData,
      masterVolume: settings.masterVolume,
      sfxVolume: settings.sfxVolume,
      musicVolume: settings.musicVolume,
      isMuted: settings.isMuted,
      gameMode: settings.gameMode,
      renderDistance: settings.renderDistance,
      shadowQuality: settings.shadowQuality,
      isSettingsOpen: settings.isSettingsOpen,
      debugLighting: settings.debugLighting,
      debugPhysics: settings.debugPhysics,
      debugShadows: settings.debugShadows,
    });
    isSyncingSettings = false;
  }
);

useStore.subscribe(
  (state) => state,
  (state) => {
    if (isSyncingSettings) return;
    isSyncingSettings = true;
    useSettingsStore.setState({
      spectorData: state.spectorData,
      masterVolume: state.masterVolume,
      sfxVolume: state.sfxVolume,
      musicVolume: state.musicVolume,
      isMuted: state.isMuted,
      gameMode: state.gameMode,
      renderDistance: state.renderDistance,
      shadowQuality: state.shadowQuality,
      isSettingsOpen: state.isSettingsOpen,
      debugLighting: state.debugLighting,
      debugPhysics: state.debugPhysics,
      debugShadows: state.debugShadows,
    });
    isSyncingSettings = false;
  }
);

// Break circular dependency by injecting the state getter directly
injectWorkerDependencies(() => pass1Cache);

// Run fluid cellular automata ticking at a steady rate
let fluidInterval;
// eslint-disable-next-line no-undef
if (typeof process === 'undefined' || process.env.NODE_ENV !== 'test') {
  fluidInterval = setInterval(() => {
    const s = useStore.getState();
    // Don't tick fluids while in the main menu, loading screen, or death screen.
    if (!s.isWorldReady || !s.hasLoadedState || s.isDead) return;
    if (s.tickFluids) s.tickFluids();
    if (s.unloadDistantChunks && s.playerPosition) {
      s.unloadDistantChunks(s.playerPosition);
    }
    if (s.tickGarbageCollection) s.tickGarbageCollection();
  }, 800);
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => clearInterval(fluidInterval));
}

window.useStore = useStore;
