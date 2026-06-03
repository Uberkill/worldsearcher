import React, { useEffect } from 'react';
import { useStore } from '../../stores/useStore';
import { InventorySlot } from './InventorySlot';
import { CursorItem } from './CursorItem';
import { X } from 'lucide-react';
import { getNetworkStore } from '../../stores/storeLinker';

export const ChestOverlay = ({ chestId, onClose }) => {
  // We do not subscribe to state.chests here! The InventorySlot component handles atomic updates!
  // However, we need to ensure the chest exists in the state.
  const chestExists = useStore((state) => !!state.chests[chestId]);

  useEffect(() => {
     if (!chestExists) {
         onClose(); // If the chest is destroyed by another player while we look at it, close the UI
     }
  }, [chestExists, onClose]);

  if (!chestExists) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/60 z-50 flex flex-col items-center justify-center backdrop-blur-sm pointer-events-auto select-none"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <CursorItem />

      <div className="bg-neutral-900 border-4 border-neutral-700 p-6 rounded-lg shadow-2xl relative max-w-2xl w-full">
        
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-neutral-400 hover:text-white transition-colors"
        >
          <X size={24} />
        </button>

        <h2 className="text-2xl font-bold text-white mb-6 font-mono" style={{ textShadow: '2px 2px 0 #000' }}>
          Storage Crate
        </h2>

        {/* Inventory Layout */}
        <div className="flex flex-col gap-6">
          
          {/* Chest Grid (27 Slots) */}
          <div className="bg-black/30 p-4 rounded border-2 border-neutral-800">
             <h3 className="text-xs text-neutral-500 font-bold mb-2 uppercase tracking-wider">Chest</h3>
             <div className="grid grid-cols-9 gap-1">
                {Array.from({ length: 27 }).map((_, i) => (
                   <InventorySlot key={`inv_chest_${i}`} index={i} containerId={chestId} />
                ))}
             </div>
          </div>
          
          <hr className="border-neutral-700" />

          {/* Main Inventory Grid (Slots 9-35) */}
          <div className="bg-black/30 p-4 rounded border-2 border-neutral-800">
             <h3 className="text-xs text-neutral-500 font-bold mb-2 uppercase tracking-wider">Inventory</h3>
             <div className="grid grid-cols-9 gap-1">
                {Array.from({ length: 27 }).map((_, i) => (
                   <InventorySlot key={`inv_main_${i + 9}`} index={i + 9} containerId="player" />
                ))}
             </div>
          </div>

          {/* Hotbar Grid (Slots 0-8) */}
          <div className="bg-black/30 p-4 rounded border-2 border-neutral-800">
             <h3 className="text-xs text-neutral-500 font-bold mb-2 uppercase tracking-wider">Hotbar</h3>
             <div className="grid grid-cols-9 gap-1">
                {Array.from({ length: 9 }).map((_, i) => (
                   <InventorySlot key={`inv_hotbar_${i}`} index={i} containerId="player" />
                ))}
             </div>
          </div>

        </div>
      </div>
    </div>
  );
};
