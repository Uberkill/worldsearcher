/**
 * Cubes.jsx - Physics Orchestrator
 *
 * Renders individual chunk meshes via React components to allow
 * Three.js to native Frustum Cull each chunk out of view.
 */

import { useStore } from '../stores/useStore';
import { useShallow } from 'zustand/react/shallow';
import { useFrame } from '@react-three/fiber';
import { DynamicCube } from './DynamicCube';
import { FallingStructure } from './FallingStructure';
import { ChunkPhysics } from './ChunkPhysics';
import { Chunk, materialCache } from './Chunk';
import * as THREE from 'three';
import React from 'react';

export const Cubes = () => {
  const activePhysicsChunks = useStore(state => state.activePhysicsChunks || []);
  const fallingStructures   = useStore(useShallow(state => state.fallingStructures || []));
  const debris              = useStore(useShallow(state => state.debris || []));
  
  // All active chunks are rendered through this array to ensure individual meshes.
  const overflowChunks      = useStore(useShallow(state => state.overflowChunks || []));

  useFrame((state) => {
    // Pop chunks off the Staggered Upload Queue
    const store = useStore.getState();
    const len = store.pendingMeshMounts?.length || 0;
    // Upload a max of 2 chunks per frame during initial load (len>10) to prevent VRAM timeout/TDR, then trickle 1/frame
    const batchSize = Math.min(len, len > 10 ? 2 : 1);
    if (batchSize > 0) {
      store.mountNextMesh(batchSize);
    }
    
    // Update material time uniforms for animated blocks (water, lava)
    const isDebugLighting = store.debugLighting;
    for (const mat of materialCache.values()) {
      if (mat && mat.userData.shader) {
        mat.userData.shader.uniforms.uTime = mat.userData.shader.uniforms.uTime || { value: 0 };
        mat.userData.shader.uniforms.uTime.value = state.clock.elapsedTime;
        
        if (mat.userData.shader.uniforms.uDebugLighting) {
           mat.userData.shader.uniforms.uDebugLighting.value = isDebugLighting ? 1 : 0;
        }
      }
    }
  });

  return (
    <>
      {/* Individual Chunks (Native Frustum Culling) */}
      {overflowChunks.map(chunkKey => (
         <Chunk key={`chunk-${chunkKey}`} chunkKey={chunkKey} />
      ))}

      {/* Entity-Aware Physics Grid: Renders ONLY invisible TrimeshColliders */}
      {activePhysicsChunks.map(chunkKey => (
        <ChunkPhysics key={`phys-${chunkKey}`} chunkKey={chunkKey} />
      ))}

      {fallingStructures.map(s => <FallingStructure key={s.id} structure={s} />)}
      {debris.map(d => <DynamicCube key={d.key} block={d} />)}
    </>
  );
};
