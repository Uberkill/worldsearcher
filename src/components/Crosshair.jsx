import { useStore } from '../stores/useStore';
import { BlockById, BlockKeyById } from '../registry/BlockRegistry';
import { getIndex, getTextureId, CHUNK_Y_MIN, CHUNK_Y_MAX } from '../utils/chunkData';

export const Crosshair = () => {
  const hoverTarget = useStore(state => state.hoverTarget);
  const isMenuOpen = useStore(state => state.isMenuOpen);
  const isInventoryOpen = useStore(state => state.isInventoryOpen);
  const isSettingsOpen = useStore(state => state.isSettingsOpen);
  const isDead = useStore(state => state.isDead);
  
  // Hide crosshair entirely if menus are open or player is dead
  if (isMenuOpen || isInventoryOpen || isSettingsOpen || isDead) return null;

  let isLookingAtFabricator = false;
  if (hoverTarget) {
    const cx = Math.floor(hoverTarget[0] / 16);
    const cz = Math.floor(hoverTarget[2] / 16);
    const chunk = useStore.getState().chunks[`${cx},${cz}`];
    if (chunk && chunk.buffer) {
       const lx = (hoverTarget[0] % 16 + 16) % 16;
       const lz = (hoverTarget[2] % 16 + 16) % 16;
       const ly = Math.round(hoverTarget[1] - 0.5);
       if (ly >= CHUNK_Y_MIN && ly <= CHUNK_Y_MAX) {
          const val = chunk.buffer[getIndex(lx, ly, lz)];
          const tex = getTextureId(val);
          if (tex !== 0 && BlockKeyById[tex] === 'crafting_table') {
             isLookingAtFabricator = true;
          }
       }
    }
  }

  return (
    <div className="fixed inset-0 pointer-events-none z-40 select-none">
      
      {/* Dynamic Reticle - Absolute Center */}
      <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center transition-all duration-200 ${isLookingAtFabricator ? 'scale-125' : 'scale-100'}`}>
        {/* Outer Ring */}
        <div className={`absolute rounded-full border border-white/40 transition-all duration-300 ${isLookingAtFabricator ? 'w-8 h-8 border-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.5)] rotate-45' : 'w-4 h-4'}`} />
        
        {/* Center Dot */}
        <div className={`w-1 h-1 rounded-full bg-white transition-colors duration-300 ${isLookingAtFabricator ? 'bg-cyan-300 shadow-[0_0_5px_#22d3ee]' : ''}`} />
      </div>

      {/* Tooltip */}
      <div className={`absolute top-[54%] left-1/2 -translate-x-1/2 transition-all duration-300 flex flex-col items-center ${isLookingAtFabricator ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
        <span className="px-3 py-1 bg-black/60 backdrop-blur-md border border-cyan-400/30 text-cyan-200 text-[10px] font-mono tracking-widest uppercase rounded-full shadow-[0_0_15px_rgba(34,211,238,0.1)]">
          [E] Fabricator
        </span>
      </div>
      
    </div>
  );
};
