/**
 * Chunk.jsx — Visual rendering via greedy-meshed BufferGeometry.
 *
 * PERFORMANCE ARCHITECTURE:
 *
 *  FAST PATH ONLY:
 *    The main thread NEVER computes greedy meshes anymore.
 *    If a chunk is modified (e.g., block placed/broken), the Zustand store
 *    retains the old mesh arrays and fires a background worker task.
 *    This component simply renders whatever `meshArrays` it is given, keeping
 *    the main thread at a perfect 60fps even during massive explosions.
 *
 * GEOMETRY DISPOSAL:
 *    Three.js BufferGeometry objects are GPU resources (VAO + VBO).
 *    We dispose them when meshArrays change and on component unmount.
 *
 * INTERACTION:
 *    This component has NO onClick / onPointerMove handlers.
 *    Block picking is handled by BlockInteraction.jsx using the Amanatides-Woo
 *    DDA algorithm against the raw CPU block grid — not these mesh triangles.
 */

import { useRef, useState, useLayoutEffect, useEffect, useMemo, memo } from 'react';
import * as THREE from 'three';
import { useStore } from '../stores/useStore';
import { BlockRegistry, BlockById, BlockKeyById } from '../registry/BlockRegistry';
import { getTextureId, getIsHidden, CHUNK_Y_MIN } from '../utils/chunkData';

import { getTextureAtlas } from '../utils/TextureAtlas';
import { createChunkMaterial } from '../materials/ChunkMaterial';
import { ChunkFlora } from './ChunkFlora';

export const materialCache = new Map();

let solidMaterial = null;
let transparentMaterial = null;

const getSolidMaterial = () => {
  if (!solidMaterial) {
    solidMaterial = createChunkMaterial(getTextureAtlas(), false);
    materialCache.set('solid', solidMaterial);
  }
  return solidMaterial;
};

const getTransparentMaterial = () => {
  if (!transparentMaterial) {
    transparentMaterial = createChunkMaterial(getTextureAtlas(), true);
    materialCache.set('transparent', transparentMaterial);
  }
  return transparentMaterial;
};

// We expose them in materialCache so Cubes.jsx can still animate uTime
materialCache.set('solid', getSolidMaterial());
materialCache.set('transparent', getTransparentMaterial());

// ── Build BufferGeometry objects from pre-computed typed arrays ──────────────────
// This is the FAST PATH — pure Three.js object creation, no geometry computation.

