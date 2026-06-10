import { useEffect, useMemo, useRef } from 'react';
import { useStore } from '../stores/useStore';
import { useKeyboard } from '../hooks/useKeyboard';
import { GlobalRegistry } from '../registry/Registry';

export const Hotbar = () => {
  const inventory = useStore((state) => state.inventory);
  const activeHotbarIndex = useStore((state) => state.activeHotbarIndex);
  const setActiveHotbarIndex = useStore((state) => state.setActiveHotbarIndex);
  const coins = useStore((state) => state.coins);
  const keys = useKeyboard();
  const isInventoryOpen = useStore((state) => state.isInventoryOpen);
  const isMenuOpen = useStore((state) => state.isMenuOpen);
  const isSettingsOpen = useStore((state) => state.isSettingsOpen);
  const isDead = useStore((state) => state.isDead);

  const hotbarItems = useMemo(() => {
    const items = inventory.slice(0, 9);
    while (items.length < 9) items.push(null);
    return items;
  }, [inventory]);

  // We will conditionally return null after all hooks

  useEffect(() => {
    if (useStore.getState().isInventoryOpen) return;

    // Keyboard 1-9
    if (keys.slot1) setActiveHotbarIndex(0);
    if (keys.slot2) setActiveHotbarIndex(1);
    if (keys.slot3) setActiveHotbarIndex(2);
    if (keys.slot4) setActiveHotbarIndex(3);
    if (keys.slot5) setActiveHotbarIndex(4);
    if (keys.slot6) setActiveHotbarIndex(5);
    if (keys.slot7) setActiveHotbarIndex(6);
    if (keys.slot8) setActiveHotbarIndex(7);
    if (keys.slot9) setActiveHotbarIndex(8);
  }, [keys, setActiveHotbarIndex]);

  const activeIdxRef = useRef(activeHotbarIndex);
  useEffect(() => {
    activeIdxRef.current = activeHotbarIndex;
  }, [activeHotbarIndex]);

  // Handle mouse wheel scrolling — registers once, reads latest index via ref
  // Handle mouse wheel scrolling and Q to drop
  useEffect(() => {
    const handleWheel = (e) => {
      if (document.pointerLockElement) {
        const cur = activeIdxRef.current;
        if (e.deltaY > 0) {
          setActiveHotbarIndex((cur + 1) % 9);
        } else if (e.deltaY < 0) {
          setActiveHotbarIndex((cur - 1 + 9) % 9);
        }
      }
    };

    const handleKeyDown = (e) => {
      if (document.pointerLockElement && e.code === 'KeyQ') {
        useStore
          .getState()
          .dropItemFromSlot('inventory', activeIdxRef.current, false);
      }
    };

    window.addEventListener('wheel', handleWheel);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [setActiveHotbarIndex]); // no activeHotbarIndex dep — use ref instead

  const activeItem = hotbarItems[activeHotbarIndex];
  const activeReg = activeItem ? GlobalRegistry[activeItem.texture] : null;

  // Hide hotbar completely during menus and death screen
  if (isInventoryOpen || isMenuOpen || isSettingsOpen || isDead) return null;

  return (
    <div className="hotbar-wrapper">
      <div className="coin-display">
        ⚙ <span className="coin-amount">{coins}</span>
      </div>

      {activeReg && (
        <div className="active-item-name">
          {activeReg.name} {activeItem.count > 1 ? `(${activeItem.count})` : ''}
        </div>
      )}

      <div className="hotbar-container">
        <div className="hotbar-group blocks-group">
          {hotbarItems.map((item, idx) => {
            const color = item
              ? GlobalRegistry[item.texture]?.color || '#fff'
              : 'transparent';
            return (
              <div
                key={`hb-${idx}`}
                className={`hotbar-slot ${activeHotbarIndex === idx ? 'active' : ''}`}
                onClick={() => setActiveHotbarIndex(idx)}
              >
                <div className="hotbar-number">{idx + 1}</div>
                {item && (
                  <div
                    className="hotbar-icon"
                    style={{ backgroundColor: color }}
                  >
                    {item.count > 1 && (
                      <span className="item-count">{item.count}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
