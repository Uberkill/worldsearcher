import React from 'react';
import { useStore } from '../../stores/useStore';
import { useInventoryStore } from '../../stores/inventorySlice';
import { InventorySlot } from './InventorySlot';

const FurnaceOverlay = () => {
  const activeFurnaceId = useStore((state) => state.activeFurnaceId);
  const closeFurnace = useStore((state) => state.closeFurnace);
  const machineData = useInventoryStore((state) => state.machines[activeFurnaceId] || {});

  if (!activeFurnaceId) return null;

  const progressPct = machineData.currentCookMax > 0 
    ? (machineData.cookProgress / machineData.currentCookMax) * 100 
    : 0;

  const burnPct = machineData.currentFuelMax > 0
    ? (machineData.burnTimeLeft / machineData.currentFuelMax) * 100
    : 0;

  return (
    <div 
      className="absolute inset-0 bg-black/60 flex items-center justify-center z-50"
      onMouseDown={() => closeFurnace()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div 
        className="bg-gray-800 border-4 border-gray-600 p-4 shadow-2xl flex flex-col gap-4"
        style={{ width: '400px', pointerEvents: 'auto' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="text-white font-bold text-center border-b-2 border-gray-600 pb-2">
          Ship Furnace
        </div>
        
        <div className="flex items-center justify-between px-8">
          <div className="flex flex-col gap-2">
            <div className="text-xs text-gray-400 text-center">Input</div>
            <InventorySlot index={0} containerId={activeFurnaceId} />
            <div className="text-xs text-gray-400 text-center mt-2">Fuel</div>
            <InventorySlot index={1} containerId={activeFurnaceId} />
          </div>

          <div className="flex flex-col items-center gap-2">
            {/* Fire Icon for fuel */}
            <div className="w-8 h-8 bg-gray-900 border border-gray-700 relative overflow-hidden">
               <div 
                  className="absolute bottom-0 w-full bg-orange-500 transition-all duration-1000"
                  style={{ height: `${burnPct}%` }}
               />
            </div>
            {/* Arrow for progress */}
            <div className="w-16 h-4 bg-gray-900 border border-gray-700 relative overflow-hidden">
               <div 
                  className="absolute left-0 h-full bg-green-500 transition-all duration-1000"
                  style={{ width: `${progressPct}%` }}
               />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-xs text-gray-400 text-center">Output</div>
            <InventorySlot index={2} containerId={activeFurnaceId} />
          </div>
        </div>

        {/* Player Inventory */}
        <div className="mt-4 border-t-2 border-gray-600 pt-4">
           <div className="grid grid-cols-9 gap-1">
             {Array.from({ length: 36 }).map((_, i) => (
               <InventorySlot key={i} index={i} containerId="player" />
             ))}
           </div>
        </div>
      </div>
    </div>
  );
};

export default FurnaceOverlay;
