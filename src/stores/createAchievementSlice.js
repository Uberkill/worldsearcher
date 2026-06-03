import { get as getIDB, set as setIDB } from 'idb-keyval';

export const createAchievementSlice = (set, get) => ({
  achievements: {},
  recentAchievement: null,
  
  unlockAchievement: (id, title, desc, icon) => {
    const state = get();
    if (state.achievements[id]) return; // already unlocked
    
    const newAchievements = { ...state.achievements, [id]: true };
    set({ 
      achievements: newAchievements,
      recentAchievement: { id, title, desc, icon, time: Date.now() }
    });
    
    const prefix = sessionStorage.getItem('saveSlotId') || 'default';
    setIDB(`${prefix}_achievements`, newAchievements).catch(console.error);
  },
  
  clearRecentAchievement: () => set({ recentAchievement: null }),
  
  loadAchievements: async () => {
    try {
      const prefix = sessionStorage.getItem('saveSlotId') || 'default';
      const data = await getIDB(`${prefix}_achievements`);
      if (data) {
        set({ achievements: data });
      }
    } catch (e) {
      console.error(e);
    }
  }
});