function buildGeometriesFromArrays(meshArrays, cx, cz) {
  const result = {};

  for (const [name, data] of Object.entries(meshArrays)) {
    if (name === '__meta' || name === '__flora') continue;
    if (name === '__physics' || name === '_physics') {
      result[name] = { isRawArray: true, data };
      continue;
    }
    
    const { pos, norm, color, uv, idx } = data;
    if (!pos || pos.length === 0) continue;
    
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal',   new THREE.BufferAttribute(norm, 3, false));
    if (color && color.length > 0) {
      g.setAttribute('packedData', new THREE.BufferAttribute(color, 1));
    }
    if (uv && uv.length > 0) {
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    g.setIndex(new THREE.Uint32BufferAttribute(idx, 1));
    
    // Debug logging for GL_INVALID_OPERATION
    let maxIdx = 0;
    for (let i = 0; i < idx.length; i++) {
        if (idx[i] > maxIdx) maxIdx = idx[i];
    }
    if (maxIdx >= pos.length / 3) {
        console.error(`Chunk geometry error in ${name}! maxIdx: ${maxIdx}, pos.count: ${pos.length / 3}`);
    }

    
    const meta = meshArrays['__meta'];
    if (meta && meta.boundingBox && meta.boundingBox.min[0] !== Infinity) {
      const { min, max } = meta.boundingBox;
      g.boundingBox = new THREE.Box3(
        new THREE.Vector3(min[0], min[1], min[2]),
        new THREE.Vector3(max[0] + 1, max[1] + 1, max[2] + 1) // +1 to cover the full block width
      );
      g.boundingSphere = new THREE.Sphere();
      g.boundingBox.getBoundingSphere(g.boundingSphere);
    } else {
      g.computeBoundingSphere(); // Fallback if no meta
    }

    result[name] = { geometry: g };
  }
  return result;
}

// ── Chunk component ───────────────────────────────────────────────────────────

export const Chunk = memo(({ chunkKey, shadowsEnabled }) => {
  const chunkData = useStore(state => state.chunks[chunkKey]);
  const clearVisualMeshArrays = useStore(state => state.clearVisualMeshArrays);
  const [cx, cz] = chunkKey.split(',').map(Number);




  // Double‑buffered geometry handling – safe disposal without race conditions
  const [geometries, setGeometries] = useState({});
  // Holds the previous geometry set for disposal after the layout commit
  const prevGeosRef = useRef({});

  useLayoutEffect(() => {
    // Build new BufferGeometries from the latest meshArrays (if any)
    if (!chunkData || !chunkData.meshArrays || Object.keys(chunkData.meshArrays).length === 0) return;
    
    const newGeos = buildGeometriesFromArrays(chunkData.meshArrays, cx, cz);
    
    // Track the currently active geometries for this render cycle
    setGeometries(newGeos);
    prevGeosRef.current = newGeos;
    
    // Cleanup function runs when this chunk updates OR unmounts.
    // It must dispose the geometries CREATED IN THIS RUN (newGeos),
    // because React will have already rendered the next updated state.
    return () => {
      for (const [name, obj] of Object.entries(newGeos)) {
        if (!obj) continue;
        
        if (obj.isRawArray) continue;
        
        const g = obj.geometry;
        if (!g || !g.attributes) continue;
        
        g.dispose();
      }
    };
  }, [chunkData?.meshArrays, chunkKey, clearVisualMeshArrays]);

  // Ensure any remaining geometries are disposed when the component finally unmounts
  useEffect(() => () => {
     for (const [name, obj] of Object.entries(prevGeosRef.current)) {
       if (!obj) continue;
       
       if (obj.isRawArray) continue;
       
       const g = obj.geometry || obj;
       
       // Dispose FIRST, so Three.js can iterate attributes and delete WebGL buffers!
       g.dispose();
       
       // Nullify to prevent React Strict Mode from trying to recycle detached buffers again
       if (g.attributes) {
           g.attributes.position = null;
           g.attributes.normal = null;
           g.attributes.color = null;
           g.attributes.uv = null;
       }
       g.index = null;
    }
  }, []);

  if (Object.keys(geometries).length === 0) {
    return null;
  }

  const meshGroup = (
    <group name={`chunk-visuals-${chunkKey}`} >
      {geometries['solid'] && (
        <mesh 
          key="solid"
          geometry={geometries['solid'].geometry}
          material={getSolidMaterial()}
          castShadow={shadowsEnabled}
          receiveShadow={shadowsEnabled}
          onBeforeRender={() => { if (window.__DEBUG_STATS__) window.__DEBUG_STATS__.chunksRendered++; }}
        />
      )}
      {geometries['transparent'] && (
        <mesh
          key="transparent"
          geometry={geometries['transparent'].geometry}
          material={getTransparentMaterial()}
          castShadow={shadowsEnabled}
          receiveShadow={shadowsEnabled}
          onBeforeRender={() => { if (window.__DEBUG_STATS__) window.__DEBUG_STATS__.chunksRendered++; }}
        />
      )}
      {chunkData?.meshArrays?.__flora && chunkData.meshArrays.__flora.length > 0 && (
         <ChunkFlora 
             key="flora" 
             floraData={chunkData.meshArrays.__flora} 
             shadowsEnabled={shadowsEnabled} 
             meta={chunkData.meshArrays.__meta}
         />
      )}
    </group>
  );

  return (
    <group name={`chunk-${chunkKey}`}>
        {meshGroup}
    </group>
  );
});
