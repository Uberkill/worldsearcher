// @ts-nocheck
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../../stores/useStore';
import { SkillsRegistry as skillsData } from '../../registry/SkillsRegistry';

const getCategoryColor = (category) => {
  switch(category) {
    case 'Combat': return 'text-rose-400';
    case 'Traversal': return 'text-emerald-400';
    case 'Magic': return 'text-blue-400';
    default: return 'text-slate-100';
  }
};

export const SkillTreeOverlay = ({ active, onClose }) => {
  const playerData = useStore((state) => state.playerData);
  const authoritativeSkills = useStore((state) => state.authoritativeSkills);
  const unlockSkill = useStore((state) => state.unlockSkill);

  if (!active) return null;

  const handleUnlock = (nodeId, cost, prereqs) => {
    if (playerData < cost) return;
    if (prereqs.length > 0 && !prereqs.every(req => authoritativeSkills.includes(req))) return;
    unlockSkill(nodeId);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
      >
        <div className="bg-slate-900/80 backdrop-blur-md border border-white/10 rounded-xl p-8 w-full max-w-4xl shadow-2xl pointer-events-auto overflow-hidden flex flex-col max-h-[80vh]">
          
          {/* Header */}
          <div className="flex justify-between items-center mb-6 border-b border-slate-700 pb-4">
            <div>
              <h2 className="text-3xl font-bold tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-white to-white/60 uppercase">
                Skill Tree
              </h2>
              <p className="text-slate-400 text-sm mt-1">Allocate Data to upgrade your abilities.</p>
            </div>
            <div className="text-right">
              <div className="text-sm text-slate-400 uppercase tracking-wider">Available Data</div>
              <div className="text-2xl font-bold text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.1)]">
                {playerData} KB
              </div>
            </div>
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>

          {/* Nodes Grid */}
          <div className="flex-1 overflow-y-auto pr-2 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {skillsData.skills.map((skill) => {
              const isUnlocked = authoritativeSkills.includes(skill.id);
              const canAfford = playerData >= skill.cost;
              const hasPrereqs = skill.prerequisites.length === 0 || skill.prerequisites.every(req => authoritativeSkills.includes(req));
              const canUnlock = !isUnlocked && canAfford && hasPrereqs;

              return (
                <motion.div
                  key={skill.id}
                  whileHover={{ scale: 1.02 }}
                  className={`p-5 rounded-lg border flex flex-col justify-between transition-all duration-300 ${
                    isUnlocked
                      ? 'bg-white/10 border-white/20 shadow-md'
                      : canUnlock
                      ? 'bg-slate-800/60 border-slate-600 hover:border-white/20 cursor-pointer'
                      : 'bg-slate-900/40 border-slate-800 opacity-60'
                  }`}
                  onClick={() => { if (canUnlock) handleUnlock(skill.id, skill.cost, skill.prerequisites); }}
                >
                  <div>
                    <div className="flex justify-between items-start mb-2">
                      <h3 className={`font-bold text-lg ${isUnlocked ? 'text-white/90' : 'text-slate-200'}`}>
                        {skill.name}
                      </h3>
                      <span className={`text-xs uppercase font-bold tracking-wider ${getCategoryColor(skill.category)}`}>
                        {skill.category}
                      </span>
                    </div>
                    <p className="text-sm text-slate-400 mb-4">{skill.description}</p>
                    
                    {skill.prerequisites.length > 0 && !isUnlocked && (
                      <div className="text-xs text-slate-500 mb-2">
                        Requires: {skill.prerequisites.join(', ')}
                      </div>
                    )}
                  </div>

                  <div className="flex justify-between items-end mt-4">
                    <span className={`font-mono text-sm ${isUnlocked ? 'text-transparent' : canAfford ? 'text-white' : 'text-rose-500'}`}>
                      {isUnlocked ? 'UNLOCKED' : `Cost: ${skill.cost} KB`}
                    </span>
                    
                    {!isUnlocked && canUnlock && (
                      <span className="text-xs bg-white/20 text-white/90 px-2 py-1 rounded">
                        Click to Unlock
                      </span>
                    )}
                    {isUnlocked && (
                      <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded">
                        Active
                      </span>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

