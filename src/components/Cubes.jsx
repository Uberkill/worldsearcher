/**
 * Cubes.jsx - Physics Orchestrator
 *
 * Renders individual chunk meshes via React components to allow
 * Three.js to native Frustum Cull each chunk out of view.
 */

import { memo } from 'react';
import { useStore } from '../stores/useStore';
import { useChunkStore } from '../stores/chunkSlice';
import { useInventoryStore } from '../stores/inventorySlice';
import { useShallow } from 'zustand/react/shallow';
import { useFrame } from '@react-three/fiber';
import { DynamicCube } from './DynamicCube';
import { FallingStructure } from './FallingStructure';
import { ChunkPhysics } from './ChunkPhysics';
import { Chunk } from './Chunk';
import { materialCache } from '../utils/ChunkMaterialCache';
import * as THREE from 'three';


const projScreenMatrix = new THREE.Matrix4();

export const Cubes = memo(() => {
  const activePhysicsChunks = useChunkStore(
    (state) => state.activePhysicsChunks || []
  );
  const fallingStructures = useInventoryStore(
    useShallow((state) => state.fallingStructures || [])
  );
  const debris = useInventoryStore(useShallow((state) => state.debris || []));

  // All active chunks are rendered through this array to ensure individual meshes.
  const overflowChunks = useChunkStore(
    useShallow((state) => state.overflowChunks || [])
  );
  const shadowsEnabled = useStore((state) => state.shadowQuality === 'visual');

  useFrame((state) => {
    // Pop chunks off the Staggered Upload Queue
    const store = useStore.getState();
    const chunkStore = useChunkStore.getState();
    const len = chunkStore.pendingMeshMounts?.length || 0;
    // Upload chunks to the GPU in batches sized by how many are waiting.
    // Higher limits = faster pop-in but slightly more frame stutter on slow machines.
    // Raised from 5→12 peak and 2→4 normal to reduce the visual "one at a time" effect.
    let batchSize = 1;
    if (len > 100) batchSize = 12;
    else if (len > 30) batchSize = 6;
    else if (len > 10) batchSize = 4;
    else if (len > 3) batchSize = 2;
    batchSize = Math.min(len, batchSize);

    if (batchSize > 0) {
      store.mountNextMesh(batchSize);
    }



    // Update material time uniforms for animated blocks (water, lava)
    const isDebugLighting = store.debugLighting;
    for (const mat of materialCache.values()) {
      if (mat && mat.userData.shader) {
        mat.userData.shader.uniforms.uTime = mat.userData.shader.uniforms
          .uTime || { value: 0 };
        mat.userData.shader.uniforms.uTime.value = state.clock.elapsedTime;

        if (mat.userData.shader.uniforms.uDebugLighting) {
          mat.userData.shader.uniforms.uDebugLighting.value = isDebugLighting
            ? 1
            : 0;
        }
      }
    }
  });

  return (
    <>
      {/* Individual Chunks (Native Frustum Culling) */}
      {overflowChunks.map((chunkKey) => (
        <Chunk
          key={`chunk-${chunkKey}`}
          chunkKey={chunkKey}
          shadowsEnabled={shadowsEnabled}
        />
      ))}

      {/* Entity-Aware Physics Grid: Renders ONLY invisible TrimeshColliders */}
      {activePhysicsChunks.map((chunkKey) => (
        <ChunkPhysics key={`phys-${chunkKey}`} chunkKey={chunkKey} />
      ))}

      {fallingStructures.map((s) => (
        <FallingStructure key={s.id} structure={s} />
      ))}
      {debris.map((d) => (
        <DynamicCube key={d.key} block={d} />
      ))}
    </>
  );
});
