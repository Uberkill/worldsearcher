import { InventorySlot } from './InventorySlot';
import { ContainerGUI } from './ContainerGUI';

export const CraftingOverlay = ({ active, onClose }) => {
  return (
    <ContainerGUI active={active} onClose={onClose} title="Crafting">
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
    </ContainerGUI>
  );
};
