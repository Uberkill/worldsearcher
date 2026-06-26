// @ts-nocheck
import { useEffect, useRef } from 'react';
import { useStore } from '../../stores/useStore';
import { Zap, Heart } from 'lucide-react';

export const ShipHUD = () => {
  const powerRef = useRef(null);
  const powerBarRef = useRef(null);
  const healthRef = useRef(null);
  const healthBarRef = useRef(null);
  const coordsRef = useRef(null);
  const speedRef = useRef(null);

  useEffect(() => {
    let lastPos = [0, 0, 0];
    let lastTime = performance.now();
    let rAF;

    const tick = (time) => {
      const state = useStore.getState();
      const power = state.shipCorePower || 0;
      const maxPower = state.shipMaxPower || 10000;
      const health = state.shipHealth || 0;
      const maxHealth = state.shipMaxHealth || 100;
      
      if (powerRef.current) powerRef.current.innerText = Math.ceil(power);
      if (powerBarRef.current) {
         const percentage = Math.max(0, Math.min(100, (power / maxPower) * 100));
         powerBarRef.current.style.width = `${percentage}%`;
      }
      
      if (healthRef.current) healthRef.current.innerText = Math.ceil(health);
      if (healthBarRef.current) {
         const percentage = Math.max(0, Math.min(100, (health / maxHealth) * 100));
         healthBarRef.current.style.width = `${percentage}%`;
         if (health <= 0) {
             healthBarRef.current.className = "absolute left-0 top-0 bottom-0 bg-red-600 border-r border-red-400 shadow-[0_0_15px_rgba(220,38,38,0.8)] transition-all duration-100";
         } else {
             healthBarRef.current.className = "absolute left-0 top-0 bottom-0 bg-green-500/80 border-r border-green-300/80 shadow-[0_0_15px_rgba(34,197,94,0.5)] transition-all duration-100";
         }
      }
      
      const pos = state.shipTransform?.position || [0,0,0];
      if (coordsRef.current) {
         coordsRef.current.innerText = `X: ${Math.round(pos[0])} Y: ${Math.round(pos[1])} Z: ${Math.round(pos[2])}`;
      }
      
      // Update velocity every 100ms approx
      if (time - lastTime > 100) {
          const dist = Math.sqrt(
             Math.pow(pos[0] - lastPos[0], 2) +
             Math.pow(pos[1] - lastPos[1], 2) +
             Math.pow(pos[2] - lastPos[2], 2)
          );
          if (speedRef.current) {
             // dist is per 100ms, so multiply by 10 for units/sec
             speedRef.current.innerText = `${Math.round(dist * 10)} u/s`;
          }
          lastPos = [...pos];
          lastTime = time;
      }
      
      rAF = requestAnimationFrame(tick);
    };
    
    rAF = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rAF);
  }, []);

  return (
    <div className="absolute top-24 left-1/2 -translate-x-1/2 flex items-center space-x-6 pointer-events-none z-50 transition-all duration-500">
      <div className="flex flex-col items-center bg-black/80 backdrop-blur-xl border border-white/10 px-8 py-4 rounded-3xl shadow-[0_0_30px_rgba(255,255,255,0.05)]">
        <h2 className="text-[10px] text-white font-bold tracking-[0.4em] mb-4 uppercase">Ghost Ship Systems</h2>
        
        {/* Core Power */}
        <div className="flex items-center space-x-4 mb-3 w-full">
          <Zap size={20} className="text-amber-400 drop-shadow-[0_0_8px_#fbbf24]" />
          <div className="w-64 h-3 bg-black/60 rounded-full border border-white/10 overflow-hidden shadow-inner relative">
            <div
              ref={powerBarRef}
              className="absolute left-0 top-0 bottom-0 bg-amber-400/80 border-r border-amber-200/80 shadow-[0_0_15px_rgba(251,191,36,0.5)] transition-all duration-100"
              style={{ width: '100%' }}
            />
          </div>
          <span ref={powerRef} className="font-mono text-sm font-bold text-amber-300 drop-shadow-md w-12 text-right">10000</span>
        </div>
        
        {/* Ship Hull Health */}
        <div className="flex items-center space-x-4 mb-5 w-full">
          <Heart size={20} className="text-green-400 drop-shadow-[0_0_8px_#22c55e]" />
          <div className="w-64 h-3 bg-black/60 rounded-full border border-white/10 overflow-hidden shadow-inner relative">
            <div
              ref={healthBarRef}
              className="absolute left-0 top-0 bottom-0 bg-green-500/80 border-r border-green-300/80 shadow-[0_0_15px_rgba(34,197,94,0.5)] transition-all duration-100"
              style={{ width: '100%' }}
            />
          </div>
          <span ref={healthRef} className="font-mono text-sm font-bold text-green-300 drop-shadow-md w-12 text-right">100</span>
        </div>
        
        <div className="flex space-x-8 w-full justify-between">
           {/* Coords */}
           <div className="flex flex-col">
              <span className="text-[9px] text-white/50 uppercase tracking-widest mb-1">Telemetry</span>
              <span ref={coordsRef} className="font-mono text-xs text-white">X: 0 Y: 0 Z: 0</span>
           </div>
           
           {/* Speed */}
           <div className="flex flex-col items-end">
              <span className="text-[9px] text-white/50 uppercase tracking-widest mb-1">Velocity</span>
              <span ref={speedRef} className="font-mono text-xs text-white/90">0 u/s</span>
           </div>
        </div>
      </div>
    </div>
  );
};

