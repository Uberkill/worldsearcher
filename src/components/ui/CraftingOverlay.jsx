import { InventorySlot } from './InventorySlot';
import { BaseOverlay } from './BaseOverlay';

export const CraftingOverlay = ({ active, onClose }) => {
  return (
    <BaseOverlay active={active} onClose={onClose} title="Crafting">
      <div className="flex flex-col gap-6">
        {/* Crafting Grid */}
        <div className="bg-black/30 p-4 rounded border-2 border-neutral-800 flex flex-row gap-8 items-center justify-center">
          <div>
            <h3 className="text-xs text-neutral-500 font-bold mb-2 uppercase tracking-wider text-center">
              Crafting
            </h3>
            <div className="grid grid-cols-3 gap-1">
              {Array.from({ length: 9 }).map((_, i) => (
                <InventorySlot key={`craft_${i}`} index={i} containerId="table" />
              ))}
            </div>
          </div>
          
          <div className="text-4xl text-neutral-600 font-bold mt-6">→</div>

          <div>
             <h3 className="text-xs text-neutral-500 font-bold mb-2 uppercase tracking-wider opacity-0 text-center">
              Result
            </h3>
            <div className="scale-125 transform origin-center">
              <InventorySlot key="craft_result" index={0} containerId="tableResult" />
            </div>
          </div>
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
