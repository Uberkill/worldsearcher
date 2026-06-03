import { useFrame } from '@react-three/fiber';
import { useStore } from '../stores/useStore';
import { useRef, useMemo } from 'react';
import * as THREE from 'three';

const MAX_BULLETS = 100;
const BULLET_GEO = new THREE.SphereGeometry(0.1, 6, 6);
const BULLET_MAT = new THREE.MeshBasicMaterial({ color: '#ffee00' });
const _dummy = new THREE.Object3D();

export const Bullets = () => {
  const meshRef = useRef();

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    const projectiles = useStore.getState().visualProjectiles || [];
    
    // Hide all instances by default (move far away)
    for (let i = 0; i < MAX_BULLETS; i++) {
        _dummy.position.set(0, -1000 - i, 0);
        _dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, _dummy.matrix);
    }
    
    const now = performance.now();
    let index = 0;
    
    for (const p of projectiles) {
        if (index >= MAX_BULLETS) break;
        
        // Linear Math: position += velocity * (timeAlive_in_seconds)
        const ageSec = (now - p.createdAt) / 1000;
        
        // Destory if alive longer than 5 seconds without impact
        if (ageSec > 5) {
             useStore.getState().destroyVisualProjectile(p.id, null);
             continue;
        }
        
        const curX = p.pos[0] + (p.vel[0] * ageSec);
        const curY = p.pos[1] + (p.vel[1] * ageSec); // Could add -9.8 * ageSec^2 / 2 for gravity arc if we wanted
        const curZ = p.pos[2] + (p.vel[2] * ageSec);
        
        _dummy.position.set(curX, curY, curZ);
        _dummy.updateMatrix();
        meshRef.current.setMatrixAt(index, _dummy.matrix);
        index++;
    }
    
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={meshRef} args={[BULLET_GEO, BULLET_MAT, MAX_BULLETS]} />
    </group>
  );
};
