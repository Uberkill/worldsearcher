import { useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { useChunkStore } from '../stores/chunkSlice';
import { useStore } from '../stores/useStore';
import * as THREE from 'three';
import { materialCache } from '../utils/ChunkMaterialCache';

const floraBaseGeometry = new THREE.BufferGeometry();
const floraPos = new Float32Array([
  -0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 1, -0.5, 0.5, 1, 0.5,
  0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 1, -0.5, -0.5, 1, 0.5,
]);
const floraIdx = new Uint16Array([
  0, 1, 2, 2, 1, 3, 1, 0, 2, 1, 2, 3,
  4, 5, 6, 6, 5, 7, 5, 4, 6, 5, 6, 7,
]);
const floraUv = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 1, 1, 1]);
const floraNorm = new Float32Array([
  0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
]);
floraBaseGeometry.setAttribute('position', new THREE.BufferAttribute(floraPos, 3));
floraBaseGeometry.setAttribute('normal', new THREE.BufferAttribute(floraNorm, 3));
floraBaseGeometry.setAttribute('uv', new THREE.BufferAttribute(floraUv, 2));
floraBaseGeometry.setIndex(new THREE.BufferAttribute(floraIdx, 1));

const buildGeometryNatively = (meshArrays, chunkKey, shadowsEnabled) => {
  const group = new THREE.Group();
  group.name = `chunk-visuals-${chunkKey}`;
  
  const meta = meshArrays['__meta'];
  if (meta && meta.boundingBox && meta.boundingBox.min[0] !== Infinity && !Number.isNaN(meta.boundingBox.min[0])) {
    const { min, max } = meta.boundingBox;
    group.userData.boundingBox = new THREE.Box3(
      new THREE.Vector3(min[0], min[1], min[2]),
      new THREE.Vector3(max[0] + 1, max[1] + 1, max[2] + 1)
    );
  }

  const disposeQueue = [];
  const instMeshQueue = [];

  for (const [name, data] of Object.entries(meshArrays)) {
    if (name === '__meta' || name === '__flora' || name === '__physics' || name === '_physics') continue;
    if (!Array.isArray(data)) continue;

    const isTransparent = name === 'transparent';
    const mat = materialCache.get(isTransparent ? 'transparent' : 'solid');

    for (const subChunk of data) {
      const { pos, norm, color, uv, idx } = subChunk;
      if (!pos || pos.length === 0) continue;

      let maxIdx = 0;
      for (let i = 0; i < idx.length; i++) {
        if (idx[i] > maxIdx) maxIdx = idx[i];
      }
      if (maxIdx >= pos.length / 3) {
        console.error(`Chunk geometry error in ${name}! maxIdx: ${maxIdx}, pos.count: ${pos.length / 3}. Skipping.`);
        continue;
      }

      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(norm, 3, false));
      if (color && color.length > 0) g.setAttribute('packedData', new THREE.BufferAttribute(color, 1));
      if (uv && uv.length > 0) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(new THREE.Uint32BufferAttribute(idx, 1));
      
      if (group.userData.boundingBox) {
          g.boundingBox = group.userData.boundingBox.clone();
          g.boundingSphere = new THREE.Sphere();
          g.boundingBox.getBoundingSphere(g.boundingSphere);
      } else {
          g.computeBoundingSphere();
      }

      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = !isTransparent && shadowsEnabled;
      mesh.receiveShadow = shadowsEnabled;
      mesh.frustumCulled = true;
      mesh.onBeforeRender = (_renderer, _scene, camera) => {
        if (window.__DEBUG_STATS__ && camera.type === 'PerspectiveCamera') {
          window.__DEBUG_STATS__.chunksRendered++;
        }
      };
      group.add(mesh);
      disposeQueue.push(g);
    }
  }

  // Flora
  if (meshArrays.__flora && meshArrays.__flora.packed && meshArrays.__flora.packed.length > 0) {
    const floraData = meshArrays.__flora;
    const count = floraData.packed.length;
    const geom = floraBaseGeometry.clone();
    geom.setAttribute('packedData', new THREE.InstancedBufferAttribute(floraData.packed, 1));
    
    const mat = materialCache.get('flora');
    const instMesh = new THREE.InstancedMesh(geom, mat, count);
    instMesh.instanceMatrix.array.set(floraData.matrices);
    instMesh.instanceMatrix.needsUpdate = true;
    instMesh.computeBoundingSphere();
    instMesh.castShadow = shadowsEnabled;
    instMesh.receiveShadow = shadowsEnabled;
    instMesh.frustumCulled = true;
    
    group.add(instMesh);
    disposeQueue.push(geom);
    instMeshQueue.push(instMesh);
  }

  group.userData.disposeGeometries = () => {
    disposeQueue.forEach(g => g.dispose());
    instMeshQueue.forEach(m => m.dispose());

    const buffersToRecycle = [];
    for (const [name, data] of Object.entries(meshArrays)) {
      if (name === '__meta' || name === '__physics' || name === '_physics') continue;
      
      if (name === '__flora') {
         if (data.packed && data.packed.buffer.byteLength > 0) buffersToRecycle.push(data.packed.buffer);
         if (data.matrices && data.matrices.buffer.byteLength > 0) buffersToRecycle.push(data.matrices.buffer);
         continue;
      }
      
      if (!Array.isArray(data)) continue;
      
      for (const subChunk of data) {
         if (subChunk.pos && subChunk.pos.buffer.byteLength > 0) buffersToRecycle.push(subChunk.pos.buffer);
         if (subChunk.norm && subChunk.norm.buffer.byteLength > 0) buffersToRecycle.push(subChunk.norm.buffer);
         if (subChunk.color && subChunk.color.buffer.byteLength > 0) buffersToRecycle.push(subChunk.color.buffer);
         if (subChunk.uv && subChunk.uv.buffer.byteLength > 0) buffersToRecycle.push(subChunk.uv.buffer);
         if (subChunk.idx && subChunk.idx.buffer.byteLength > 0) buffersToRecycle.push(subChunk.idx.buffer);
      }
    }
    
    if (buffersToRecycle.length > 0) {
        useStore.getState().queueBuffersForRecycling(buffersToRecycle);
    }
  };

  return group;
};

