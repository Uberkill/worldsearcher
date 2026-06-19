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

export const useStore = create<any>()(subscribeWithSelector((...a: any[]) => ({
  ...worldActions(a[0], a[1]),
  ...createPlayerSlice(a[0], a[1]),
  ...createEntitySlice(a[0], a[1]),
  ...createSettingsSlice(a[0], a[1]),
  ...createAchievementSlice(a[0], a[1]),
  ...createQuestSlice(a[0], a[1]),
  ...createShipSlice(a[0], a[1]),
})));

if (typeof window !== 'undefined') {
  (window as any).__USE_STORE__ = useStore;
  (window as any).useStore = useStore;
}
setGameStore(useStore);

let isSyncingSettings = false;

useSettingsStore.subscribe(
  (state: any) => state,
  (settings: any) => {
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
  (state: any) => state,
  (state: any) => {
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
if (typeof window !== 'undefined') {
  (window as any).__DEBUG_PASS1_CACHE__ = pass1Cache;
}
injectWorkerDependencies(() => pass1Cache);

// Run fluid cellular automata ticking at a steady rate
let fluidInterval: ReturnType<typeof setInterval>;
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

// @ts-ignore
if (import.meta.hot) {
  // @ts-ignore
  import.meta.hot.dispose(() => clearInterval(fluidInterval));
}
