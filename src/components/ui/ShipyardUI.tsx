import React from 'react';
import { useStore } from '../../stores/useStore';
import { networkActions } from '../../stores/networkActions';
import { Rocket, AlertTriangle, X, ShieldAlert, Trash2 } from 'lucide-react';
import { EventBus } from '../../utils/EventBus';

export const ShipyardUI = ({ active, onClose }) => {
  const isShipActive = useStore((state) => state.isShipActive);
  const corePos = useStore((state) => state.shipyardCorePos);

  if (!active) return null;

  const handleLaunch = () => {
    if (isShipActive) return;
    if (!corePos) return;

    EventBus.emit('audio', { sound: 'click', source: 'local' });
    const req = { type: 'LAUNCH_SHIP_INTENT', pos: corePos };
    const netState = networkActions.getState();
    if (netState.isHost) netState.handleNetworkData(req);
    else netState.broadcastEvent(req);

    // Provide immediate UI feedback
    useStore.setState({ isShipActive: true });
    onClose();
  };

  const handleDeconstruct = () => {
    if (!isShipActive) return;

    EventBus.emit('audio', { sound: 'explosion', source: 'local' });
    const req = { type: 'DECONSTRUCT_SHIP_INTENT' };
    const netState = networkActions.getState();
    if (netState.isHost) netState.handleNetworkData(req);
    else netState.broadcastEvent(req);

    onClose();
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center z-50 pointer-events-auto select-none" onClick={onClose}>
      <div 
        className={`bg-black/90 backdrop-blur-xl border rounded-2xl p-8 w-[500px] transition-all duration-500 ${
          isShipActive ? 'border-red-500/30 shadow-[0_0_50px_rgba(239,68,68,0.1)]' : 'border-white/10 shadow-[0_0_50px_rgba(255,255,255,0.04)]'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-4">
          <div className="flex items-center space-x-3">
            {isShipActive ? (
              <ShieldAlert className="text-red-400 drop-shadow-[0_0_8px_#ef4444]" size={28} />
            ) : (
              <Rocket className="text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.2)]" size={28} />
            )}
            <h2 className="text-2xl font-medium tracking-[0.2em] text-white">
              SHIP<span className={`font-bold ${isShipActive ? 'text-red-400' : 'text-white'}`}>
                {isShipActive ? 'MGMT' : 'YARD'}
              </span>
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        <div className="space-y-6">
          <div className="bg-black/50 border border-white/5 rounded-xl p-6">
            <p className="text-white/70 text-sm leading-relaxed mb-4">
              {isShipActive 
                ? "This core is connected to the active ship network. Deconstructing the ship will instantly vaporize it. Players on board will fall, and all blocks will be permanently destroyed."
                : "Initiating the Launch Sequence will scan the 32x32x32 holographic boundary around this core. All structural blocks within the grid will be detached from the world and converted into a flying ship."
              }
            </p>

            {isShipActive ? (
              <div className="flex items-start space-x-3 text-red-400 bg-red-900/20 px-4 py-3 rounded-lg border border-red-500/30">
                <ShieldAlert size={20} className="shrink-0 mt-0.5" />
                <div className="flex flex-col">
                  <span className="text-sm font-bold tracking-widest uppercase">Critical Warning</span>
                  <span className="text-xs text-red-300/80 mt-1">Deconstruction is instantaneous and irreversible. All ship inventory and warp fuel will be lost.</span>
                </div>
              </div>
            ) : (
              <div className="flex items-start space-x-3 text-amber-400 bg-amber-900/20 px-4 py-3 rounded-lg border border-amber-500/30">
                <AlertTriangle size={20} className="shrink-0 mt-0.5" />
                <div className="flex flex-col">
                  <span className="text-sm font-bold tracking-widest uppercase">Warning</span>
                  <span className="text-xs text-amber-300/80 mt-1">Natural terrain blocks (Grass, Dirt, Stone) will be ignored. Only building materials will be launched.</span>
                </div>
              </div>
            )}
          </div>

          {isShipActive ? (
            <button
              onClick={handleDeconstruct}
              className="w-full py-4 rounded-xl font-bold tracking-[0.2em] uppercase transition-all flex justify-center items-center space-x-3 bg-red-600 hover:bg-red-500 text-white shadow-[0_0_20px_rgba(239,68,68,0.4)] hover:shadow-[0_0_30px_rgba(239,68,68,0.6)]"
            >
              <Trash2 size={20} />
              <span>Deconstruct Ship</span>
            </button>
          ) : (
            <button
              onClick={handleLaunch}
              className="w-full py-4 rounded-xl font-bold tracking-[0.2em] uppercase transition-all flex justify-center items-center space-x-3 bg-white hover:bg-white/90 text-black shadow-md"
            >
              <Rocket size={20} />
              <span>Launch Ship</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
