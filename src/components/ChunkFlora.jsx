/* eslint-disable react-hooks/immutability */
import { useRef, useLayoutEffect, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { materialCache } from '../utils/ChunkMaterialCache';

const geometry = new THREE.BufferGeometry();
// X shape: Two planes, crossing in the middle
// Vertices are at bottom-left (-0.5, 0) and top-right (0.5, 1) relative to center
const pos = new Float32Array([
  // Plane 1: bottom-left to top-right
  -0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 1, -0.5, 0.5, 1, 0.5,
  // Plane 2: bottom-right to top-left
  0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 1, -0.5, -0.5, 1, 0.5,
]);

const idx = new Uint16Array([
  0,
  1,
  2,
  2,
  1,
  3,
  1,
  0,
  2,
  1,
  2,
  3, // double sided
  4,
  5,
  6,
  6,
  5,
  7,
  5,
  4,
  6,
  5,
  6,
  7, // double sided
]);

const uv = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 1, 1, 1]);

// Normal is straight up for lighting
const norm = new Float32Array([
  0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
]);

geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
geometry.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
geometry.setIndex(new THREE.BufferAttribute(idx, 1));

export const ChunkFlora = ({ floraData, shadowsEnabled, meta }) => {
  const count = floraData.packed.length;
  const meshRef = useRef();

  // Debug tracker
  if (count > 0 && !window.__FIRST_FLORA_COORD__) {
    window.__FIRST_FLORA_COORD__ = `first flora registered`;
  }

  const localGeometry = useMemo(() => {
    if (count === 0) return null;
    const geom = geometry.clone();
    geom.setAttribute(
      'packedData',
      new THREE.InstancedBufferAttribute(new Float32Array(count), 1)
    );
    return geom;
  }, [count]);

  useEffect(() => {
    return () => {
      if (localGeometry) localGeometry.dispose();
    };
  }, [localGeometry]);

  useLayoutEffect(() => {
    if (!meshRef.current || !localGeometry) return;
    const mesh = meshRef.current;

    // 100x CPU OPTIMIZATION: Worker pre-computes matrices and packedData!
    // We just do a zero-copy fast Array.set() directly into WebGL memory buffers!
    const attr = localGeometry.attributes.packedData;
    if (floraData.packed.length !== attr.array.length) return; // Wait for useEffect to recreate the buffer

    attr.array.set(floraData.packed);
    attr.needsUpdate = true;

    mesh.instanceMatrix.array.set(floraData.matrices);
    mesh.instanceMatrix.needsUpdate = true;

    mesh.computeBoundingSphere(); // FIX: Explicitly compute sphere to enable Frustum Culling
    
    // We rely on the base geometry's local bounding sphere + instanceMatrix
    // InstancedMesh handles this properly, BUT requires explicit computeBoundingSphere() after injecting data!
  }, [floraData, localGeometry, meta]);

  if (!localGeometry) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[localGeometry, materialCache.get('transparent'), count]}
      castShadow={shadowsEnabled}
      receiveShadow={shadowsEnabled}
      frustumCulled={true}
    />
  );
};
