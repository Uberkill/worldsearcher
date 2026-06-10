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

/* eslint-disable react-refresh/only-export-components */
import React, {
  useRef,
  useState,
  useLayoutEffect,
  useEffect,
} from 'react';
import { useFrame } from '@react-three/fiber';

// Stable module-level function — defined once, never reallocated per React render.
// Replaces inline arrow functions on every chunk mesh which caused GC pressure.
const onChunkBeforeRender = (_renderer, _scene, camera) => {
  if (window.__DEBUG_STATS__ && camera.type === 'PerspectiveCamera') {
    window.__DEBUG_STATS__.chunksRendered++;
  }
};
import * as THREE from 'three';
import { useStore } from '../stores/useStore';
import { useChunkStore } from '../stores/chunkSlice';
import { useEnvironmentStore } from '../stores/environmentSlice';
import { getTextureAtlas } from '../utils/TextureAtlas';
import { createChunkMaterial } from '../materials/ChunkMaterial';
import { ChunkFlora } from './ChunkFlora';

import { materialCache } from '../utils/ChunkMaterialCache';

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

function buildGeometriesFromArrays(meshArrays, _cx, _cz) {
  const result = {};

  for (const [name, data] of Object.entries(meshArrays)) {
    if (name === '__meta' || name === '__flora') continue;
    if (name === '__physics' || name === '_physics') {
      result[name] = { isRawArray: true, data };
      continue;
    }

    result[name] = [];
    if (!Array.isArray(data)) continue;

    for (const subChunk of data) {
      const { pos, norm, color, uv, idx } = subChunk;
      if (!pos || pos.length === 0) continue;

      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(norm, 3, false));
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
        console.error(
          `Chunk geometry error in ${name}! maxIdx: ${maxIdx}, pos.count: ${pos.length / 3}`
        );
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

      result[name].push({ geometry: g });
    }
  }
  return result;
}

// ── Chunk component ───────────────────────────────────────────────────────────

export const Chunk = React.memo(({ chunkKey }) => {
  const groupRef = useRef();
  const chunkData = useChunkStore((state) => state.chunks[chunkKey]);
  const clearVisualMeshArrays = useStore(
    (state) => state.clearVisualMeshArrays
  );
  const shadowsEnabled = useStore((state) => state.shadowQuality === 'visual');
  const [cx, cz] = chunkKey.split(',').map(Number);

  // Double‑buffered geometry handling – safe disposal without race conditions
  const [geometries, setGeometries] = useState({});

  useLayoutEffect(() => {
    // Build new BufferGeometries from the latest meshArrays (if any)
    if (
      !chunkData ||
      !chunkData.meshArrays ||
      Object.keys(chunkData.meshArrays).length === 0
    ) {
      setGeometries({});
      return;
    }

    const newGeos = buildGeometriesFromArrays(chunkData.meshArrays, cx, cz);

    // Track the currently active geometries for this render cycle
    setGeometries(newGeos);

    // Cleanup function runs when this chunk updates OR unmounts.
    // It must dispose the geometries CREATED IN THIS RUN (newGeos),
    // because React will have already rendered the next updated state.
    return () => {
      const buffersToRecycle = [];
      for (const [_name, obj] of Object.entries(newGeos)) {
        if (!obj) continue;

        if (obj.isRawArray) {
          if (obj.data && obj.data.buffer && obj.data.buffer.byteLength > 0) {
            buffersToRecycle.push(obj.data.buffer);
          } else if (Array.isArray(obj.data)) {
            for (const d of obj.data) {
              if (d && d.buffer && d.buffer.byteLength > 0) {
                buffersToRecycle.push(d.buffer);
              }
            }
          }
          continue;
        }

        for (const sub of obj) {
          const g = sub.geometry;
          if (!g || !g.attributes) continue;

          // Extract ArrayBuffers for recycling before throwing them away
          ['position', 'normal', 'color', 'uv', 'packedData'].forEach(attr => {
             if (g.attributes[attr] && g.attributes[attr].array && g.attributes[attr].array.buffer) {
                 if (g.attributes[attr].array.buffer.byteLength > 0) {
                     buffersToRecycle.push(g.attributes[attr].array.buffer);
                 }
             }
          });
          if (g.index && g.index.array && g.index.array.buffer) {
             if (g.index.array.buffer.byteLength > 0) {
                 buffersToRecycle.push(g.index.array.buffer);
             }
          }

          g.dispose();
        }
      }
      
      if (buffersToRecycle.length > 0) {
          useStore.getState().queueBuffersForRecycling(buffersToRecycle);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunkData?.meshArrays, chunkKey, clearVisualMeshArrays]);

  // Native culling is handled at the mesh level via frustumCulled={true}

  if (Object.keys(geometries).length === 0) {
    return null;
  }

  const arrayGroup = geometries['solid'] || geometries['transparent'];
  const g = arrayGroup && arrayGroup.length > 0 ? arrayGroup[0].geometry : null;
  const chunkBB = g?.boundingBox || null;

  const meshGroup = (
    <group ref={groupRef} name={`chunk-visuals-${chunkKey}`} boundingBox={chunkBB}>
      {geometries['solid'] && geometries['solid'].map((obj, i) => (
        <mesh
          key={`solid-${i}`}
          geometry={obj.geometry}
          material={getSolidMaterial()}
          castShadow={shadowsEnabled}
          receiveShadow={shadowsEnabled}
          frustumCulled={true}
          onBeforeRender={onChunkBeforeRender}
        />
      ))}
      {geometries['transparent'] && geometries['transparent'].map((obj, i) => (
        <mesh
          key={`transparent-${i}`}
          geometry={obj.geometry}
          material={getTransparentMaterial()}
          castShadow={false}
          receiveShadow={shadowsEnabled}
          frustumCulled={true}
          onBeforeRender={onChunkBeforeRender}
        />
      ))}
      {chunkData?.meshArrays?.__flora &&
        chunkData.meshArrays.__flora.packed?.length > 0 &&
        (() => {
          if (!window.__CHUNK_FLORA_RENDER_ATTEMPT__)
            window.__CHUNK_FLORA_RENDER_ATTEMPT__ = true;
          return (
            <ChunkFlora
              key="flora"
              floraData={chunkData.meshArrays.__flora}
              shadowsEnabled={shadowsEnabled}
              meta={chunkData.meshArrays.__meta}
            />
          );
        })()}
    </group>
  );

  return <group name={`chunk-${chunkKey}`}>{meshGroup}</group>;
});
