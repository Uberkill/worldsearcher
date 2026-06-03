import React, { memo } from 'react';
import { TrimeshCollider, RigidBody } from '@react-three/rapier';
import { useStore } from '../stores/useStore';

export const ChunkPhysics = memo(({ chunkKey }) => {
  const chunkData = useStore(state => state.chunks[chunkKey]);
  
  if (!chunkData || !chunkData.meshArrays) return null;
  const meshArrays = chunkData.meshArrays;
  
  const physicsData = meshArrays['__physics'] || meshArrays['_physics'];
  if (!physicsData || !physicsData.pos || physicsData.pos.length === 0) return null;
  
  const [cx, cz] = chunkKey.split(',').map(Number);
  
  return (
    <group>
      <RigidBody 
        type="fixed" 
        colliders={false} 
        userData={{ type: 'chunk', cx, cz }}
      >
        <TrimeshCollider 
          key={chunkData.physicsRebuildId || 0}
          args={[physicsData.pos, physicsData.idx]} 
          userData={{ type: 'terrain' }}
        />
      </RigidBody>
    </group>
  );
});
