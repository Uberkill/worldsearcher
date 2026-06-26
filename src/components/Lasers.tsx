// @ts-nocheck
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useStore } from '../stores/useStore';
import * as THREE from 'three';

const MAX_LASERS = 50;
const LASER_GEO = new THREE.CylinderGeometry(0.05, 0.05, 1, 8);
// Rotate geometry so it points along Z axis instead of Y axis
LASER_GEO.rotateX(Math.PI / 2);
const LASER_MAT = new THREE.MeshBasicMaterial({
  color: '#00ffff',
  transparent: true,
  opacity: 0.8,
});
const _dummy = new THREE.Object3D();

export const Lasers = () => {
  const meshRef = useRef();

  useFrame(() => {
    if (!meshRef.current) return;
    const lasers = useStore.getState().lasers || [];

    // Hide all instances by default
    for (let i = 0; i < MAX_LASERS; i++) {
      _dummy.position.set(0, -1000 - i, 0);
      _dummy.scale.set(0, 0, 0);
      _dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, _dummy.matrix);
    }

    let index = 0;
    for (const l of lasers) {
      if (index >= MAX_LASERS) break;

      const start = new THREE.Vector3(l.start[0], l.start[1], l.start[2]);
      const end = new THREE.Vector3(l.end[0], l.end[1], l.end[2]);

      const distance = start.distanceTo(end);
      if (distance < 0.001) continue;
      const midPoint = start.clone().lerp(end, 0.5);

      _dummy.position.copy(midPoint);
      _dummy.scale.set(1, 1, distance); // Scale Z to the distance
      _dummy.lookAt(end);
      _dummy.updateMatrix();

      meshRef.current.setMatrixAt(index, _dummy.matrix);
      index++;
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[LASER_GEO, LASER_MAT, MAX_LASERS]}
      frustumCulled={false}
    />
  );
};

