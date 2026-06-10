import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useStore } from '../stores/useStore';
import * as THREE from 'three';

const TETHER_GEO = new THREE.CylinderGeometry(0.04, 0.04, 1, 8);
TETHER_GEO.rotateX(Math.PI / 2);
const TETHER_MAT = new THREE.MeshBasicMaterial({
  color: '#ffffff',
  transparent: true,
  opacity: 0.6,
});
const _dummy = new THREE.Object3D();
const _dir = new THREE.Vector3();
const _camWorldPos = new THREE.Vector3();
const _right = new THREE.Vector3();
const _end = new THREE.Vector3();
const _midPoint = new THREE.Vector3();
const _visualStart = new THREE.Vector3();

export const Tether = () => {
  const meshRef = useRef();
  const { camera } = useThree();

  useFrame(() => {
    if (!meshRef.current) return;
    const target = useStore.getState().grappleTarget;

    if (!target) {
      _dummy.position.set(0, -1000, 0);
      _dummy.scale.set(0, 0, 0);
      _dummy.updateMatrix();
      meshRef.current.setMatrixAt(0, _dummy.matrix);
      meshRef.current.instanceMatrix.needsUpdate = true;
      return;
    }

    camera.getWorldDirection(_dir);

    // Approximate the visual start point at the barrel of the grapple gun
    _right.copy(_dir).cross(camera.up);
    if (_right.lengthSq() < 0.0001) _right.set(1, 0, 0);
    _right.normalize();

    camera.getWorldPosition(_camWorldPos);
    
    _visualStart.copy(_camWorldPos)
      .addScaledVector(_dir, 0.4) // Forward
      .addScaledVector(camera.up, -0.3) // Down
      .addScaledVector(_right, 0.2); // Right

    _end.set(target[0], target[1], target[2]);
    const distance = _visualStart.distanceTo(_end);

    if (distance > 0.001) {
      _midPoint.copy(_visualStart).lerp(_end, 0.5);
      _dummy.position.copy(_midPoint);
      _dummy.scale.set(1, 1, distance);
      _dummy.lookAt(_end);
      _dummy.updateMatrix();
      meshRef.current.setMatrixAt(0, _dummy.matrix);
      meshRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[TETHER_GEO, TETHER_MAT, 1]}
      frustumCulled={false}
    />
  );
};
