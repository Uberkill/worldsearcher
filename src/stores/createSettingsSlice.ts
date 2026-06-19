import { useSettingsStore } from './useSettingsStore';

export const createSettingsSlice = (set: any, get: any): Record<string, any> => ({
  ...useSettingsStore.getState(),

  setSpectorData: (data: any) => useSettingsStore.getState().setSpectorData(data),
  setGameMode: (mode: string) => useSettingsStore.getState().setGameMode(mode),
  setRenderDistance: (v: number) => useSettingsStore.getState().setRenderDistance(v),
  setShadowQuality: (v: string) => useSettingsStore.getState().setShadowQuality(v),
  openSettings: () => {
    if (get().isDead) return {};
    useSettingsStore.getState().openSettings();
  },
  closeSettings: () => useSettingsStore.getState().closeSettings(),
  toggleDebugLighting: () => useSettingsStore.getState().toggleDebugLighting(),
  toggleDebugPhysics: () => useSettingsStore.getState().toggleDebugPhysics(),
  toggleDebugShadows: () => useSettingsStore.getState().toggleDebugShadows(),
});
