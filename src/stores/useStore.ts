// @ts-nocheck
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { worldActions, pass1Cache } from './worldActions';
import { createPlayerSlice } from './createPlayerSlice';
import { createEntitySlice } from './createEntitySlice';
import { createAchievementSlice } from './createAchievementSlice';
import { createQuestSlice } from './createQuestSlice';
import { createShipSlice } from './createShipSlice';
import { setGameStore } from './storeLinker';
import { injectWorkerDependencies } from '../utils/workerPool';
import { useSettingsStore } from './useSettingsStore';
import { useChunkStore } from './chunkSlice';
import { useInventoryStore } from './inventorySlice';
import { useEnvironmentStore } from './environmentSlice';
import { useFlareStore } from './flareSlice';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const useStore = create<any>()(subscribeWithSelector((...a: any[]) => ({
  ...worldActions(a[0], a[1]),
  ...createPlayerSlice(a[0], a[1]),
  ...createEntitySlice(a[0], a[1]),
  ...createAchievementSlice(a[0], a[1]),
  ...createQuestSlice(a[0], a[1]),
  ...createShipSlice(a[0], a[1]),
})));

if (typeof window !== 'undefined') {
  window.__USE_STORE__ = useStore;
  window.useStore = useStore;
}
setGameStore(useStore);

// Break circular dependency by injecting the state getter directly
if (typeof window !== 'undefined') {
  window.__DEBUG_PASS1_CACHE__ = pass1Cache;
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

// @ts-expect-error - Vite HMR types are not available
if (import.meta.hot) {
  // @ts-expect-error - Vite HMR types are not available
  import.meta.hot.dispose(() => clearInterval(fluidInterval));
}

useChunkStore.subscribe((state) => {
  useStore.setState({ chunks: state.chunks, pendingMeshMounts: state.pendingMeshMounts, overflowChunks: state.overflowChunks, activePhysicsChunks: state.activePhysicsChunks });
});
useInventoryStore.subscribe((state) => {
  useStore.setState({ chests: state.chests, droppedItems: state.droppedItems, tombstones: state.tombstones, debris: state.debris, fallingStructures: state.fallingStructures });
});
useEnvironmentStore.subscribe((state) => {
  useStore.setState({ worldTime: state.worldTime, daysElapsed: state.daysElapsed, isRaining: state.isRaining, isNightTime: state.isNightTime, skyColor: state.skyColor, fogDensity: state.fogDensity });
});
useFlareStore.subscribe((state) => {
  useStore.setState({ placedFlares: state.placedFlares });
});


