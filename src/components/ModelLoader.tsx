// @ts-nocheck
import { useGLTF } from '@react-three/drei';
import { useMemo } from 'react';

/**
 * Dynamically loads and clones a GLTF model.
 * @param {string} url - Path to the .gltf or .glb file (relative to public/)
 * @param {boolean} castShadow - Whether the model casts shadows
 */
export const ModelLoader = ({
  url,
  castShadow = true,
  receiveShadow = true,
  scale = 1,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
}) => {
  const { scene } = useGLTF(url);

  // Clone the scene so we can spawn multiple instances of the same model safely
  const clonedScene = useMemo(() => {
    const clone = scene.clone();
    clone.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = castShadow;
        child.receiveShadow = receiveShadow;
        // Optionally enable frustum culling
        child.frustumCulled = true;
      }
    });
    return clone;
  }, [scene, castShadow, receiveShadow]);

  return (
    <primitive
      object={clonedScene}
      scale={scale}
      position={position}
      rotation={rotation}
    />
  );
};

// Pre-cache commonly used models
// useGLTF.preload('/models/sword.gltf');

