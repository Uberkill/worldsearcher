// @ts-nocheck
import { RigidBody } from '@react-three/rapier';
import { useStore } from '../stores/useStore';
import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { MaterialCache } from '../utils/MaterialCache';

import { GlobalRegistry } from '../registry/Registry';

export const DynamicCube = ({ block }) => {
  const bakeCube = useStore((state) => state.bakeCube);

        const removeDebris = useStore((state) => state.removeDebris);
  const ref = useRef();
  const meshRef = useRef();

  useEffect(() => {
    if (ref.current) {
      ref.current.wakeUp();
      ref.current.applyImpulse(
        {
          x: (Math.random() - 0.5) * 0.5,
          y: -0.01,
          z: (Math.random() - 0.5) * 0.5,
        },
        true
      );
    }
  }, []);

  const hasRemoved = useRef(false);
  useFrame(() => {
    if (!block.isDebris || hasRemoved.current) return; // Completely bail out if not debris (optimization)

    const age = Date.now() - block.createdAt;
    if (age > 8000) {
      // Shrink for the last 2 seconds
      const shrinkFactor = Math.max(0, 1 - (age - 8000) / 2000);
      if (meshRef.current) {
        meshRef.current.scale.setScalar(shrinkFactor);
      }
      if (shrinkFactor === 0) {
        hasRemoved.current = true;
        removeDebris(block.key);
      }
    }
  });

  return (
    <RigidBody
      ref={ref}
      type="dynamic"
      position={[block.pos[0] + 0.5, block.pos[1] + 0.5, block.pos[2] + 0.5]}
      colliders="cuboid"
      onSleep={() => {
        if (ref.current && !block.isDebris) {
          const trans = ref.current.translation();
          // Defer state update to next tick to avoid unmounting the RigidBody during Rapier physics step
          setTimeout(() => {
            bakeCube(block.key, [trans.x, trans.y, trans.z]);
          }, 0);
        }
      }}
    >
      <mesh
        ref={meshRef}
        castShadow
        receiveShadow
        material={MaterialCache.getStandard(
          GlobalRegistry[block.texture]?.color || '#ffffff',
          GlobalRegistry[block.texture]?.isTransparent || false,
          GlobalRegistry[block.texture]?.isTransparent ? 0.6 : 1
        )}
      >
        <boxGeometry />
      </mesh>
    </RigidBody>
  );
};

