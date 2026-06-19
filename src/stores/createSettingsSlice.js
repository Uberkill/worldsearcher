import { useSettingsStore } from './useSettingsStore';

export const createSettingsSlice = (set, get) => ({
  ...useSettingsStore.getState(),

  setSpectorData: (data) => useSettingsStore.getState().setSpectorData(data),
  setGameMode: (mode) => useSettingsStore.getState().setGameMode(mode),
  setRenderDistance: (v) => useSettingsStore.getState().setRenderDistance(v),
  setShadowQuality: (v) => useSettingsStore.getState().setShadowQuality(v),
  openSettings: () => {
    if (get().isDead) return {};
    useSettingsStore.getState().openSettings();
  },
  closeSettings: () => useSettingsStore.getState().closeSettings(),
  toggleDebugLighting: () => useSettingsStore.getState().toggleDebugLighting(),
  toggleDebugPhysics: () => useSettingsStore.getState().toggleDebugPhysics(),
  toggleDebugShadows: () => useSettingsStore.getState().toggleDebugShadows(),
});
