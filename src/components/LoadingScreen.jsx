import { useStore } from '../stores/useStore';
import { useState } from 'react';

const TIPS = [
  'Scan for underground caverns — alien minerals await.',
  'Flare light travels 15 blocks. Plan accordingly.',
  'Enemies only spawn during the night cycle.',
  'Hardened Bedrock is indestructible. Even TNT cannot crack it.',
  'Pick up items by walking over them.',
  'The Fabricator (B) lets you spend Scrap Metals on upgrades.',
  'Holding Alt and clicking force-breaks any block instantly.',
  'Creative mode gives you infinite blocks. Survival mode makes you earn them.',
];

export const LoadingScreen = () => {
  const progress = useStore(state => state.loadingProgress);
  const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);

  return (
    <div className="fixed inset-0 z-[9999] backdrop-blur-[60px] bg-[#0b0c10]/90 flex flex-col items-center justify-center font-sans text-white select-none">
      <div className="bg-white/5 border border-white/10 rounded-2xl p-8 w-[400px] flex flex-col items-center shadow-[0_0_50px_rgba(34,211,238,0.05)]">
         <h2 className="text-xl font-light tracking-[0.3em] text-cyan-400 mb-6 uppercase text-center">
            Loading Terrain
         </h2>
         <div className="w-full h-[2px] bg-white/10 rounded-full mb-2 overflow-hidden relative">
            <div className="absolute h-full bg-cyan-400 shadow-[0_0_15px_#22d3ee] transition-all duration-300 ease-out" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
         </div>
         <div className="flex justify-between w-full text-[10px] text-white/50 font-mono mb-8 uppercase tracking-widest">
            <span>Generating Chunks...</span>
            <span className="text-cyan-300">{Math.floor(progress)}%</span>
         </div>
         <div className="border-t border-white/10 pt-5 w-full text-center">
            <span className="text-[9px] tracking-[0.4em] text-cyan-400/50 font-bold block mb-2">SYSTEM TIP</span>
            <span className="text-xs text-white/60 italic font-light">"{tip}"</span>
         </div>
      </div>
    </div>
  );
};
