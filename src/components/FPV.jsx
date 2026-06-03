import { PointerLockControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useStore } from '../stores/useStore';
import { useEffect } from 'react';

export const FPV = () => {
  const { camera, gl } = useThree();
  const isShopOpen = useStore((state) => state.isShopOpen);
  const isInventoryOpen = useStore((state) => state.isInventoryOpen);
  const isMenuOpen = useStore((state) => state.isMenuOpen);
  const isSettingsOpen = useStore((state) => state.isSettingsOpen);

  const isAnyOverlayOpen = isShopOpen || isInventoryOpen || isMenuOpen || isSettingsOpen;

  useEffect(() => {
    if (isAnyOverlayOpen && document.pointerLockElement) {
      document.exitPointerLock();
    }
  }, [isAnyOverlayOpen]);

  if (isAnyOverlayOpen) return null;

  return <PointerLockControls 
    args={[camera, gl.domElement]} 
    onUnlock={() => {
      // If no overlay is open, and the user hits ESC, the browser naturally unlocks the cursor.
      // We must detect this and open the ESC menu!
      if (!useStore.getState().isShopOpen && !useStore.getState().isInventoryOpen && !useStore.getState().isMenuOpen && !useStore.getState().isSettingsOpen && !useStore.getState().isDead) {
        useStore.getState().toggleMenu();
      }
    }}
  />;
};
