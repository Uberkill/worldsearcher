import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../../stores/useStore';
import questsData from '../../registry/quests.json';
import { networkActions } from '../../stores/networkActions';

export const QuestJournal = () => {
  const isQuestJournalOpen = useStore((state) => state.isQuestJournalOpen);
  const toggleQuestJournal = useStore((state) => state.toggleQuestJournal);
  const mainQuestProgress = useStore((state) => state.mainQuestProgress);
  const sideQuests = useStore((state) => state.sideQuests);
  
  const isHost = networkActions(state => state.isHost);
  const advanceMainQuest = useStore((state) => state.advanceMainQuest);

  if (!isQuestJournalOpen) return null;

  const currentMainQuest = questsData.main_quests.find(q => q.id === mainQuestProgress?.questId);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: 50 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 50 }}
        className="fixed top-20 right-8 z-40 w-96 max-w-[90vw] pointer-events-none"
      >
        <div className="bg-slate-900/70 backdrop-blur-lg border-l border-t border-b border-cyan-500/20 rounded-l-xl p-6 shadow-[0_0_20px_rgba(0,0,0,0.5)] pointer-events-auto max-h-[80vh] overflow-y-auto">
          
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-yellow-500 uppercase">
              Quest Journal
            </h2>
            <button
              onClick={toggleQuestJournal}
              className="text-slate-400 hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>

          {/* Main Quest Section */}
          <div className="mb-8">
            <h3 className="text-sm uppercase tracking-widest text-slate-400 mb-3 border-b border-slate-700 pb-1">Primary Directive</h3>
            
            {currentMainQuest ? (
              <div className="bg-slate-800/50 p-4 rounded-lg border border-amber-500/30 shadow-[inset_0_0_10px_rgba(245,158,11,0.1)]">
                <h4 className="text-lg font-bold text-amber-400 mb-1">{currentMainQuest.title}</h4>
                <p className="text-xs text-slate-300 mb-4">{currentMainQuest.description}</p>
                
                <div className="space-y-2">
                  {currentMainQuest.objectives.map((obj, idx) => {
                    const current = mainQuestProgress.objectives[idx] || 0;
                    const max = obj.amount;
                    const percent = Math.min(100, (current / max) * 100);
                    return (
                      <div key={idx}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-200 capitalize">{obj.type} {obj.target.replace('_', ' ')}</span>
                          <span className={current >= max ? "text-emerald-400" : "text-amber-200"}>{current} / {max}</span>
                        </div>
                        <div className="h-1.5 bg-slate-900 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${percent}%` }}
                            className={`h-full ${current >= max ? 'bg-emerald-500' : 'bg-amber-500'}`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {mainQuestProgress.completed && isHost && (
                  <button 
                    onClick={advanceMainQuest}
                    className="mt-4 w-full py-2 bg-gradient-to-r from-amber-500 to-orange-600 text-white font-bold rounded shadow-lg hover:scale-105 transition-transform"
                  >
                    Complete & Continue
                  </button>
                )}
                {mainQuestProgress.completed && !isHost && (
                  <div className="mt-4 text-xs text-amber-300 italic text-center">
                    Waiting for Host to advance the story...
                  </div>
                )}
              </div>
            ) : (
              <div className="text-slate-500 italic text-sm">No primary directive active.</div>
            )}
          </div>

          {/* Side Quests Section */}
          <div>
            <h3 className="text-sm uppercase tracking-widest text-slate-400 mb-3 border-b border-slate-700 pb-1">Active Bounties</h3>
            
            {sideQuests.length > 0 ? (
              <div className="space-y-4">
                {sideQuests.filter(sq => !sq.completed).map((sq) => {
                  const registryData = questsData.side_quests_pool.find(q => q.id === sq.questId);
                  if (!registryData) return null;

                  return (
                    <div key={sq.questId} className="bg-slate-800/30 p-3 rounded-lg border border-slate-700">
                      <h4 className="text-md font-bold text-cyan-300 mb-1">{registryData.title}</h4>
                      <p className="text-xs text-slate-400 mb-3">{registryData.description}</p>
                      
                      <div className="space-y-2">
                        {registryData.objectives.map((obj, idx) => {
                          const current = sq.objectives[idx] || 0;
                          const max = obj.amount;
                          const percent = Math.min(100, (current / max) * 100);
                          return (
                            <div key={idx}>
                              <div className="flex justify-between text-[10px] mb-1">
                                <span className="text-slate-300 capitalize">{obj.type} {obj.target.replace('_', ' ')}</span>
                                <span className={current >= max ? "text-emerald-400" : "text-cyan-200"}>{current} / {max}</span>
                              </div>
                              <div className="h-1 bg-slate-900 rounded-full overflow-hidden">
                                <motion.div 
                                  initial={{ width: 0 }}
                                  animate={{ width: `${percent}%` }}
                                  className={`h-full ${current >= max ? 'bg-emerald-500' : 'bg-cyan-500'}`}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-slate-500 italic text-sm">No active bounties.</div>
            )}
          </div>

        </div>
      </motion.div>
    </AnimatePresence>
  );
};
