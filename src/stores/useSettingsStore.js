import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

const load = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
};

export const useSettingsStore = create(
  subscribeWithSelector((set, get) => ({
    // Debug State
    spectorData: null,
    setSpectorData: (data) => set({ spectorData: data }),

    // Audio
    masterVolume: load('setting_masterVolume', 0.8),
    sfxVolume: load('setting_sfxVolume', 1.0),
    musicVolume: load('setting_musicVolume', 0.5),
    isMuted: load('setting_isMuted', false),

    // Game Mode
    gameMode: 'survival', // 'survival' | 'creative' | 'hardcore'

    // Graphics
    renderDistance: load('setting_renderDistance', 8),
    shadowQuality: load('setting_shadowQuality', 'visual'), // 'visual' | 'performance'

    // UI & Debug
    isSettingsOpen: false,
    debugLighting: false,
    debugPhysics: false,
    debugShadows: false,

    setMasterVolume: (v) => {
      localStorage.setItem('setting_masterVolume', JSON.stringify(v));
      set({ masterVolume: v });
    },
    setSfxVolume: (v) => {
      localStorage.setItem('setting_sfxVolume', JSON.stringify(v));
      set({ sfxVolume: v });
    },
    setMusicVolume: (v) => {
      localStorage.setItem('setting_musicVolume', JSON.stringify(v));
      set({ musicVolume: v });
    },
    toggleMute: () => {
      const next = !get().isMuted;
      localStorage.setItem('setting_isMuted', JSON.stringify(next));
      set({ isMuted: next });
    },
    setGameMode: (mode) => {
      localStorage.setItem('setting_gameMode', JSON.stringify(mode));
      set({ gameMode: mode });
    },
    setRenderDistance: (v) => {
      localStorage.setItem('setting_renderDistance', JSON.stringify(v));
      set({ renderDistance: v });
    },
    setShadowQuality: (v) => {
      localStorage.setItem('setting_shadowQuality', JSON.stringify(v));
      set({ shadowQuality: v });
    },
    openSettings: () => set({ isSettingsOpen: true }),
    closeSettings: () => set({ isSettingsOpen: false }),
    toggleDebugLighting: () =>
      set((state) => ({ debugLighting: !state.debugLighting })),
    toggleDebugPhysics: () =>
      set((state) => ({ debugPhysics: !state.debugPhysics })),
    toggleDebugShadows: () =>
      set((state) => ({ debugShadows: !state.debugShadows })),
  }))
);
