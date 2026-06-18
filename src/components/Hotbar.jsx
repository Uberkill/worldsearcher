import { useEffect, useMemo, useRef } from 'react';
import { useStore } from '../stores/useStore';
import { useUIStore } from '../stores/useUIStore';
import { useKeyboard } from '../hooks/useKeyboard';
import { GlobalRegistry } from '../registry/Registry';

export const Hotbar = () => {
  const inventory = useStore((state) => state.inventory);
  const activeHotbarIndex = useStore((state) => state.activeHotbarIndex);
  const setActiveHotbarIndex = useStore((state) => state.setActiveHotbarIndex);
  const coins = useStore((state) => state.coins);
  const isInventoryOpen = useUIStore((state) => state.activeModal === 'INVENTORY');
  const isMenuOpen = useUIStore((state) => state.activeModal === 'MENU');
  const isSettingsOpen = useStore((state) => state.isSettingsOpen);
  const isDead = useStore((state) => state.isDead);

  const hotbarItems = useMemo(() => {
    const items = inventory.slice(0, 9);
    while (items.length < 9) items.push(null);
    return items;
  }, [inventory]);

  // We will conditionally return null after all hooks

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!document.pointerLockElement) return;
      if (useUIStore.getState().activeModal) return;
      if (e.code.startsWith('Digit')) {
        const slot = parseInt(e.code.replace('Digit', ''), 10) - 1;
        if (slot >= 0 && slot < 9) setActiveHotbarIndex(slot);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setActiveHotbarIndex]);

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
  const isSeated = useStore((state) => state.isSeated);

  // Hide hotbar completely during menus, death screen, or steering ship
  if (isInventoryOpen || isMenuOpen || isSettingsOpen || isDead || isSeated) return null;

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
