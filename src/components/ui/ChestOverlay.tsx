// @ts-nocheck
import { useEffect } from 'react';
import { useInventoryStore } from '../../stores/inventorySlice';
import { InventorySlot } from './InventorySlot';
import { ContainerGUI } from './ContainerGUI';

export const ChestOverlay = ({ chestId, onClose }) => {
  const chestExists = useInventoryStore((state) => !!state.chests[chestId]);

  useEffect(() => {
    if (!chestExists) {
      onClose(); 
    }
  }, [chestExists, onClose]);

  return (
    <ContainerGUI active={chestExists} onClose={onClose} title="Storage Crate">
      <div className="w-full flex flex-col items-center">
        <h3 className="text-xs text-neutral-500 font-bold mb-2 uppercase tracking-wider self-start">
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
    </ContainerGUI>
  );
};

