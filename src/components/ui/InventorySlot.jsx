import { useCallback, memo } from 'react';
import { useStore } from '../../stores/useStore';
import { useInventoryStore } from '../../stores/inventorySlice';
import { gameAudio } from '../../audio/GameAudio';
import { GlobalRegistry } from '../../registry/Registry';

export const InventorySlot = memo(({ index, containerId }) => {
  // $O(1)$ Render Constraint: Subscribe ONLY to this specific index
  const playerOrTableItem = useStore(
    useCallback(
      (state) => {
        if (containerId === 'player') return state.inventory[index];
        if (containerId === 'table') return state.tableGrid[index];
        if (containerId === 'tableResult') return state.tableResult;
        return null;
      },
      [index, containerId]
    )
  );

  const chestItem = useInventoryStore(
    useCallback(
      (state) => {
        if (containerId !== 'player' && containerId !== 'table' && containerId !== 'tableResult') {
          return state.chests[containerId]?.[index];
        }
        return null;
      },
      [index, containerId]
    )
  );

  const item = (containerId === 'player' || containerId === 'table' || containerId === 'tableResult') ? playerOrTableItem : chestItem;


  const heldItem = useStore((state) => state.heldItem);
  const setHeldItem = useStore((state) => state.setHeldItem);
  const executeLocalTransaction = useStore(
    (state) => state.executeLocalTransaction
  );

  // Create a dynamic visual mask. If this slot is the source of the held item, subtract its count visually.
  // This perfectly masks out "ghost items" before the server responds!
  let displayItem = item;
  if (
    item &&
    heldItem &&
    heldItem.sourceLoc.id === containerId &&
    heldItem.sourceLoc.slot === index
  ) {
    if (item.texture === heldItem.texture) {
      if (item.count === heldItem.count) {
        displayItem = null;
      } else {
        displayItem = {
          ...item,
          count: Math.max(0, item.count - heldItem.count),
        };
      }
    }
  }

  const handleMouseDown = (e) => {
    e.stopPropagation(); // Halt event propagation to prevent Click-Through bug!

    // Right click for SPLIT, Left click for MOVE/SWAP
    const isRightClick = e.button === 2;
    const isShiftClick = e.shiftKey;

    const sourceLoc = {
      type: containerId === 'player' ? 'player' : (containerId === 'table' || containerId === 'tableResult') ? containerId : 'container',
      id: containerId,
      slot: index,
    };

    if (containerId === 'tableResult') {
      if (!displayItem) return;
      if (heldItem) {
         if (isRightClick) return;
         if (heldItem.texture !== displayItem.texture) return;
         if (heldItem.count + displayItem.count > 64) return;
         executeLocalTransaction(sourceLoc, null, 'CRAFT_EXTRACT', 1);
         setHeldItem({ ...heldItem, count: heldItem.count + displayItem.count });
         gameAudio.playGlobal('click');
         return;
      }
      if (isRightClick) return; // Cannot split from result
      if (isShiftClick) {
         executeLocalTransaction(sourceLoc, null, 'CRAFT_EXTRACT', 'QUICK');
         gameAudio.playGlobal('click');
         return;
      }
      // Standard click (pick up 1 craft yield)
      setHeldItem({ ...displayItem, sourceLoc });
      executeLocalTransaction(sourceLoc, null, 'CRAFT_EXTRACT', 1);
      gameAudio.playGlobal('click');
      return;
    }

    if (!heldItem && displayItem) {
      // Pick up item (use displayItem!)
      if (isRightClick && displayItem.count > 1) {
        const half = Math.floor(displayItem.count / 2);
        setHeldItem({ ...displayItem, count: half, sourceLoc });
        executeLocalTransaction(sourceLoc, null, 'SPLIT');
      } else {
        setHeldItem({ ...displayItem, sourceLoc });
        // Optimistically empty the slot visually
        executeLocalTransaction(sourceLoc, null, 'MOVE_START');
      }
      gameAudio.playGlobal('click');
    } else if (heldItem) {
      // Place item or swap
      if (
        isRightClick &&
        (!displayItem ||
          (displayItem.texture === heldItem.texture && displayItem.count < 64))
      ) {
        // Drop 1 item
        const dropAmount = 1;
        executeLocalTransaction(
          heldItem.sourceLoc,
          sourceLoc,
          'MOVE',
          dropAmount
        );
        if (heldItem.count - 1 <= 0) {
          setHeldItem(null);
        } else {
          setHeldItem({ ...heldItem, count: heldItem.count - 1 });
        }
      } else {
        // Drop stack or swap
        executeLocalTransaction(heldItem.sourceLoc, sourceLoc, 'MOVE');

        if (displayItem && displayItem.texture !== heldItem.texture) {
          // We swapped! The old item goes to the cursor
          // FIX: Maintain the heldItem's original sourceLoc so the server knows where to move it!
          setHeldItem({ ...displayItem, sourceLoc: heldItem.sourceLoc });
        } else if (displayItem && displayItem.texture === heldItem.texture) {
          // We merged stacks! Did we exceed 64?
          const total = displayItem.count + heldItem.count;
          if (total > 64) {
            setHeldItem({ ...heldItem, count: total - 64 });
          } else {
            setHeldItem(null);
          }
        } else {
          setHeldItem(null);
        }
      }
      gameAudio.playGlobal('click');
    }
  };

  const handleContextMenu = (e) => e.preventDefault();

  const reg = displayItem ? GlobalRegistry[displayItem.texture] : null;
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

  const tooltipName = reg ? (reg.name || displayItem.texture) : (displayItem ? displayItem.texture : '');

  return (
    <div
      className="w-12 h-12 bg-black/40 border-2 border-white/20 hover:border-yellow-400/80 transition-colors relative group"
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
      data-tooltip={displayItem ? tooltipName : null}
    >
      {displayItem && (
        <>
          <div
            className="absolute inset-1"
            style={{ backgroundColor: fallbackColor }}
          >
            {imgSrc && (
              <img
                src={imgSrc}
                alt={displayItem.texture}
                className="w-full h-full object-contain pixelated pointer-events-none"
                style={{ opacity: 0 }}
                onLoad={(e) => {
                  e.target.style.opacity = 1;
                }}
                onError={(e) => {
                  e.target.style.display = 'none';
                }}
              />
            )}
          </div>
          {displayItem.count > 1 && (
            <span
              className="absolute bottom-0 right-1 text-white text-xs font-bold font-mono pointer-events-none"
              style={{ textShadow: '1px 1px 0 #000' }}
            >
              {displayItem.count}
            </span>
          )}
        </>
      )}
    </div>
  );
});
