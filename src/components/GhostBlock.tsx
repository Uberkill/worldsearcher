// @ts-nocheck
import { useStore } from '../stores/useStore';
import { Edges } from '@react-three/drei';
import { MaterialCache } from '../utils/MaterialCache';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { shipTransforms } from '../globals';

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _shipPos = new THREE.Vector3();
const _targetPos = new THREE.Vector3();

export const GhostBlock = () => {
  const hoverTarget = useStore((state) => state.hoverTarget);
  const hoverBlockInfo = useStore((state) => state.hoverBlockInfo);
  const meshRef = useRef(null);

  useFrame(() => {
    if (!meshRef.current || !hoverTarget) return;

    if (hoverBlockInfo?.isShip) {
      const shipTransform = shipTransforms.get('default');
      if (shipTransform) {
        _shipPos.set(shipTransform.position.x, shipTransform.position.y, shipTransform.position.z);
        _euler.set(shipTransform.rotation.x, shipTransform.rotation.y, shipTransform.rotation.z, 'XYZ');
        _quat.setFromEuler(_euler);
        
        // Local position relative to ship center
        _targetPos.set(hoverTarget[0] - 16, hoverTarget[1] - 16, hoverTarget[2] - 16);
        
        // Apply ship rotation
        _targetPos.applyQuaternion(_quat);
        
        // Add absolute position
        _targetPos.add(_shipPos);
        
        meshRef.current.position.copy(_targetPos);
        meshRef.current.quaternion.copy(_quat); // Rotate wireframe to match ship!
      }
    } else {
      meshRef.current.position.set(
        hoverTarget[0] + 0.5,
        hoverTarget[1] + 0.5,
        hoverTarget[2] + 0.5
      );
      meshRef.current.quaternion.identity();
    }
  });

  if (!hoverTarget) return null;

  return (
    <mesh
      ref={meshRef}
      raycast={() => null}
      material={MaterialCache.getBasic('#ffffff', false)}
    >
      <boxGeometry args={[1.005, 1.005, 1.005]} />
      <Edges linewidth={2} color="black" transparent opacity={0.5} />
    </mesh>
  );
};

