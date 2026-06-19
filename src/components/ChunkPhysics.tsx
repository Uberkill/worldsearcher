import { memo } from 'react';
import { RigidBody, TrimeshCollider } from '@react-three/rapier';
import { useChunkStore } from '../stores/chunkSlice';

export const ChunkPhysics = memo(({ chunkKey }) => {
  const chunkData = useChunkStore((state) => state.chunks[chunkKey]);

  if (!chunkData || !chunkData.meshArrays) return null;
  const meshArrays = chunkData.meshArrays;

  const physicsDataArray = meshArrays['__physics'] || meshArrays['_physics'];
  if (!physicsDataArray || physicsDataArray.length === 0) return null;

  const [cx, cz] = chunkKey.split(',').map(Number);

  return (
    <group>
      <RigidBody
        type="fixed"
        colliders={false}
        userData={{ type: 'chunk', cx, cz }}
      >
        {physicsDataArray.map((physicsData, i) => (
          physicsData.pos && physicsData.pos.length > 0 && (
            <TrimeshCollider
              key={`${chunkData.physicsRebuildId || 0}-${i}`}
              args={[physicsData.pos, physicsData.idx]}
              collisionGroups={0x0001FFFF}
              userData={{ type: 'terrain' }}
            />
          )
        ))}
      </RigidBody>
    </group>
  );
});
