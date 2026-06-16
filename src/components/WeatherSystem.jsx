import { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useEnvironmentStore } from '../stores/environmentSlice';
import { useChunkStore } from '../stores/chunkSlice';
import { useStore } from '../stores/useStore';
import * as THREE from 'three';

const boxDims = new THREE.Vector3(128, 60, 128); // Size of the weather box
const dropCount = 15000; // Total instances active on the GPU

const vertexShader = `
uniform float uTime;
uniform vec3 uCameraWorldPos;
uniform vec3 uCameraVelocity;
uniform vec3 uBoxDimensions;
uniform sampler2D tDepth; // Now a cyclical 512x512 DataTexture
uniform float uFallSpeed;
uniform float uRainIntensity; // To fade in/out

varying vec2 vUv;
varying float vAlpha;

void main() {
    vUv = uv;

    // 1. Extract the unique baseline position of this rain particle from the instance matrix
    vec3 basePos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);

    // 2. Animate the particle downward over time
    basePos.y -= uTime * uFallSpeed;

    // 3. Compute position relative to the moving camera
    vec3 relativePos = basePos - uCameraWorldPos;

    // 4. Apply Modulo Wrapping to keep particles trapped inside the Weather Box
    // Adding half dimensions centers the box around the camera coordinate space
    vec3 wrappedPos = mod(relativePos + uBoxDimensions * 0.5, uBoxDimensions) - uBoxDimensions * 0.5;

    // 5. Reconstruct final world space coordinate for tracking and sampling
    vec3 worldPos = wrappedPos + uCameraWorldPos;

    // 6. Project local vertex coordinates (the thin quad shape) onto the wrapped position
    // Wind-shear simulation: Tilt the quad opposite to the camera's velocity
    vec3 localVertexPos = position;
    localVertexPos.x += localVertexPos.y * uCameraVelocity.x * 0.05;
    localVertexPos.z += localVertexPos.y * uCameraVelocity.z * 0.05;
    
    vec4 modelPosition = vec4(worldPos + localVertexPos, 1.0);

    // 7. Localized Voxel Heightmap Occlusion (Zero Render Pass)
    // Map absolute world X/Z to the 512x512 cyclical texture coordinates
    vec2 heightmapUV = mod(worldPos.xz, 512.0) / 512.0;

    // Read the raw Y height from the Float DataTexture
    float roofY = texture2D(tDepth, heightmapUV).r;

    // Default visibility multiplier based on global rain fade
    float visibility = uRainIntensity;

    // CRITICAL: If the particle's animated position falls below the structural roof line, 
    // collapse the geometry immediately to a single point. This kills fragment processing.
    if (worldPos.y <= roofY) {
        modelPosition = vec4(0.0, 0.0, 0.0, 1.0);
        visibility = 0.0;
    }
    
    // Also fade out particles near the top and bottom of the box to prevent popping
    float distY = abs(wrappedPos.y);
    float boxEdgeFade = smoothstep(uBoxDimensions.y * 0.5, uBoxDimensions.y * 0.4, distY);
    visibility *= boxEdgeFade;

    vAlpha = visibility;

    // Standard projection step
    vec4 viewPosition = viewMatrix * modelPosition;
    gl_Position = projectionMatrix * viewPosition;
}
`;

const fragmentShader = `
varying float vAlpha;
void main() {
    if (vAlpha < 0.05) discard;
    gl_FragColor = vec4(0.8, 0.8, 0.9, 0.5 * vAlpha);
}
`;

