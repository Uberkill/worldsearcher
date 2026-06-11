import { useEffect } from 'react';
import { useInventoryStore } from '../../stores/inventorySlice';
import { InventorySlot } from './InventorySlot';
import { BaseOverlay } from './BaseOverlay';

export const ChestOverlay = ({ chestId, onClose }) => {
  const chestExists = useInventoryStore((state) => !!state.chests[chestId]);

  useEffect(() => {
    if (!chestExists) {
      onClose(); 
    }
  }, [chestExists, onClose]);

  return (
    <BaseOverlay active={chestExists} onClose={onClose} title="Storage Crate">
      <div className="flex flex-col gap-6">
        {/* Chest Grid (27 Slots) */}
        <div className="bg-black/30 p-4 rounded border-2 border-neutral-800">
          <h3 className="text-xs text-neutral-500 font-bold mb-2 uppercase tracking-wider">
            Chest
          </h3>
          <div className="grid grid-cols-9 gap-1">
            {Array.from({ length: 27 }).map((_, i) => (
              <InventorySlot
                key={`inv_chest_${i}`}
                index={i}
                containerId={chestId}
              />
            ))}
          </div>
        </div>

        <hr className="border-neutral-700" />

        {/* Main Inventory Grid (Slots 9-35) */}
        <div className="bg-black/30 p-4 rounded border-2 border-neutral-800">
          <h3 className="text-xs text-neutral-500 font-bold mb-2 uppercase tracking-wider">
            Inventory
          </h3>
          <div className="grid grid-cols-9 gap-1">
            {Array.from({ length: 27 }).map((_, i) => (
              <InventorySlot
                key={`inv_main_${i + 9}`}
                index={i + 9}
                containerId="player"
              />
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
              <InventorySlot
                key={`inv_hotbar_${i}`}
                index={i}
                containerId="player"
              />
            ))}
          </div>
        </div>
      </div>
    </BaseOverlay>
  );
};
