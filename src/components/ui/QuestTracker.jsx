import { useStore } from '../../stores/useStore';
import { motion, AnimatePresence } from 'framer-motion';
import questsRegistry from '../../registry/quests.json';

export const QuestTracker = () => {
  const mainQuestProgress = useStore((state) => state.mainQuestProgress);
  const sideQuests = useStore((state) => state.sideQuests);

  if (!mainQuestProgress) return null;

  const activeQuests = [];

  const activeMain = questsRegistry.main_quests.find(q => q.id === mainQuestProgress.questId);
  if (activeMain && !mainQuestProgress.completed) {
    activeQuests.push({
      id: activeMain.id,
      title: activeMain.title,
      autoComplete: true,
      objectives: activeMain.objectives.map((obj, i) => ({
        id: `${activeMain.id}_obj_${i}`,
        type: obj.type.toUpperCase(),
        target: obj.target,
        count: mainQuestProgress.objectives[i] || 0,
        required: obj.amount
      }))
    });
  }

  if (sideQuests) {
    sideQuests.forEach(sq => {
      if (sq.completed) return;
      const registryData = questsRegistry.side_quests_pool.find(q => q.id === sq.questId);
      if (registryData) {
        activeQuests.push({
          id: registryData.id,
          title: registryData.title,
          autoComplete: true,
          objectives: registryData.objectives.map((obj, i) => ({
            id: `${registryData.id}_obj_${i}`,
            type: obj.type.toUpperCase(),
            target: obj.target,
            count: sq.objectives[i] || 0,
            required: obj.amount
          }))
        });
      }
    });
  }

  if (activeQuests.length === 0) return null;

  return (
    <div className="fixed right-8 top-1/4 w-72 flex flex-col gap-3 pointer-events-none z-40">
      <AnimatePresence>
        {activeQuests.map((quest) => (
          <motion.div 
            layout
            initial={{ opacity: 0, x: 30, filter: "blur(4px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.95, filter: "blur(4px)", transition: { duration: 0.2 } }}
            key={quest.id} 
            className="bg-zinc-950/40 backdrop-blur-md border-l-2 border-cyan-400 p-4 rounded-r-xl shadow-[0_8px_32px_rgba(0,0,0,0.3)] flex flex-col gap-1 pointer-events-auto"
          >
            <div className="flex justify-between items-start mb-1">
              <h4 className="text-sm font-semibold text-gray-100 tracking-wide drop-shadow">{quest.title}</h4>
              {quest.autoComplete && <span className="text-[9px] text-cyan-400 border border-cyan-800 bg-cyan-900/30 px-1 rounded uppercase tracking-widest">Auto</span>}
            </div>
            
            <div className="flex flex-col gap-3 mt-1">
              {quest.objectives.map(obj => {
                const isDone = obj.count >= obj.required;
                const percentage = Math.min(100, (obj.count / obj.required) * 100);
                
                return (
                  <div key={obj.id} className="flex flex-col gap-1">
                    <div className="flex justify-between items-center">
                      <span className={`text-xs font-mono drop-shadow-md transition-colors ${isDone ? 'text-gray-500 line-through' : 'text-gray-400'}`}>
                        {obj.type === 'KILL' ? `Defeat ${obj.target}` : 
                         obj.type === 'MINE' ? `Mine ${obj.target}` : 
                         `${obj.type} ${obj.target}`}
                      </span>
                    </div>
                    {/* CSS Progress Bar */}
                    <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden mt-0.5">
                      <div 
                        className={`h-full transition-all duration-500 ${isDone ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-cyan-400 shadow-[0_0_8px_theme(colors.cyan.400)]'}`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
