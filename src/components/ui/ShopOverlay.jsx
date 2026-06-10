import { X, Heart, Sword, ArrowUpCircle } from 'lucide-react';
import { useStore } from '../../stores/useStore';

export const ShopOverlay = ({ active, onClose }) => {
  const buyUpgrade = useStore((state) => state.buyUpgrade);
  const coins = useStore((state) => state.coins);
  const playerMaxHealth = useStore((state) => state.playerMaxHealth);
  const playerDamageMult = useStore((state) => state.playerDamageMult);
  const playerJumpMult = useStore((state) => state.playerJumpMult);

  const handleBuy = (type, cost, amount) => {
    if (coins >= cost) {
      buyUpgrade(type, cost, amount);
    }
  };

  const upgrades = [
    {
      id: 'health',
      icon: <Heart size={32} className="text-red-400 mb-4" />,
      title: 'VITALITY BOOST',
      desc: 'Permanently increases maximum health by 50 points.',
      cost: 10,
      amount: 50,
      current: playerMaxHealth,
      color: 'red',
    },
    {
      id: 'damage',
      icon: <Sword size={32} className="text-orange-400 mb-4" />,
      title: 'KINETIC AMPLIFIER',
      desc: 'Permanently increases pickaxe damage by +0.5x multiplier.',
      cost: 15,
      amount: 0.5,
      current: `${playerDamageMult.toFixed(1)}x`,
      color: 'orange',
    },
    {
      id: 'jump',
      icon: <ArrowUpCircle size={32} className="text-green-400 mb-4" />,
      title: 'PNEUMATIC LEGS',
      desc: 'Permanently increases jump velocity by +0.2x multiplier.',
      cost: 15,
      amount: 0.2,
      current: `${playerJumpMult.toFixed(1)}x`,
      color: 'green',
    },
  ];

  return (
    <div
      className={`absolute inset-0 flex items-center justify-center transition-all duration-[500ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${active ? 'opacity-100 pointer-events-auto scale-100' : 'opacity-0 pointer-events-none scale-105'}`}
    >
      <div className="bg-[#0b0c10]/80 backdrop-blur-3xl border border-white/10 rounded-2xl w-[800px] shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-white/5 bg-white/5">
          <div>
            <h3 className="text-xl font-light tracking-[0.3em] text-cyan-400">
              BIOMETRIC <span className="font-bold text-white">UPGRADES</span>
            </h3>
            <p className="text-xs text-white/50 tracking-widest mt-1">
              Enhance your survival capabilities
            </p>
          </div>
          <div className="flex items-center space-x-6">
            <div className="flex flex-col items-end">
              <span className="text-[10px] text-yellow-500/80 tracking-widest font-bold">
                AVAILABLE CREDITS
              </span>
              <div className="flex items-center gap-3">
                <span className="text-xl font-mono text-yellow-400">
                  {coins} âš™
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-white/40 hover:text-cyan-400 hover:bg-white/5 rounded-full transition-colors cursor-pointer"
            >
              <X size={24} />
            </button>
          </div>
        </div>

        <div className="p-8 grid grid-cols-3 gap-6">
          {upgrades.map((upg) => {
            const canAfford = coins >= upg.cost;
            return (
              <div
                key={upg.id}
                className="bg-black/40 border border-white/10 rounded-xl p-6 flex flex-col items-center text-center relative group hover:border-white/30 transition-all"
              >
                <div
                  className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl pointer-events-none ${
                    upg.color === 'red'
                      ? 'bg-red-500/5'
                      : upg.color === 'orange'
                        ? 'bg-orange-500/5'
                        : 'bg-green-500/5'
                  }`}
                />
                {upg.icon}
                <h4 className="text-sm font-bold tracking-widest text-white mb-2">
                  {upg.title}
                </h4>
                <p className="text-[10px] text-white/50 mb-6 h-12">
                  {upg.desc}
                </p>

                <div className="w-full bg-white/5 rounded-lg p-3 mb-6">
                  <div className="text-[10px] text-white/40 tracking-widest mb-1">
                    CURRENT STAT
                  </div>
                  <div
                    className={`text-lg font-mono ${
                      upg.color === 'red'
                        ? 'text-red-400'
                        : upg.color === 'orange'
                          ? 'text-orange-400'
                          : 'text-green-400'
                    }`}
                  >
                    {upg.current}
                  </div>
                </div>

                <button
                  onClick={() => handleBuy(upg.id, upg.cost, upg.amount)}
                  disabled={!canAfford}
                  className={`w-full py-3 rounded-lg text-xs font-bold tracking-[0.2em] transition-all cursor-pointer ${
                    canAfford
                      ? upg.color === 'red'
                        ? 'bg-red-900/30 border border-red-400/50 hover:bg-red-900/60 text-red-100 shadow-[0_0_15px_rgba(0,0,0,0.2)]'
                        : upg.color === 'orange'
                          ? 'bg-orange-900/30 border border-orange-400/50 hover:bg-orange-900/60 text-orange-100 shadow-[0_0_15px_rgba(0,0,0,0.2)]'
                          : 'bg-green-900/30 border border-green-400/50 hover:bg-green-900/60 text-green-100 shadow-[0_0_15px_rgba(0,0,0,0.2)]'
                      : 'bg-white/5 border border-white/10 text-white/30 cursor-not-allowed'
                  }`}
                >
                  {canAfford ? `UPGRADE (${upg.cost} âš™)` : `NEED ${upg.cost} âš™`}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
