import React, { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useStore } from '../stores/useStore';
import * as THREE from 'three';

export const Tether = () => {
  const lineRef = useRef();
  
  // Zero-allocation static object pool for the tether line
  const positions = useMemo(() => new Float32Array(6), []);
  const { camera } = useThree();

  useFrame(() => {
    if (!lineRef.current) return;
    const target = useStore.getState().grappleTarget;
    
    if (!target) {
       if (lineRef.current.geometry.drawRange.count > 0) {
          lineRef.current.geometry.setDrawRange(0, 0);
       }
       return;
    }
    
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    
    // Approximate the visual start point at the barrel of the grapple gun
    const visualStart = camera.position.clone()
       .addScaledVector(dir, 0.5)
       .addScaledVector(camera.up, -0.2)
       .addScaledVector(dir.clone().cross(camera.up).normalize(), 0.2); // Right
       
    positions[0] = visualStart.x;
    positions[1] = visualStart.y;
    positions[2] = visualStart.z;
    positions[3] = target[0];
    positions[4] = target[1];
    positions[5] = target[2];
    
    lineRef.current.geometry.setDrawRange(0, 2);
    lineRef.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <lineSegments ref={lineRef} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={2}
          array={positions}
          itemSize={3}
          usage={THREE.DynamicDrawUsage}
        />
      </bufferGeometry>
      <lineBasicMaterial color="#ffffff" linewidth={3} transparent opacity={0.6} />
    </lineSegments>
  );
};
