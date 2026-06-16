import { useRef, useEffect } from 'react';
import { RigidBody, CuboidCollider } from '@react-three/rapier';
import { useStore } from '../stores/useStore';
import { MaterialCache } from '../utils/MaterialCache';
import * as THREE from 'three';
import { EventBus } from '../utils/EventBus';

const getColor = (texture) => {
  switch (texture) {
    case 'dirt':
      return '#8B4513';
    case 'grass':
      return '#4CAF50';
    case 'glass':
      return '#add8e6';
    case 'wood':
      return '#DEB887';
    case 'log':
      return '#654321';
    case 'leaves':
      return '#228B22';
    case 'stone':
      return '#888888';
    case 'tnt':
      return '#ff3333';
    default:
      return '#ffffff';
  }
};

export const FallingStructure = ({ structure }) => {
  const ref = useRef();
  const shatterStructure = useStore((state) => state.shatterStructure);
  const activeTexture = useStore((state) => state.texture);

  // Calculate center of mass roughly (the average position)
  const center = new THREE.Vector3(0, 0, 0);
  structure.blocks.forEach((b) =>
    center.add(new THREE.Vector3(b.x + 0.5, b.y + 0.5, b.z + 0.5))
  );
  if (structure.blocks.length > 0) {
    center.divideScalar(structure.blocks.length);
  }

  const hasShattered = useRef(false);

  const triggerShatter = () => {
    if (!ref.current || hasShattered.current) return;
    hasShattered.current = true;
    const translation = ref.current.translation();
    const rotation = ref.current.rotation();
    const quat = new THREE.Quaternion(
      rotation.x,
      rotation.y,
      rotation.z,
      rotation.w
    );
    const groupPos = new THREE.Vector3(
      translation.x,
      translation.y,
      translation.z
    );

    // Calculate exact world position of every sub-block
    const debrisBlocks = structure.blocks.map((block) => {
      // block.x/y/z is absolute integer. True center is +0.5. We need its relative pos to the center
      const localPos = new THREE.Vector3(
        block.x + 0.5,
        block.y + 0.5,
        block.z + 0.5
      ).sub(center);

      // Apply tumbling rotation
      localPos.applyQuaternion(quat);

      // Add back the global position of the tumbling rigid body
      const worldPos = localPos.add(groupPos);

      return {
        ...block,
        pos: [worldPos.x, worldPos.y, worldPos.z],
        isDebris: true,
        createdAt: Date.now(),
      };
    });
    // Defer state update to next tick to avoid unmounting the RigidBody while Rapier is inside a physics step
    setTimeout(() => {
      shatterStructure(structure.id, debrisBlocks);
    }, 0);
  };

  useEffect(() => {
    if (ref.current) {
      ref.current.wakeUp();
      // Apply a dramatic rotational impulse to force it to tip over sideways!
      ref.current.applyTorqueImpulse(
        {
          x: (Math.random() - 0.5) * 5,
          y: 0,
          z: (Math.random() - 0.5) * 5,
        },
        true
      );
    }

    // FAILSAFE: If the structure falls into the void and never collides,
    // force shatter it after 15 seconds to prevent an infinite physics leak!
    const timeout = setTimeout(() => triggerShatter(), 15000);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCollision = (e) => {
    if (!ref.current) return;

    // Shatter if hitting ground, terrain, or experiencing significant force
    const hitName = e.target.rigidBodyObject?.name;
    if (
      hitName === 'ground' ||
      hitName === 'terrain' ||
      e.totalForceMagnitude > 20
    ) {
      triggerShatter();
    }
  };



  return (
    <RigidBody
      ref={ref}
      type="dynamic"
      position={[center.x, center.y, center.z]}
      onCollisionEnter={handleCollision}
      mass={structure.blocks.length * 0.5}
    >
      <group>
        {structure.blocks.map((block) => {
          // Relative position for colliders and meshes
          const rx = block.x + 0.5 - center.x;
          const ry = block.y + 0.5 - center.y;
          const rz = block.z + 0.5 - center.z;

          return (
            <group
              key={`${block.x},${block.y},${block.z}`}
              position={[rx, ry, rz]}
            >
              <CuboidCollider args={[0.45, 0.45, 0.45]} />
              <mesh
                castShadow
                receiveShadow
                material={MaterialCache.getStandard(
                  getColor(block.texture),
                  block.texture === 'glass',
                  block.texture === 'glass' ? 0.6 : 1
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  if (e.distance > 8) return;
                  if (
                    activeTexture === 'pickaxe' ||
                    activeTexture === 'sword' ||
                    activeTexture === 'gun'
                  ) {
                    EventBus.emit('audio', { sound: 'break', source: 'local' });
                    triggerShatter();
                  }
                }}
              >
                <boxGeometry args={[1, 1, 1]} />
              </mesh>
            </group>
          );
        })}
      </group>
    </RigidBody>
  );
};
