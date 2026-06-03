import { useStore } from '../stores/useStore';
import { useNetworkStore } from '../stores/useNetworkStore';
import { RigidBody, CuboidCollider } from '@react-three/rapier';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';

// A simple tombstone component
const TombstoneItem = ({ tombstone }) => {
  const meshRef = useRef();
  const playerPosition = useStore(state => state.playerPos);
  
  useFrame(() => {
     if (!meshRef.current) return;
     // Rotate slowly
     meshRef.current.rotation.y += 0.01;
     
     // Interaction check
     const px = playerPosition[0];
     const py = playerPosition[1];
     const pz = playerPosition[2];
     
     const dx = px - tombstone.pos[0];
     const dy = py - tombstone.pos[1];
     const dz = pz - tombstone.pos[2];
     const distSq = dx*dx + dy*dy + dz*dz;
     
     if (distSq < 4) { // Within 2 blocks
        // Claim inventory!
        const state = useStore.getState();
        let anyCollected = false;
        
        tombstone.inventory.forEach(item => {
           if (item && item.texture) {
               const leftover = state.addInventoryItem(item.texture, item.count);
               if (leftover < item.count) anyCollected = true;
           }
        });
        
        if (anyCollected) {
           useStore.getState().removeTombstone(tombstone.id);
           const netStore = useNetworkStore.getState();
           netStore.addChatMessage(`Looted ${tombstone.ownerName}'s Tombstone!`, 'system', 'System');
        }
     }
  });

  return (
    <RigidBody position={tombstone.pos} colliders={false} type="dynamic" mass={1} lockRotations>
      <CuboidCollider args={[0.4, 0.5, 0.4]} />
      <group ref={meshRef}>
         <mesh castShadow receiveShadow position={[0, 0, 0]}>
           <boxGeometry args={[0.8, 1, 0.8]} />
           <meshStandardMaterial color="#444444" />
         </mesh>
         <Text
            position={[0, 0.51, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={0.2}
            color="white"
            anchorX="center"
            anchorY="middle"
         >
            RIP
         </Text>
         <Text
            position={[0, 0.6, 0.41]}
            fontSize={0.15}
            color="white"
            anchorX="center"
            anchorY="middle"
         >
            {tombstone.ownerName}
         </Text>
      </group>
    </RigidBody>
  );
};

export const Tombstones = () => {
  const tombstones = useStore(state => state.tombstones) || [];
  
  return (
    <group>
      {tombstones.map(tombstone => (
         <TombstoneItem key={tombstone.id} tombstone={tombstone} />
      ))}
    </group>
  );
};
