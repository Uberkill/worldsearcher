// @ts-nocheck
import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useStore } from '../stores/useStore';
import { networkActions } from '../stores/networkActions';

export const GlitchFire = ({ id, position }) => {
  const meshRef = useRef();
  
  useFrame((state, delta) => {
    if (meshRef.current) {
       // Simple flickering animation
       meshRef.current.scale.y = 1 + Math.sin(state.clock.elapsedTime * 20) * 0.2;
       meshRef.current.rotation.y += delta;
    }
  });

  const handleExtinguish = (e) => {
    e.stopPropagation();
    
    // Extinguish locally
    useStore.getState().extinguishFire(id);
    
    // Send network intent
    const netState = networkActions.getState();
    if (netState.isHost) {
        netState.broadcastEvent({ type: 'EXTINGUISH_FIRE', id });
    } else {
        const reliableConn = netState.connections[0];
        if (reliableConn) {
            try { reliableConn.send({ type: 'EXTINGUISH_FIRE', id }); } catch {}
        }
    }
  };

  return (
    <group position={position}>
       {/* Interactive Hitbox */}
       <mesh visible={false} onClick={handleExtinguish}>
          <boxGeometry args={[1.5, 2, 1.5]} />
          <meshBasicMaterial transparent opacity={0} />
       </mesh>
       
       {/* Visual Fire/Glitch Particle */}
       <mesh ref={meshRef} position={[0, 0.5, 0]}>
          <coneGeometry args={[0.5, 1, 4]} />
          <meshStandardMaterial color="red" emissive="orange" emissiveIntensity={2} wireframe />
       </mesh>
       <mesh position={[0, 0.2, 0]}>
          <boxGeometry args={[0.8, 0.8, 0.8]} />
          <meshStandardMaterial color="purple" emissive="purple" emissiveIntensity={1} wireframe />
       </mesh>
    </group>
  );
};