export const ChunkRenderer = () => {
  useThree();
  const activeMeshes = useRef(new Map());
  const rootRef = useRef();
  
  // Zero-allocation cache for overflow chunks
  const overflowSetRef = useRef(new Set());
  const lastOverflowRef = useRef(null);

  useFrame(() => {
    const store = useChunkStore.getState();
    const useStoreState = useStore.getState();
    const shadowsEnabled = useStoreState.shadowQuality === 'visual';

    const overflow = store.overflowChunks;

    // Update the Set only when the overflow array reference changes
    if (overflow !== lastOverflowRef.current) {
      overflowSetRef.current.clear();
      for (let i = 0; i < overflow.length; i++) {
        overflowSetRef.current.add(overflow[i]);
      }
      lastOverflowRef.current = overflow;
    }

    // 1. Unmount chunks no longer in overflowChunks
    for (const [key, group] of activeMeshes.current.entries()) {
      if (!overflowSetRef.current.has(key) || useStoreState.clearVisualMeshArrays > (group.userData.clearVersion || 0)) {
        if (rootRef.current) rootRef.current.remove(group);
        if (group.userData.disposeGeometries) group.userData.disposeGeometries();
        activeMeshes.current.delete(key);
      }
    }

    // 2. Mount new or updated chunks (staggered creation)
    let builtThisFrame = 0;
    const MAX_BUILDS_PER_FRAME = 2; // Keep at 2 to minimize framerate drops during load

    for (const key of overflow) {
      const chunkData = store.chunks[key];
      if (!chunkData || !chunkData.meshArrays) continue;

      const existingGroup = activeMeshes.current.get(key);

      // Diff check: if the meshArrays object reference changed, we must rebuild
      if (!existingGroup || existingGroup.userData.meshArrays !== chunkData.meshArrays) {
        if (builtThisFrame >= MAX_BUILDS_PER_FRAME) continue;
        builtThisFrame++;

        if (existingGroup) {
          if (rootRef.current) rootRef.current.remove(existingGroup);
          if (existingGroup.userData.disposeGeometries) existingGroup.userData.disposeGeometries();
        }

        const newGroup = buildGeometryNatively(chunkData.meshArrays, key, shadowsEnabled);
        newGroup.userData.meshArrays = chunkData.meshArrays;
        newGroup.userData.clearVersion = useStoreState.clearVisualMeshArrays;
        
        if (rootRef.current) rootRef.current.add(newGroup);
        activeMeshes.current.set(key, newGroup);
      }
    }
    if (window.__DEBUG_STATS__) {
      window.__DEBUG_STATS__.totalVisualMeshes = activeMeshes.current.size;
    }
  });

  return <group ref={rootRef} name="chunk-renderer-root" />;
};
