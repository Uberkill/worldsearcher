import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useStore } from '../stores/useStore';
import * as THREE from 'three';

const MAX_LASERS = 50;

export const Lasers = () => {
  const lineRef = useRef();
  
  // Zero-allocation static object pool for drawing lines
  const positions = useMemo(() => new Float32Array(MAX_LASERS * 2 * 3), []);

  useFrame(() => {
    if (!lineRef.current) return;
    const lasers = useStore.getState().lasers || [];
    let count = 0;
    
    for (let i = 0; i < lasers.length; i++) {
      if (i >= MAX_LASERS) break;
      const l = lasers[i];
      // Start pos
      positions[count * 6 + 0] = l.start[0];
      positions[count * 6 + 1] = l.start[1];
      positions[count * 6 + 2] = l.start[2];
      // End pos
      positions[count * 6 + 3] = l.end[0];
      positions[count * 6 + 4] = l.end[1];
      positions[count * 6 + 5] = l.end[2];
      count++;
    }
    
    if (count > 0) {
       lineRef.current.geometry.setDrawRange(0, count * 2);
       lineRef.current.geometry.attributes.position.needsUpdate = true;
    } else if (lineRef.current.geometry.drawRange.count > 0) {
       // Reset once and stop uploading
       lineRef.current.geometry.setDrawRange(0, 0);
    }
  });

  return (
    <lineSegments ref={lineRef} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={MAX_LASERS * 2}
          array={positions}
          itemSize={3}
          usage={THREE.DynamicDrawUsage}
        />
      </bufferGeometry>
      <lineBasicMaterial color="#00ffff" linewidth={2} transparent opacity={0.8} />
    </lineSegments>
  );
};
