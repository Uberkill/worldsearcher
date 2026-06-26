// @ts-nocheck
import { InventorySlot } from './InventorySlot';
import { BaseOverlay } from './BaseOverlay';

export const InventoryOverlay = ({ active, onClose }) => {
  return (
    <BaseOverlay active={active} onClose={onClose} title="Inventory">
      <div className="flex flex-col gap-6">
        {/* Main Inventory Grid (Slots 9-35) */}
        <div className="bg-black/30 p-4 rounded border-2 border-neutral-800">
          <h3 className="text-xs text-neutral-500 font-bold mb-2 uppercase tracking-wider">
            Storage
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

