// @ts-nocheck
import { useEffect, useRef } from 'react';
import { useStore } from '../../stores/useStore';
import { GlobalRegistry } from '../../registry/Registry';

export function CursorItem() {
  const heldItem = useStore((state) => state.heldItem);
  const cursorRef = useRef(null);

  useEffect(() => {
    if (!heldItem) return;

    // Imperative DOM tracking bypasses React renders entirely, achieving <0.1ms cursor sync!
    const moveCursor = (e) => {
      if (cursorRef.current) {
        cursorRef.current.style.transform = `translate(${e.clientX - 16}px, ${e.clientY - 16}px)`;
      }
    };

    window.addEventListener('mousemove', moveCursor);
    return () => window.removeEventListener('mousemove', moveCursor);
  }, [heldItem]);

  if (!heldItem) return null;

  const reg = heldItem ? GlobalRegistry[heldItem.texture] : null;
  let imgSrc = null;
  let fallbackColor = 'transparent';

  if (reg) {
    fallbackColor = reg.color || '#ffffff';
    if (reg.texture) {
      imgSrc = `${import.meta.env.BASE_URL}textures/blocks/${reg.texture}`;
    } else if (reg.textures) {
      imgSrc = `${import.meta.env.BASE_URL}textures/blocks/${reg.textures.side || reg.textures.top}`;
    } else {
      imgSrc = `${import.meta.env.BASE_URL}textures/items/${heldItem.texture}.png`;
    }
  }


  return (
    <div
      ref={cursorRef}
      className="fixed top-0 left-0 pointer-events-none z-[9999]"
      style={{ width: '32px', height: '32px' }}
    >
      <div
        className="absolute inset-0 border border-black/50"
        style={{
          backgroundColor: fallbackColor,
        }}
      >
        {imgSrc && (
          <img
            src={imgSrc}
            alt="held"
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
      {heldItem.count > 1 && (
        <span
          className="absolute -bottom-2 -right-2 text-white text-xs font-bold font-mono"
          style={{ textShadow: '1px 1px 0 #000' }}
        >
          {heldItem.count}
        </span>
      )}
    </div>
  );
}

