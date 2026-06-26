// @ts-nocheck
import { useSettingsStore } from '../stores/useSettingsStore';

import { PointerLockControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useStore } from '../stores/useStore';
import { useEffect } from 'react';

export const FPV = () => {
  const { camera, gl } = useThree();
  const isAnyOverlayOpen = useStore((state) => state.isUIActive());
  const renderDistance = useSettingsStore((state) => state.renderDistance);

  useEffect(() => {
    // Dynamically adjust the far plane based on Render Distance to fix frustum culling!
    // 1 chunk = 16 units. We add a small buffer so chunks don't pop before the fog fully covers them.
    // eslint-disable-next-line react-hooks/immutability
    camera.far = renderDistance * 16 + 48;
    camera.updateProjectionMatrix();
  }, [renderDistance, camera]);

  useEffect(() => {
    if (isAnyOverlayOpen && document.pointerLockElement) {
      document.exitPointerLock();
    }
  }, [isAnyOverlayOpen]);

  if (isAnyOverlayOpen) return null;

  return (
    <PointerLockControls
      args={[camera, gl.domElement]}
      onUnlock={() => {
        // If no overlay is open, and the user hits ESC, the browser naturally unlocks the cursor.
        // We must detect this and open the ESC menu!
        if (!useStore.getState().isUIActive() && !useStore.getState().isDead) {
          useStore.getState().toggleMenu();
        }
      }}
    />
  );
};

