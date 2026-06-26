// @ts-nocheck
import { useSettingsStore } from '../stores/useSettingsStore';

import { useStore } from '../stores/useStore';
import { useUIStore } from '../stores/useUIStore';
import { BlockKeyById } from '../registry/BlockRegistry';

const INTERACTABLE_BLOCKS = {
  'crafting_table': '[Right Click] Fabricator',
  'chest': '[Right Click] Storage Crate',
  'spark_node': '[Right Click] Heart Core',
  'lunar_anchor': '[Right Click] Lunar Anchor',
  'astrolabe': '[Right Click] Astrolabe',
  'charging_station': '[Right Click] Charging Station',
  'ship_seat': '[Right Click] Helm Seat',
  'ship_helm': "[Right Click] Captain's Helm",
  'ship_core': '[Right Click] Shipyard Console',
  'warp_drive_engine': '[Right Click] Warp Drive Engine',
  'warp_capacitor': 'Warp Capacitor [Passive]',
};

export const Crosshair = () => {
  const hoverBlockInfo = useStore((state) => state.hoverBlockInfo);
  const isMenuOpen = useUIStore((state) => state.activeModal === 'MENU');
  const isInventoryOpen = useUIStore((state) => state.activeModal === 'INVENTORY');
  const isSettingsOpen = useSettingsStore((state) => state.isSettingsOpen);
  const isDead = useStore((state) => state.isDead);
  const isSeated = useStore((state) => state.isSeated);

  // Hide crosshair entirely if menus are open or player is dead
  if (isMenuOpen || isInventoryOpen || isSettingsOpen || isDead) return null;

  if (isSeated) {
    return (
      <div className="fixed inset-0 pointer-events-none z-40 flex items-end justify-center pb-20 select-none">
        <div className="bg-black/60 backdrop-blur-md px-6 py-3 rounded-xl border border-cyan-400/30 flex gap-6 text-cyan-200 text-xs font-mono tracking-widest uppercase shadow-[0_0_20px_rgba(34,211,238,0.1)]">
          <span>[W/S] Forward/Back</span>
          <span className="text-cyan-500/50">|</span>
          <span>[A/D] Steer</span>
          <span className="text-cyan-500/50">|</span>
          <span>[Space] Ascend</span>
          <span className="text-cyan-500/50">|</span>
          <span>[Shift] Descend</span>
          <span className="text-cyan-500/50">|</span>
          <span>[F] Dismount</span>
        </div>
      </div>
    );
  }

  let interactText = null;
  if (hoverBlockInfo && hoverBlockInfo.texture) {
    interactText = INTERACTABLE_BLOCKS[hoverBlockInfo.texture];
  }
  const isLookingAtInteractable = !!interactText;

  return (
    <div className="fixed inset-0 pointer-events-none z-40 select-none">
      {/* Dynamic Reticle - Absolute Center */}
      <div
        className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center transition-all duration-200 ${isLookingAtInteractable ? 'scale-125' : 'scale-100'}`}
      >
        {/* Outer Ring */}
        <div
          className={`absolute rounded-full border border-white/40 transition-all duration-300 ${isLookingAtInteractable ? 'w-8 h-8 border-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.5)] rotate-45' : 'w-4 h-4'}`}
        />

        {/* Center Dot */}
        <div
          className={`w-1 h-1 rounded-full bg-white transition-colors duration-300 ${isLookingAtInteractable ? 'bg-cyan-300 shadow-[0_0_5px_#22d3ee]' : ''}`}
        />
      </div>

      {/* Tooltip */}
      <div
        className={`absolute top-[54%] left-1/2 -translate-x-1/2 transition-all duration-300 flex flex-col items-center ${isLookingAtInteractable ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
      >
        <span className="px-3 py-1 bg-black/60 backdrop-blur-md border border-cyan-400/30 text-cyan-200 text-[10px] font-mono tracking-widest uppercase rounded-full shadow-[0_0_15px_rgba(34,211,238,0.1)]">
          {interactText}
        </span>
      </div>
    </div>
  );
};

