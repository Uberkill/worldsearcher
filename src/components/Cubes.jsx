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
import { ChunkRenderer } from './ChunkRenderer';
import { materialCache, initMaterials } from '../utils/ChunkMaterialCache';
import * as THREE from 'three';
import { playerPosition } from '../globals';

initMaterials();


export const Cubes = memo(() => {
  const activePhysicsChunks = useChunkStore(
    (state) => state.activePhysicsChunks || []
  );
  const fallingStructures = useInventoryStore(
    useShallow((state) => state.fallingStructures || [])
  );
  const debris = useInventoryStore(useShallow((state) => state.debris || []));

  useFrame((state) => {
    // Pop chunks off the Staggered Upload Queue
    const store = useStore.getState();
    const chunkStore = useChunkStore.getState();
    const len = chunkStore.pendingMeshMounts?.length || 0;
    // Upload a max of 2 chunks per frame during initial load (len>10) to prevent VRAM timeout/TDR, then trickle 1/frame
    const batchSize = Math.min(len, len > 10 ? 2 : 1);
    if (batchSize > 0) {
      store.mountNextMesh(batchSize);
    }



    // Update material time uniforms for animated blocks (water, lava)
    const isDebugLighting = store.debugLighting;
    const isHoldingLight = store.texture === 'torch' || store.texture === 'flashlight';
    
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
        
        // Update Dynamic Hand-Held Lighting
        if (mat.userData.shader.uniforms.uDynamicLightPos) {
           if (isHoldingLight) {
              mat.userData.shader.uniforms.uDynamicLightPos.value.copy(playerPosition);
              mat.userData.shader.uniforms.uDynamicLightIntensity.value = 1.0;
           } else {
              mat.userData.shader.uniforms.uDynamicLightIntensity.value = 0.0;
           }
        }
      }
    }
  });

  return (
    <>
      {/* Native Render Pipeline (bypasses React reconciliation) */}
      <ChunkRenderer />

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