export function WeatherSystem() {
  const meshRef = useRef();
  const materialRef = useRef();
  const isRaining = useEnvironmentStore((state) => state.isRaining);
  const fadeIntensity = useRef(0);
  const lastCameraPos = useRef(new THREE.Vector3());
  const cameraVelocity = useRef(new THREE.Vector3());
  const chunkVersionCache = useRef({});

  const clearVisualMeshArrays = useStore(state => state.clearVisualMeshArrays);

  // Cyclical 512x512 DataTexture for O(1) WebGL heightmap lookups
  const [heightmapTex] = useState(() => {
    const arr = new Float32Array(512 * 512);
    arr.fill(-999);
    const tex = new THREE.DataTexture(arr, 512, 512, THREE.RedFormat, THREE.FloatType);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  });

  // Zero-Cost Heightmap Sync: Uploads WebWorker 2D arrays directly into the GPU texture
  useEffect(() => {
    const chunks = useChunkStore.getState().chunks;
    const arr = heightmapTex.image.data;
    let needsUpload = false;

    for (const key in chunks) {
      const chunk = chunks[key];
      if (!chunk || !chunk.meshArrays || !chunk.meshArrays.__meta || !chunk.meshArrays.__meta.heightmap) continue;

      // Only process chunks that have been newly loaded or explicitly rebuilt (block placed/broken)
      if (chunkVersionCache.current[key] === chunk.rebuildId) continue;
      chunkVersionCache.current[key] = chunk.rebuildId;

      const cx = chunk.cx;
      const cz = chunk.cz;
      const hMap = chunk.meshArrays.__meta.heightmap; // 16x16 Uint8Array

      for (let lx = 0; lx < 16; lx++) {
        for (let lz = 0; lz < 16; lz++) {
          const gx = (cx * 16 + lx) % 512;
          const gz = (cz * 16 + lz) % 512;
          const wx = gx < 0 ? gx + 512 : gx;
          const wz = gz < 0 ? gz + 512 : gz;

          // eslint-disable-next-line react-hooks/immutability
          arr[wz * 512 + wx] = hMap[lz * 16 + lx];
        }
      }
      needsUpload = true;
    }

    if (needsUpload) {
      // eslint-disable-next-line react-hooks/immutability
      heightmapTex.needsUpdate = true;
    }
  }, [clearVisualMeshArrays, heightmapTex]);

  // Create a static set of randomized distribution points inside the box volume at boot
  const transformMatrix = useMemo(() => {
    return (instMesh) => {
      if (!instMesh) return;
      const position = new THREE.Vector3();
      const dummy = new THREE.Object3D();
      for (let i = 0; i < dropCount; i++) {
        position.set(
          (Math.random() - 0.5) * boxDims.x,
          (Math.random() - 0.5) * boxDims.y,
          (Math.random() - 0.5) * boxDims.z
        );
        dummy.position.copy(position);
        dummy.rotation.y = Math.random() * Math.PI; // Randomly orient planes so they are visible from all angles
        dummy.updateMatrix();
        instMesh.setMatrixAt(i, dummy.matrix);
      }
      instMesh.instanceMatrix.needsUpdate = true;
    };
  }, []);

  // Geometry template for a single rain drop (thin stretched vertical line/quad)
  const rainGeometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(0.04, 1.2);
    // Offset pivot to top center for cleaner scaling cuts if needed
    geo.translate(0, -0.6, 0);
    return geo;
  }, []);

  useFrame((state, delta) => {
    const { clock, camera } = state;

    // Fade rain in and out over time
    const targetIntensity = isRaining ? 1.0 : 0.0;
    fadeIntensity.current = THREE.MathUtils.lerp(
      fadeIntensity.current,
      targetIntensity,
      delta * 0.5
    );

    // Only update uniforms when rain is visible
    if (!isRaining || fadeIntensity.current < 0.01 || !materialRef.current) return;

    // Calculate Camera Velocity for Shearing
    // FIX: Prevent divide by zero which creates NaNs and crashes the WebGL shader!
    const safeDelta = Math.max(delta, 0.001);
    cameraVelocity.current
      .subVectors(camera.position, lastCameraPos.current)
      .divideScalar(safeDelta);
    // Clamp to prevent teleportation or lag-spike massive shader glitches
    cameraVelocity.current.clampLength(0, 100);
    lastCameraPos.current.copy(camera.position);

    // Bundle uniform updates atomically
    const maxLoopTime = boxDims.y / 35.0; // boxDims.y / uFallSpeed
    materialRef.current.uniforms.uTime.value = clock.getElapsedTime() % maxLoopTime;
    materialRef.current.uniforms.uCameraWorldPos.value.copy(camera.position);
    materialRef.current.uniforms.uCameraVelocity.value.copy(cameraVelocity.current);
    materialRef.current.uniforms.uRainIntensity.value = fadeIntensity.current;
  });

  return (
    <instancedMesh
      ref={(el) => {
        meshRef.current = el;
        transformMatrix(el);
      }}
      args={[rainGeometry, null, dropCount]}
      frustumCulled={false} // Retain false so box doesn't clip out when player looks away from its center
    >
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={{
          uTime: { value: 0 },
          uCameraWorldPos: { value: new THREE.Vector3() },
          uCameraVelocity: { value: new THREE.Vector3() },
          uBoxDimensions: { value: boxDims },
          tDepth: { value: heightmapTex },
          uFallSpeed: { value: 35.0 },
          uRainIntensity: { value: 0.0 },
        }}
        transparent={true}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </instancedMesh>
  );
}

