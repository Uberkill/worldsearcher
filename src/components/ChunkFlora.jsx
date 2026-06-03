import React, { useRef, useLayoutEffect } from 'react';
import * as THREE from 'three';
import { materialCache } from './Chunk';
import { FaceMappings } from '../registry/BlockRegistry';

const geometry = new THREE.BufferGeometry();
// X shape: Two planes, crossing in the middle
// Vertices are at bottom-left (-0.5, 0) and top-right (0.5, 1) relative to center
const pos = new Float32Array([
  // Plane 1: bottom-left to top-right
  -0.5, 0, -0.5,
   0.5, 0,  0.5,
  -0.5, 1, -0.5,
   0.5, 1,  0.5,
  // Plane 2: bottom-right to top-left
   0.5, 0, -0.5,
  -0.5, 0,  0.5,
   0.5, 1, -0.5,
  -0.5, 1,  0.5,
]);

const idx = new Uint16Array([
  0, 1, 2,  2, 1, 3,
  1, 0, 2,  1, 2, 3, // double sided
  4, 5, 6,  6, 5, 7,
  5, 4, 6,  5, 6, 7  // double sided
]);

const uv = new Float32Array([
  0, 0,  1, 0,  0, 1,  1, 1,
  0, 0,  1, 0,  0, 1,  1, 1,
]);

// Normal is straight up for lighting
const norm = new Float32Array([
  0, 1, 0,  0, 1, 0,  0, 1, 0,  0, 1, 0,
  0, 1, 0,  0, 1, 0,  0, 1, 0,  0, 1, 0,
]);

geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
geometry.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
geometry.setIndex(new THREE.BufferAttribute(idx, 1));

export const ChunkFlora = ({ floraData, shadowsEnabled, meta }) => {
   const count = floraData.length / 6;
   const meshRef = useRef();

   // Clone the geometry so each chunk has its own InstancedBufferAttributes!
   // If we share the global geometry, different chunks will overwrite each other's packedData causing severe visual bugs.
   const localGeometry = useMemo(() => geometry.clone(), []);

   // Clean up the geometry from VRAM when the chunk unmounts
   React.useEffect(() => {
     return () => {
       localGeometry.dispose();
     };
   }, [localGeometry]);

   useLayoutEffect(() => {
     if (!meshRef.current) return;
     const mesh = meshRef.current;
     
     const packedData = new Float32Array(count);
     const dummy = new THREE.Object3D();

     for (let i = 0; i < count; i++) {
        const idx = i * 6;
        const x = floraData[idx];
        const y = floraData[idx+1];
        const z = floraData[idx+2];
        const blockId = floraData[idx+3];
        const sun = floraData[idx+4];
        const blk = floraData[idx+5];

        dummy.position.set(x + 0.5, y, z + 0.5); 
        
        // Pseudo-random offset and rotation for organic feel
        const hash = Math.abs(Math.sin(x * 12.9898 + z * 78.233)) * 43758.5453;
        const rng = hash - Math.floor(hash);
        
        dummy.rotation.y = rng * Math.PI;
        dummy.position.x += (rng - 0.5) * 0.5;
        dummy.position.z += ((rng * 1.5 % 1) - 0.5) * 0.5;
        
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);

        // Pack data
        // Format: [isAnimated 1 bit][texId 8 bits][sun 4 bits][blk 4 bits][ao 2 bits]
        let texId = blockId;
        if (FaceMappings[blockId]) texId = FaceMappings[blockId].top;

        const ao = 3; // full AO for flora
        const isAnimated = 0;
        const pd = ((isAnimated ? 1 : 0) << 18) | (texId << 10) | (ao << 8) | (blk << 4) | sun;
        packedData[i] = pd;
     }

     // If the attribute already exists (re-render), dispose the old WebGL buffer before replacing!
     if (localGeometry.attributes.packedData) {
         // In Three.js, you generally can't easily "dispose" a single attribute buffer natively
         // without disposing the whole geometry, but we can overwrite its array if count matches.
         // However, since floraData changes length on block edits, we recreate it:
         localGeometry.deleteAttribute('packedData'); 
     }

     localGeometry.setAttribute('packedData', new THREE.InstancedBufferAttribute(packedData, 1));
     mesh.instanceMatrix.needsUpdate = true;

     // Optimize: Enable frustum culling by dynamically copying the exact bounding box of the chunk
     if (meta && meta.boundingBox && meta.boundingBox.min[0] !== Infinity) {
       const { min, max } = meta.boundingBox;
       localGeometry.boundingBox = new THREE.Box3(
         new THREE.Vector3(min[0], min[1], min[2]),
         new THREE.Vector3(max[0] + 1, max[1] + 1, max[2] + 1)
       );
       localGeometry.boundingSphere = new THREE.Sphere();
       localGeometry.boundingBox.getBoundingSphere(localGeometry.boundingSphere);
     } else {
       localGeometry.computeBoundingSphere();
     }

   }, [floraData, localGeometry, meta]);

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
