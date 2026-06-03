import React, { useCallback } from 'react';
import { useStore } from '../../stores/useStore';
import { audioManager } from '../../utils/AudioManager';
import { GlobalRegistry } from '../../registry/Registry';

export const InventorySlot = React.memo(({ index, containerId }) => {
  // $O(1)$ Render Constraint: Subscribe ONLY to this specific index
  const item = useStore(useCallback(state => 
    containerId === 'player' ? state.inventory[index] : state.chests[containerId]?.[index]
  , [index, containerId]));

  const heldItem = useStore(state => state.heldItem);
  const setHeldItem = useStore(state => state.setHeldItem);
  const executeLocalTransaction = useStore(state => state.executeLocalTransaction);

  const handleMouseDown = (e) => {
    e.stopPropagation(); // Halt event propagation to prevent Click-Through bug!
    
    // Right click for SPLIT, Left click for MOVE/SWAP
    const isRightClick = e.button === 2;
    
    const sourceLoc = { type: containerId === 'player' ? 'player' : 'container', id: containerId, slot: index };

    if (!heldItem && item) {
       // Pick up item
       if (isRightClick && item.count > 1) {
          const half = Math.floor(item.count / 2);
          setHeldItem({ ...item, count: half, sourceLoc });
          executeLocalTransaction(sourceLoc, null, 'SPLIT'); 
       } else {
          setHeldItem({ ...item, sourceLoc });
          // Optimistically empty the slot visually
          executeLocalTransaction(sourceLoc, null, 'MOVE_START'); 
       }
       audioManager.playSound('click');
    } 
    else if (heldItem) {
       // Place item or swap
       if (isRightClick && (!item || (item.texture === heldItem.texture && item.count < 64))) {
          // Drop 1 item
          const dropAmount = 1;
          executeLocalTransaction(heldItem.sourceLoc, sourceLoc, 'MOVE', dropAmount);
          if (heldItem.count - 1 <= 0) {
              setHeldItem(null);
          } else {
              setHeldItem({ ...heldItem, count: heldItem.count - 1 });
          }
       } else {
          // Drop stack or swap
          executeLocalTransaction(heldItem.sourceLoc, sourceLoc, 'MOVE');
          
          if (item && item.texture !== heldItem.texture) {
              // We swapped! The old item goes to the cursor
              setHeldItem({ ...item, sourceLoc });
          } else if (item && item.texture === heldItem.texture) {
              // We merged stacks! Did we exceed 64?
              const total = item.count + heldItem.count;
              if (total > 64) {
                 setHeldItem({ ...heldItem, count: total - 64 });
              } else {
                 setHeldItem(null);
              }
          } else {
              setHeldItem(null);
          }
       }
       audioManager.playSound('click');
    }
  };

  const handleContextMenu = (e) => e.preventDefault();

  const reg = item ? GlobalRegistry[item.texture] : null;
  let imgSrc = null;
  let fallbackColor = 'transparent';
  
  if (reg) {
      fallbackColor = reg.color || '#ffffff';
      if (reg.texture) {
          imgSrc = `/textures/blocks/${reg.texture}`;
      } else if (reg.textures) {
          imgSrc = `/textures/blocks/${reg.textures.side || reg.textures.top}`;
      } else {
          imgSrc = `/textures/items/${item.texture}.png`;
      }
  }

  return (
    <div 
        className="w-12 h-12 bg-black/40 border-2 border-white/20 hover:border-yellow-400/80 transition-colors relative"
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
    >
      {item && (
        <>
          <div className="absolute inset-1" style={{ backgroundColor: fallbackColor }}>
             {imgSrc && (
                 <img 
                   src={imgSrc} 
                   alt={item.texture} 
                   className="w-full h-full object-contain pixelated pointer-events-none"
                   onError={(e) => { e.target.style.display = 'none'; }}
                 />
             )}
          </div>
          {item.count > 1 && (
            <span className="absolute bottom-0 right-1 text-white text-xs font-bold font-mono pointer-events-none" style={{ textShadow: '1px 1px 0 #000' }}>
              {item.count}
            </span>
          )}
        </>
      )}
    </div>
  );
});
