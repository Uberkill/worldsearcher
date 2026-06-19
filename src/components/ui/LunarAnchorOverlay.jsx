
import { useState } from 'react';
import { useStore } from '../../stores/useStore';
import { Anchor, AlertTriangle, X, Compass, Wind, Navigation } from 'lucide-react';
import { EventBus } from '../../utils/EventBus';
import { networkActions } from '../../stores/networkActions';

export const LunarAnchorOverlay = ({ active, onClose }) => {
  const isTransitMode = useStore((state) => state.isTransitMode);
  const toggleTransitMode = useStore((state) => state.toggleTransitMode);
  const shipCorePower = useStore((state) => state.shipCorePower);
  const [targetX, setTargetX] = useState('');
  const [targetZ, setTargetZ] = useState('');

  if (!active) return null;

  const handleToggle = () => {
    if (!isTransitMode && shipCorePower < 1000) {
      // Not enough power to engage
      EventBus.emit('audio', { sound: 'error', source: 'local' });
      return;
    }
    
    const netState = networkActions.getState();
    if (netState) {
       if (netState.isHost) {
          toggleTransitMode();
          netState.broadcastEvent({ type: 'WARP_SYNC', active: !isTransitMode });
       } else {
          // Guest sends intent
          const reliableConn = netState.connections[0];
          if (reliableConn) {
             try { reliableConn.send({ type: 'WARP_INTENT' }); } catch {}
          }
       }
    } else {
       // Singleplayer fallback
       toggleTransitMode();
    }
  };

  const handleShortJump = () => {
     if (shipCorePower < 2500 || targetX === '' || targetZ === '') {
        EventBus.emit('audio', { sound: 'error', source: 'local' });
        return;
     }
     
     const netState = networkActions.getState();
     if (netState) {
        if (netState.isHost) {
           useStore.getState().drainShipPower(2500);
           const rot = useStore.getState().shipTransform.rotation;
           const pos = [Number(targetX), 10000, Number(targetZ)];
           useStore.getState().setShipTransform(pos, rot);
           netState.broadcastEvent({ type: 'SHIP_TRANSFORM', position: pos, rotation: rot, power: shipCorePower - 2500 });
        } else {
           const reliableConn = netState.connections[0];
           if (reliableConn) {
              try { reliableConn.send({ type: 'SHORT_WARP_INTENT', x: Number(targetX), z: Number(targetZ) }); } catch {}
           }
        }
     } else {
        useStore.getState().drainShipPower(2500);
        useStore.getState().setShipTransform([Number(targetX), 10000, Number(targetZ)], useStore.getState().shipTransform.rotation);
     }
     EventBus.emit('audio', { sound: 'ui_click', source: 'local' });
     onClose();
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center z-50 pointer-events-auto select-none" onClick={onClose}>
      <div 
        className="bg-black/90 backdrop-blur-xl border border-indigo-500/30 rounded-2xl p-8 w-[450px] shadow-[0_0_50px_rgba(99,102,241,0.1)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-4">
          <div className="flex items-center space-x-3">
            <Anchor className="text-indigo-400 drop-shadow-[0_0_8px_#818cf8]" size={28} />
            <h2 className="text-2xl font-medium tracking-[0.2em] text-white">
              LUNAR <span className="font-bold text-indigo-400">ANCHOR</span>
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        <div className="space-y-8">
          <div className="bg-black/50 border border-white/5 rounded-xl p-6 text-center">
            <Compass className={`mx-auto mb-4 text-indigo-400 ${isTransitMode ? 'animate-spin' : ''}`} size={48} />
            
            <h3 className="text-xl font-bold tracking-widest text-white mb-2 uppercase">
              {isTransitMode ? 'Transit Mode Engaged' : 'Anchored to Sector'}
            </h3>
            <p className="text-sm font-medium text-white/50 mb-6">
              {isTransitMode 
                ? 'WARNING: Reality degradation detected. Glitch storms imminent.' 
                : 'Ship is stable. Safe to extract resources from nearby sky islands.'}
            </p>

            <button
              onClick={handleToggle}
              className={`relative overflow-hidden w-full py-4 rounded-lg font-bold tracking-widest uppercase transition-all flex justify-center items-center space-x-3 ${
                isTransitMode
                  ? 'bg-red-500 hover:bg-red-400 text-white shadow-[0_0_20px_rgba(239,68,68,0.4)]'
                  : shipCorePower >= 1000
                    ? 'bg-indigo-500 hover:bg-indigo-400 text-white shadow-[0_0_20px_rgba(99,102,241,0.4)]'
                    : 'bg-white/5 text-white/30 border border-white/10 cursor-not-allowed'
              }`}
            >
              {isTransitMode && (
                <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImEiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTTAgNDBMNDAgMEg0MHY0MEgwem0wIDBoNDBMMCA0MFYweiIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjEpIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjYSkiLz48L3N2Zz4=')] opacity-30 animate-[slide_1s_linear_infinite]" />
              )}
              
              <Wind size={20} className="relative z-10" />
              <span className="relative z-10">
                {isTransitMode ? 'Disengage Thrusters' : 'Engage Transit Mode'}
              </span>
            </button>
            
            {!isTransitMode && shipCorePower < 1000 && (
              <div className="mt-4 flex items-center justify-center space-x-2 text-amber-400 text-xs">
                <AlertTriangle size={14} />
                <span>Insufficient Core Power (1000 Required)</span>
              </div>
            )}
            
            {isTransitMode && (
              <div className="mt-8 border-t border-white/10 pt-6">
                <h4 className="text-sm font-bold tracking-widest text-white mb-4 uppercase">Short Jump Coordinates</h4>
                <div className="flex space-x-4 mb-4">
                   <input
                     type="number"
                     placeholder="X Coord"
                     value={targetX}
                     onChange={(e) => setTargetX(e.target.value)}
                     className="w-1/2 bg-black/40 border border-white/10 rounded px-4 py-2 text-white font-mono"
                   />
                   <input
                     type="number"
                     placeholder="Z Coord"
                     value={targetZ}
                     onChange={(e) => setTargetZ(e.target.value)}
                     className="w-1/2 bg-black/40 border border-white/10 rounded px-4 py-2 text-white font-mono"
                   />
                </div>
                <button
                  onClick={handleShortJump}
                  disabled={shipCorePower < 2500 || targetX === '' || targetZ === ''}
                  className={`w-full py-3 rounded-lg font-bold tracking-widest uppercase transition-all flex justify-center items-center space-x-3 ${
                    shipCorePower >= 2500 && targetX !== '' && targetZ !== ''
                      ? 'bg-white/20 hover:bg-white/40 text-white shadow-md'
                      : 'bg-white/5 text-white/30 border border-white/10 cursor-not-allowed'
                  }`}
                >
                  <Navigation size={18} />
                  <span>Short Jump (2500 Power)</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
