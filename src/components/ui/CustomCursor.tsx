// @ts-nocheck
import { useEffect, useRef } from 'react';

export default function CustomCursor() {
  const cursorRef = useRef(null);

  useEffect(() => {
    const cursor = cursorRef.current;
    if (!cursor) return;

    const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
    if (isTouchDevice) {
      cursor.style.display = 'none';
      return;
    }

    let isVisible = false;
    const handleMouseMove = (e) => {
      if (!isVisible) {
        cursor.style.opacity = '1';
        isVisible = true;
      }
      cursor.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
    };

    const handleMouseLeave = () => {
      cursor.style.opacity = '0';
      isVisible = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    document.body.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      document.body.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);

  return (
    <div
      ref={cursorRef}
      className="fixed top-0 left-0 w-8 h-8 pointer-events-none z-[9999] flex items-center justify-center mix-blend-screen opacity-0"
      style={{
        transform: 'translate3d(-100px, -100px, 0)',
        transition: 'opacity 0.3s ease-out',
      }}
    >
      <div className="w-1 h-1 bg-white rounded-full animate-ping absolute" />
      <div className="w-4 h-4 border border-white/50 rounded-full opacity-50" />
    </div>
  );
}

