
import { useStore } from '../../stores/useStore';
import { Battery, Zap, AlertTriangle, X } from 'lucide-react';

export const HeartCoreOverlay = ({ active, onClose }) => {
  const shipCorePower = useStore((state) => state.shipCorePower);
  const shipMaxPower = useStore((state) => state.shipMaxPower);
  const chargeShipPower = useStore((state) => state.chargeShipPower);
  const inventory = useStore((state) => state.inventory);
  const executeLocalTransaction = useStore((state) => state.executeLocalTransaction);

  if (!active) return null;

  const percentage = Math.min(100, Math.max(0, (shipCorePower / shipMaxPower) * 100));

  const handleConsumeSpark = () => {
    // Find spark in inventory
    const sparkIndex = inventory.findIndex(item => item && (item.texture === 'spark_node' || item.texture === 'spark_crystal'));
    if (sparkIndex !== -1) {
      executeLocalTransaction({ type: 'inventory', index: sparkIndex }, null, 'DROP', 1);
      chargeShipPower(2500); // 25% charge per spark
    }
  };

  const sparkCount = inventory.reduce((acc, item) => {
    if (item && (item.texture === 'spark_node' || item.texture === 'spark_crystal')) {
      return acc + item.count;
    }
    return acc;
  }, 0);

  return (
    <div className="absolute inset-0 flex items-center justify-center z-50 pointer-events-auto select-none" onClick={onClose}>
      <div 
        className="bg-black/90 backdrop-blur-xl border border-cyan-500/30 rounded-2xl p-8 w-[500px] shadow-[0_0_50px_rgba(34,211,238,0.1)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-4">
          <div className="flex items-center space-x-3">
            <Zap className="text-cyan-400 drop-shadow-[0_0_8px_#22d3ee]" size={28} />
            <h2 className="text-2xl font-light tracking-[0.2em] text-white">
              HEART <span className="font-bold text-cyan-400">CORE</span>
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
          {/* Main Core Readout */}
          <div className="bg-black/50 border border-white/5 rounded-xl p-6">
            <div className="flex justify-between items-end mb-2">
              <span className="text-sm font-bold tracking-widest text-white/50 uppercase">Core Capacity</span>
              <span className="font-mono text-xl text-cyan-300 drop-shadow-[0_0_5px_#67e8f9]">
                {Math.ceil(shipCorePower)} / {shipMaxPower}
              </span>
            </div>
            
            <div className="relative h-6 bg-black rounded-full overflow-hidden border border-white/10 shadow-inner">
              <div 
                className="absolute top-0 left-0 h-full bg-cyan-500/80 transition-all duration-1000 shadow-[0_0_20px_#22d3ee]"
                style={{ width: `${percentage}%` }}
              >
                <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImEiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTTAgNDBMNDAgMEg0MHY0MEgwem0wIDBoNDBMMCA0MFYweiIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjEpIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjYSkiLz48L3N2Zz4=')] opacity-30 animate-[slide_2s_linear_infinite]" />
              </div>
            </div>
            
            {percentage < 20 && (
              <div className="mt-4 flex items-center space-x-2 text-red-400 animate-pulse bg-red-900/20 px-3 py-2 rounded-lg border border-red-500/30">
                <AlertTriangle size={16} />
                <span className="text-xs font-bold tracking-widest uppercase">Critical Power Level</span>
              </div>
            )}
          </div>

          {/* Refuel Interface */}
          <div className="bg-black/50 border border-white/5 rounded-xl p-6 flex flex-col items-center">
            <span className="text-sm font-bold tracking-widest text-white/50 uppercase mb-4">Refueling Protocol</span>
            
            <div className="grid grid-cols-2 gap-4 w-full">
              {/* Ship Core Refuel */}
              <div className="flex flex-col items-center p-4 border border-cyan-500/30 rounded-xl bg-cyan-900/10">
                <div className="flex items-center space-x-3 mb-4">
                  <div className="w-12 h-12 rounded-lg border-2 border-dashed border-cyan-500/50 flex flex-col items-center justify-center bg-cyan-900/20">
                    <Battery size={20} className="text-cyan-400 mb-1" />
                    <span className="text-[9px] font-mono text-cyan-200">{sparkCount} AVL</span>
                  </div>
                  <div className="flex flex-col space-y-1">
                    <span className="text-xs text-white/70">Spark Node</span>
                    <span className="text-xs font-mono text-cyan-400">+25% Core</span>
                  </div>
                </div>

                <button
                  onClick={handleConsumeSpark}
                  disabled={sparkCount === 0 || shipCorePower >= shipMaxPower}
                  className={`w-full py-2 text-sm rounded-lg font-bold tracking-widest uppercase transition-all flex justify-center items-center space-x-2 ${
                    sparkCount > 0 && shipCorePower < shipMaxPower
                      ? 'bg-cyan-500 hover:bg-cyan-400 text-black shadow-[0_0_15px_rgba(34,211,238,0.4)]' 
                      : 'bg-white/5 text-white/30 cursor-not-allowed border border-white/10'
                  }`}
                >
                  <Zap size={14} />
                  <span>Charge Ship</span>
                </button>
              </div>

              {/* Player Suit Recharge */}
              <div className="flex flex-col items-center p-4 border border-amber-500/30 rounded-xl bg-amber-900/10">
                <div className="flex items-center space-x-3 mb-4">
                  <div className="w-12 h-12 rounded-lg border border-amber-500/50 flex flex-col items-center justify-center bg-amber-900/20">
                    <Zap size={20} className="text-amber-400" />
                  </div>
                  <div className="flex flex-col space-y-1">
                    <span className="text-xs text-white/70">Recharge Suit</span>
                    <span className="text-xs font-mono text-amber-400">-500 Core</span>
                  </div>
                </div>

                <button
                  onClick={() => {
                    if (shipCorePower >= 500) {
                      useStore.getState().chargeShipPower(-500);
                      useStore.setState({ playerPower: useStore.getState().playerMaxPower });
                    }
                  }}
                  disabled={shipCorePower < 500}
                  className={`w-full py-2 text-sm rounded-lg font-bold tracking-widest uppercase transition-all flex justify-center items-center space-x-2 ${
                    shipCorePower >= 500
                      ? 'bg-amber-500 hover:bg-amber-400 text-black shadow-[0_0_15px_rgba(245,158,11,0.4)]' 
                      : 'bg-white/5 text-white/30 cursor-not-allowed border border-white/10'
                  }`}
                >
                  <Battery size={14} />
                  <span>Recharge</span>
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
