import { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useStore } from '../stores/useStore';
import * as THREE from 'three';

// Hoisted reusable vector — avoids new THREE.Vector3() every frame at 60fps
const _dir = new THREE.Vector3();

// WHY THIS APPROACH:
// camera.add(light) does NOT work — Three.js collects lights by traversing
// scene.children recursively. The camera is passed separately to
// renderer.render(scene, camera) and is NOT in the scene graph.
// Any light added to the camera is invisible to the light collection pass.
//
// CORRECT approach: render <pointLight> via JSX so R3F adds it to the scene,
// then sync its world position to the camera each frame via useFrame.
// No useEffect, no manual add/remove, no memory leaks.

export const Lantern = () => {
  const lightRef = useRef();
  const { camera } = useThree();

  const target = useMemo(() => new THREE.Object3D(), []);

  // Read texture directly in useFrame to avoid closure staleness
  useFrame(() => {
    if (!lightRef.current) return;
    const on = useStore.getState().texture === 'lantern';
    // Move the scene-level light to exactly where the camera is each frame
    lightRef.current.position.copy(camera.position);

    // Point the spotlight forward using reused vector
    camera.getWorldDirection(_dir);
    target.position.copy(camera.position).add(_dir.multiplyScalar(10));

    lightRef.current.intensity = on ? 40 : 0;
  });

  return (
    <>
      <primitive object={target} />
      <spotLight
        ref={lightRef}
        color="#ffffff"
        intensity={0}
        distance={60}
        angle={Math.PI / 4}
        penumbra={0.5}
        decay={1.2}
        target={target}
      />
    </>
  );
};
