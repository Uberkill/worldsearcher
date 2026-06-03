import { RigidBody } from '@react-three/rapier';
import { useStore } from '../stores/useStore';
import { useRef, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { playerPosition } from '../globals';
import * as THREE from 'three';
import { MaterialCache } from '../utils/MaterialCache';

import { GlobalRegistry } from '../registry/Registry';

export const DynamicCube = ({ block }) => {
  const bakeCube = useStore(state => state.bakeCube);

  const addCube = useStore(state => state.addCube);
  const setHoverTarget = useStore((state) => state.setHoverTarget);
  const damageBlock = useStore(state => state.damageBlock);
  const removeDebris = useStore(state => state.removeDebris);
  const ref = useRef();
  const meshRef = useRef();
  
  useEffect(() => {
    if (ref.current) {
      ref.current.wakeUp();
      ref.current.applyImpulse({ x: (Math.random()-0.5)*0.5, y: -0.01, z: (Math.random()-0.5)*0.5 }, true);
    }
  }, []);
  
  useFrame(() => {
    if (!block.isDebris) return; // Completely bail out if not debris (optimization)
    
    const age = Date.now() - block.createdAt;
    if (age > 8000) {
      // Shrink for the last 2 seconds
      const shrinkFactor = Math.max(0, 1 - (age - 8000) / 2000);
      if (meshRef.current) {
        meshRef.current.scale.setScalar(shrinkFactor);
      }
      if (shrinkFactor === 0) {
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
          bakeCube(block.key, [trans.x, trans.y, trans.z]);
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
