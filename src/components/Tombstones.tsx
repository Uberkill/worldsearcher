import { useStore } from '../stores/useStore';
import { useInventoryStore } from '../stores/inventorySlice';
import { playerPosition as globalPlayerPosition } from '../globals';
import { networkActions } from '../stores/networkActions';
import { RigidBody, CuboidCollider } from '@react-three/rapier';
import { Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';

// A simple tombstone component
const TombstoneItem = ({ tombstone }) => {
  const meshRef = useRef();

  const handleLoot = () => {
    const state = useStore.getState();
    let toDrop = [];

    tombstone.inventory.forEach((item) => {
      if (item && item.texture) {
        const leftover = state.addInventoryItem(item.texture, item.count);
        if (leftover > 0) {
          toDrop.push({ texture: item.texture, count: leftover });
        }
      }
    });

    if (toDrop.length > 0) {
      const netStore = networkActions.getState();
      toDrop.forEach((item) => {
        const dropIntent = {
          type: 'SPAWN_LOOT',
          id: Math.random().toString(36),
          itemId: item.texture,
          amount: item.count,
          position: [
            tombstone.pos[0] + (Math.random() - 0.5),
            tombstone.pos[1] + 1,
            tombstone.pos[2] + (Math.random() - 0.5),
          ]
        };
        useStore.getState().spawnLoot(dropIntent);
        netStore.broadcastEvent(dropIntent);
      });
    }

    useStore.getState().removeTombstone(tombstone.id);
    const netStore = networkActions.getState();
    netStore.addChatMessage(
      `Looted ${tombstone.ownerName}'s Tombstone!`,
      'system',
      'System'
    );
    if (netStore.removeWaypoint) netStore.removeWaypoint('death_waypoint');
  };

  useFrame(() => {
    if (!meshRef.current) return;
    // Rotate slowly
    meshRef.current.rotation.y += 0.01;

    // Interaction check
    const px = globalPlayerPosition.x;
    const py = globalPlayerPosition.y;
    const pz = globalPlayerPosition.z;

    const dx = px - tombstone.pos[0];
    const dy = py - tombstone.pos[1];
    const dz = pz - tombstone.pos[2];
    const distSq = dx * dx + dy * dy + dz * dz;

    if (distSq < 4) {
      // Within 2 blocks
      handleLoot();
    }
  });

  return (
    <RigidBody
      position={tombstone.pos}
      colliders={false}
      type="fixed"
      lockRotations
    >
      <CuboidCollider args={[0.4, 0.5, 0.4]} sensor />
      <group
        ref={meshRef}
        onClick={(e) => {
          e.stopPropagation();
          handleLoot();
        }}
      >
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
  const tombstones = useInventoryStore((state) => state.tombstones) || [];

  return (
    <group>
      {tombstones.map((tombstone) => (
        <TombstoneItem key={tombstone.id} tombstone={tombstone} />
      ))}
    </group>
  );
};
