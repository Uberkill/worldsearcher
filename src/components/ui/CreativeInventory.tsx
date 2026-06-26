// @ts-nocheck
import { useState } from 'react';
import { useStore } from '../../stores/useStore';
import { GlobalRegistry } from '../../registry/Registry';
import { InventorySlot } from './InventorySlot';
import { BaseOverlay } from './BaseOverlay';
import { X, Search } from 'lucide-react';

export const CreativeInventory = ({ active, onClose }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('All'); // 'All', 'Blocks', 'Tools'
  
  const allItems = Object.keys(GlobalRegistry || {}).filter(k => {
     const reg = GlobalRegistry[k];
     const name = reg?.name?.toLowerCase() || '';
     const search = searchTerm.toLowerCase();
     
     // 1. Search Filter
     const matchesSearch = k.toLowerCase().includes(search) || name.includes(search);
     if (!matchesSearch) return false;
     
     // 2. Tab Filter
     if (activeTab === 'Tools') {
        return reg?.type === 'tool';
     } else if (activeTab === 'Blocks') {
        return reg?.type !== 'tool';
     }
     return true; // 'All'
  });

  return (
    <BaseOverlay active={active} onClose={onClose} containerClassName="flex flex-row items-center justify-center gap-8">

      {/* Creative Menu (Left) */}
      <div className="bg-neutral-900 border-4 border-neutral-700 p-6 rounded-lg shadow-2xl relative w-full max-w-2xl h-[85dvh] flex flex-col">
        <h2 className="text-2xl font-bold text-white mb-4 font-mono" style={{ textShadow: '2px 2px 0 #000' }}>Creative Database</h2>
        
        <div className="flex items-center bg-black/40 border border-white/20 rounded-lg p-3 mb-4 shadow-[0_0_15px_rgba(255,255,255,0.05)]">
          <Search size={20} className="text-white mr-3" />
          <input
            type="text"
            placeholder="Search all items and blocks..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
            className="bg-transparent text-white outline-none w-full font-sans tracking-wide"
          />
        </div>

        {/* Category Tabs */}
        <div className="flex gap-2 mb-4">
          {['All', 'Blocks', 'Tools'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 font-bold font-mono text-sm rounded transition-colors ${
                activeTab === tab 
                  ? 'bg-white text-black border border-white shadow-md' 
                  : 'bg-neutral-800 text-neutral-400 border border-neutral-700 hover:bg-neutral-700 hover:text-white'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto pr-2" style={{ scrollbarWidth: 'thin', scrollbarColor: '#ffffff40 transparent' }}>
          <div className="grid grid-cols-10 gap-2">
            {allItems.map(texture => {
              const reg = GlobalRegistry[texture];
              const tooltipName = reg ? (reg.name || texture) : texture;
              const fallbackColor = reg?.color || '#333333';
              
              let imgSrc = `${import.meta.env.BASE_URL}textures/items/${texture}.png`;
              if (reg?.texture) {
                imgSrc = `${import.meta.env.BASE_URL}textures/blocks/${reg.texture}`;
              } else if (reg?.textures) {
                imgSrc = `${import.meta.env.BASE_URL}textures/blocks/${reg.textures.side || reg.textures.top}`;
              }
              
              return (
              <div 
                key={texture}
                className="w-12 h-12 border-2 border-neutral-800 rounded hover:border-white/30 transition-colors cursor-pointer relative shadow-lg group flex flex-col items-center justify-center"
                data-tooltip={tooltipName}
                style={{ backgroundColor: fallbackColor }}
                onMouseDown={(e) => {
                   e.stopPropagation();
                   const state = useStore.getState();
                   if (!state.heldItem) {
                      const maxStack = reg.type === 'tool' ? 1 : (reg.maxStack || 64);
                      state.setHeldItem({ texture, count: maxStack, sourceLoc: { type: 'creative', texture } });
                   } else {
                      // Delete item if clicking creative grid while holding it
                      if (state.heldItem.sourceLoc.type !== 'creative') {
                        state.executeLocalTransaction(state.heldItem.sourceLoc, null, 'CONSUME', state.heldItem.count);
                      }
                      state.setHeldItem(null);
                   }
                }}
              >
                <img 
                  src={imgSrc} 
                  onError={(e) => { 
                    e.target.style.display = 'none'; // fallback to solid background
                  }}
                  onLoad={(e) => {
                    // Only show image if it actually loads successfully, otherwise rely on fallback background
                    e.target.style.opacity = 1;
                    e.target.style.display = '';
                  }}
                  style={{ opacity: 0 }}
                  className="w-8 h-8 object-contain pixelated group-hover:scale-110 transition-transform"
                  alt={texture}
                />
              </div>
            )})}
          </div>
        </div>
      </div>

      {/* Player Inventory (Right) */}
      <div className="bg-neutral-900 border-4 border-neutral-700 p-6 rounded-lg shadow-2xl relative w-full max-w-xl flex flex-col">
        <button onClick={onClose} className="absolute top-4 right-4 text-neutral-400 hover:text-white transition-colors">
          <X size={24} />
        </button>

        <h2 className="text-2xl font-bold text-white mb-6 font-mono" style={{ textShadow: '2px 2px 0 #000' }}>Your Loadout</h2>
        
        <div className="flex flex-col gap-6">
          <div className="bg-black/30 p-4 rounded border-2 border-neutral-800">
            <h3 className="text-xs text-neutral-500 font-bold mb-2 uppercase tracking-wider">Storage</h3>
            <div className="grid grid-cols-9 gap-1">
              {Array.from({ length: 27 }).map((_, i) => (
                <InventorySlot key={`inv_main_${i + 9}`} index={i + 9} containerId="player" />
              ))}
            </div>
          </div>
          <div className="bg-black/30 p-4 rounded border-2 border-neutral-800 mt-auto">
            <h3 className="text-xs text-neutral-500 font-bold mb-2 uppercase tracking-wider">Hotbar</h3>
            <div className="grid grid-cols-9 gap-1">
              {Array.from({ length: 9 }).map((_, i) => (
                <InventorySlot key={`inv_hotbar_${i}`} index={i} containerId="player" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </BaseOverlay>
  );
};

