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

export const useAudioStore = create(
  subscribeWithSelector((set, get) => ({
    masterVolume: load('setting_masterVolume', 0.8),
    sfxVolume: load('setting_sfxVolume', 1.0),
    musicVolume: load('setting_musicVolume', 0.5),
    isMuted: load('setting_isMuted', false),

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
  }))
);
