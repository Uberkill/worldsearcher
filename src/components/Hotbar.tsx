// @ts-nocheck
import { useSettingsStore } from '../stores/useSettingsStore';

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
  const isSettingsOpen = useSettingsStore((state) => state.isSettingsOpen);
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
    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3 z-[100]">
      <div className="absolute bottom-full right-0 mb-3 bg-slate-900/60 backdrop-blur-md px-5 py-2 rounded-lg text-slate-100 text-lg font-medium border border-white/10 z-[1000] shadow-xl">
        ⚙ {coins}
      </div>

      {activeReg && (
        <div className="text-slate-100 text-sm font-medium bg-slate-900/60 px-5 py-1.5 rounded-full backdrop-blur-md border border-white/10 uppercase tracking-[0.2em] shadow-lg">
          {activeReg.name} {activeItem.count > 1 ? `(${activeItem.count})` : ''}
        </div>
      )}

      <div className="flex items-center gap-3 p-3 bg-slate-900/60 backdrop-blur-md border border-white/10 rounded-lg shadow-2xl">
        <div className="flex gap-2 p-1 rounded bg-white/5">
          {hotbarItems.map((item, idx) => {
            const color = item
              ? GlobalRegistry[item.texture]?.color || '#fff'
              : 'transparent';
            const isActive = activeHotbarIndex === idx;
            return (
              <div
                key={`hb-${idx}`}
                className={`relative w-12 h-12 rounded bg-black/20 border border-transparent flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-white/5 ${isActive ? 'border-white/50 bg-white/10 shadow-lg -translate-y-1' : ''}`}
                onClick={() => setActiveHotbarIndex(idx)}
              >
                <div className="absolute inset-0 p-1.5 flex flex-col justify-between pointer-events-none">
                  <span className="text-[10px] font-semibold text-white/50 leading-none">{idx + 1}</span>
                  <div className="flex justify-end">
                    {item && item.count > 1 && (
                      <span className="text-[10px] font-semibold text-white drop-shadow-md leading-none">
                        {item.count}
                      </span>
                    )}
                  </div>
                </div>
                {item && (
                  <div
                    className={`w-7 h-7 rounded-sm shadow-md border border-white/5 transition-transform duration-200 ${isActive ? 'scale-105' : ''}`}
                    style={{ backgroundColor: color }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

