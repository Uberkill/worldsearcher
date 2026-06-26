// @ts-nocheck
import { useStore } from '../../stores/useStore';
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';

export const DataBufferHUD = () => {
  const playerData = useStore((state) => state.playerData) || 0;
  const syncRate = useStore((state) => state.syncRate) || 1.0;
  
  const [dataStream, setDataStream] = useState([]);
  
  useEffect(() => {
    const handleDataGain = (e) => {
      const amount = e.detail?.amount || 0;
      const id = Date.now() + Math.random();
      setDataStream(prev => [...prev, { id, amount }]);
      setTimeout(() => {
        setDataStream(prev => prev.filter(item => item.id !== id));
      }, 1500); // give 1.5 seconds to read
    };
    
    window.addEventListener('XP_GAINED', handleDataGain);
    return () => window.removeEventListener('XP_GAINED', handleDataGain);
  }, []);

  const maxData = 1000 * Math.max(1, Math.floor(syncRate));
  const percentage = Math.min(100, (playerData / maxData) * 100);

  return (
    <div className="absolute bottom-16 right-1/2 translate-x-1/2 flex flex-col items-center gap-1 pointer-events-none z-40 w-96 opacity-90 transition-all duration-300">
      <div className="flex justify-between w-full px-1 text-[10px] font-mono font-bold tracking-widest uppercase text-amber-500/80 drop-shadow-[0_0_4px_rgba(245,158,11,0.5)]">
        <span>Sync Rate v{syncRate.toFixed(1)}</span>
        <span>Data Buffer: {playerData} KB / {maxData} KB</span>
      </div>
      
      <div className="relative w-full h-2 border border-amber-500/40 bg-zinc-950/80 backdrop-blur-md overflow-hidden ring-1 ring-amber-500/10">
        <div 
          className="h-full bg-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.8)] transition-all duration-300 relative"
          style={{ width: `${percentage}%` }}
        >
          {/* Hex-grid / scanline texture overlay */}
          <div className="absolute inset-0 opacity-30 bg-[repeating-linear-gradient(45deg,transparent,transparent_2px,#000_2px,#000_4px)] mix-blend-multiply" />
        </div>
        
        {/* Stream flashes */}
        <AnimatePresence>
          {dataStream.map(item => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              transition={{ duration: 0.4 }}
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
            >
              <span className="bg-black/80 border border-amber-500/50 px-2 py-0.5 text-xs font-mono font-bold tracking-widest text-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.5)] z-50">
                [ +{item.amount} KB ]
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};

