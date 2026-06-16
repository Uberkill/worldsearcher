import React from 'react';
import { InventorySlot } from './InventorySlot';
import { BaseOverlay } from './BaseOverlay';

export const ContainerGUI = ({ active, onClose, title, children }) => {
  return (
    <BaseOverlay active={active} onClose={onClose} title={title}>
      <div 
        className="flex flex-col gap-6"
        onMouseDown={(e) => e.stopPropagation()} // Swallow background clicks to prevent click-through
      >
        {/* Custom Machine / Block UI (Crafting grid, Furnace slots, etc.) */}
        <div className="bg-black/30 p-4 rounded border-2 border-neutral-800 flex flex-row gap-8 items-center justify-center">
          {children}
        </div>

        {/* Main Inventory Grid (Slots 9-35) */}
        <div className="bg-black/30 p-4 rounded border-2 border-neutral-800">
          <h3 className="text-xs text-neutral-500 font-bold mb-2 uppercase tracking-wider">
            Inventory
          </h3>
          <div className="grid grid-cols-9 gap-1">
            {Array.from({ length: 27 }).map((_, i) => (
              <InventorySlot key={`inv_main_${i + 9}`} index={i + 9} containerId="player" />
            ))}
          </div>
        </div>

        {/* Hotbar Grid (Slots 0-8) */}
        <div className="bg-black/30 p-4 rounded border-2 border-neutral-800">
          <h3 className="text-xs text-neutral-500 font-bold mb-2 uppercase tracking-wider">
            Hotbar
          </h3>
          <div className="grid grid-cols-9 gap-1">
            {Array.from({ length: 9 }).map((_, i) => (
              <InventorySlot key={`inv_hotbar_${i}`} index={i} containerId="player" />
            ))}
          </div>
        </div>
        
      </div>
    </BaseOverlay>
  );
};
