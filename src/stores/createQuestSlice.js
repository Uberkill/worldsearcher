import { getNetworkStore } from './storeLinker';
import questsRegistry from '../registry/quests.json';
import { get as getIDB, set as setIDB } from 'idb-keyval';
import { playerPosition } from '../globals';

let saveTimeout = null;

export const createQuestSlice = (set, get) => ({
  syncLevel: 1, // Main quest progression level
  mainQuestProgress: {
    questId: "mq_01",
    objectives: [0, 0], // Tracks current amounts for the active quest's objectives
    completed: false
  },
  sideQuests: [], // e.g. [{ questId: "sq_bounty_01", objectives: [0] }]
  completedQuests: {},

  initializeQuests: async () => {
    try {
      const prefix = sessionStorage.getItem('saveSlotId') || 'default';
      const data = await getIDB(`${prefix}_quests_v2`);
      if (data) {
        set({
          syncLevel: data.syncLevel || 1,
          mainQuestProgress: data.mainQuestProgress || { questId: "mq_01", objectives: [0, 0], completed: false },
          sideQuests: data.sideQuests || [],
          completedQuests: data.completedQuests || {},
        });
      }
    } catch (e) {
      console.error('Failed to load quest state:', e);
    }
  },

  saveQuestState: () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    const prefix = sessionStorage.getItem('saveSlotId') || 'default';
    saveTimeout = setTimeout(async () => {
      try {
        const { syncLevel, mainQuestProgress, sideQuests, completedQuests } = get();
        await setIDB(`${prefix}_quests_v2`, { syncLevel, mainQuestProgress, sideQuests, completedQuests });
      } catch (e) {
        console.error('Failed to save quest state:', e);
      }
    }, 2000);
  },

  setMainQuestSync: (syncLevel, progress) => {
    set({ syncLevel, mainQuestProgress: progress });
    get().saveQuestState();
  },

  giveMainQuestRewards: (questId) => {
    const activeMainQuest = questsRegistry.main_quests.find(q => q.id === questId);
    if (activeMainQuest) {
      if (activeMainQuest.rewards.data && get().addData) {
         get().addData(activeMainQuest.rewards.data);
      }
      if (activeMainQuest.rewards.items && get().addInventoryItem) {
         activeMainQuest.rewards.items.forEach(item => {
             const leftover = get().addInventoryItem(item.texture, item.count);
             if (leftover > 0) {
                 const ns = getNetworkStore();
                 const netStore = ns ? ns.getState() : null;
                 const pPos = [playerPosition.x, playerPosition.y, playerPosition.z];
                 const dropIntent = {
                     type: 'SPAWN_LOOT',
                     id: Math.random().toString(36),
                     itemId: item.texture,
                     amount: leftover,
                     position: [pPos[0], pPos[1] + 1, pPos[2]]
                 };
                 if (get().spawnLoot) get().spawnLoot(dropIntent);
                 if (netStore?.broadcastEvent) netStore.broadcastEvent(dropIntent);
             }
         });
      }
    }
  },

  advanceMainQuest: () => {
    const state = get();
    const currentQuestIndex = questsRegistry.main_quests.findIndex(q => q.id === state.mainQuestProgress.questId);
    const nextQuest = questsRegistry.main_quests[currentQuestIndex + 1];

    if (nextQuest) {
      set({
        syncLevel: nextQuest.syncLevel,
        mainQuestProgress: {
          questId: nextQuest.id,
          objectives: new Array(nextQuest.objectives.length).fill(0),
          completed: false
        }
      });
      get().saveQuestState();
      
      // If Host, broadcast advancement
      const ns = getNetworkStore()?.getState();
      if (ns && ns.isHost) {
        ns.connections?.forEach(conn => {
          try {
            conn.send({ type: 'MAIN_QUEST_PROGRESS', syncLevel: nextQuest.syncLevel, progress: get().mainQuestProgress });
          } catch (e) { /* ignore */ }
        });
      }
    }
  },

  updateObjectiveProgress: (type, target, amount = 1) => {
    const state = get();
    const typeLower = type.toLowerCase();

    // Fast path: Check if ANY quest (main or side) actually needs updating
    let needsMainUpdate = false;
    const activeMainQuest = questsRegistry.main_quests.find(q => q.id === state.mainQuestProgress.questId);
    if (activeMainQuest && !state.mainQuestProgress.completed) {
      needsMainUpdate = activeMainQuest.objectives.some((obj, idx) => 
        obj.type.toLowerCase() === typeLower && 
        obj.target === target && 
        state.mainQuestProgress.objectives[idx] < obj.amount
      );
    }

    let needsSideUpdate = false;
    for (const sq of state.sideQuests) {
      if (sq.completed) continue;
      const registryData = questsRegistry.side_quests_pool.find(q => q.id === sq.questId);
      if (!registryData) continue;
      if (registryData.objectives.some((obj, idx) => 
        obj.type.toLowerCase() === typeLower && 
        obj.target === target && 
        sq.objectives[idx] < obj.amount
      )) {
        needsSideUpdate = true;
        break;
      }
    }

    // Zero-allocation exit if no relevant active quests
    if (!needsMainUpdate && !needsSideUpdate) return;

    // 1. Update Main Quest (Shared)
    if (needsMainUpdate) {
      let newMainProgress = { ...state.mainQuestProgress, objectives: [...state.mainQuestProgress.objectives] };
      activeMainQuest.objectives.forEach((obj, idx) => {
        if (obj.type.toLowerCase() === typeLower && obj.target === target && newMainProgress.objectives[idx] < obj.amount) {
          newMainProgress.objectives[idx] += amount;
          if (newMainProgress.objectives[idx] > obj.amount) newMainProgress.objectives[idx] = obj.amount;
        }
      });

      // Check Completion
      const isComplete = activeMainQuest.objectives.every((obj, idx) => newMainProgress.objectives[idx] >= obj.amount);
      if (isComplete) {
        newMainProgress.completed = true;
      }
      set({ mainQuestProgress: newMainProgress });
      get().saveQuestState();

      // If Host, broadcast to guests
      const ns = getNetworkStore()?.getState();
      if (ns && ns.isHost) {
        if (isComplete) {
          get().giveMainQuestRewards(activeMainQuest.id);
          ns.connections?.forEach(conn => {
            try { conn.send({ type: 'MAIN_QUEST_COMPLETED', questId: activeMainQuest.id }); } catch (e) { /* ignore */ }
          });
        }
        ns.connections?.forEach(conn => {
          try {
            conn.send({ type: 'MAIN_QUEST_PROGRESS', syncLevel: state.syncLevel, progress: newMainProgress });
          } catch (e) { /* ignore */ }
        });
      } else {
        // If Guest, send intent to host so host can validate/echo
        if (ns && ns.connections && ns.connections[0]) {
          try {
            ns.connections[0].send({ type: 'MAIN_QUEST_INTENT', update: { type, target, amount } });
          } catch (e) { /* ignore */ }
        }
      }
    }

    // 2. Update Side Quests (Local)
    if (needsSideUpdate) {
      set(prev => {
        let newSideQuests = [...prev.sideQuests];
        let newCompleted = { ...prev.completedQuests };

        newSideQuests = newSideQuests.map(sq => {
           if (sq.completed) return sq;
           const registryData = questsRegistry.side_quests_pool.find(q => q.id === sq.questId);
           if (!registryData) return sq;

           let newObj = [...sq.objectives];
           let modified = false;

           registryData.objectives.forEach((obj, idx) => {
              if (obj.type.toLowerCase() === typeLower && obj.target === target && newObj[idx] < obj.amount) {
                 newObj[idx] += amount;
                 if (newObj[idx] > obj.amount) newObj[idx] = obj.amount;
                 modified = true;
              }
           });
           
           if (modified) {
              const isComplete = registryData.objectives.every((obj, idx) => newObj[idx] >= obj.amount);
              if (isComplete) {
                 if (registryData.rewards.data && get().addData) get().addData(registryData.rewards.data);
                 newCompleted[sq.questId] = true;
                 return { ...sq, objectives: newObj, completed: true };
              }
              return { ...sq, objectives: newObj };
           }
           return sq;
        });

        setTimeout(() => get().saveQuestState(), 0);
        return { sideQuests: newSideQuests, completedQuests: newCompleted };
      });
    }
  },

  acceptSideQuest: (questId) => {
    set(state => {
       const exists = state.sideQuests.find(sq => sq.questId === questId && !sq.completed);
       if (exists) return {};
       const registryData = questsRegistry.side_quests_pool.find(q => q.id === questId);
       if (!registryData) return {};
       
       const newSq = { questId, objectives: new Array(registryData.objectives.length).fill(0), completed: false };
       setTimeout(() => get().saveQuestState(), 0);
       return {
         sideQuests: [...state.sideQuests, newSq]
       };
    });
  }
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (saveTimeout) clearTimeout(saveTimeout);
  });
}
