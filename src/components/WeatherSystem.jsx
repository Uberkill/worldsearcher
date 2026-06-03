import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { heightmapManager } from '../utils/HeightmapManager';
import { useStore } from '../stores/useStore';

const boxDims = new THREE.Vector3(40, 30, 40); // Size of the weather box
const dropCount = 4000; // Total instances active on the GPU

const vertexShader = `
uniform float uTime;
uniform vec3 uCameraWorldPos;
uniform vec3 uCameraVelocity;
uniform vec3 uBoxDimensions;
uniform sampler2D uHeightmap;
uniform vec4 uHeightmapBounds; // vec4(minX, minZ, width, depth)
uniform float uMaxWorldHeight;
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

    // 7. Localized Voxel Heightmap Occlusion
    // Translate world X/Z to 0.0 - 1.0 UV texture space coordinates
    vec2 heightmapUV = (worldPos.xz - uHeightmapBounds.xy) / uHeightmapBounds.zw;

    // Sample the single-channel Red texture mapping the world's surface
    // Convert normalized 0.0-1.0 to world Y (0 to 256)
    float roofY = texture2D(uHeightmap, heightmapUV).r * uMaxWorldHeight;

    // Default visibility multiplier based on global rain fade
    float visibility = uRainIntensity;

    // CRITICAL: If the particle's animated position falls below the structural roof line, 
    // collapse the geometry immediately to a single point. This kills fragment processing.
    if (worldPos.y < roofY) {
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
  const isRaining = useStore(state => state.isRaining);
  const fadeIntensity = useRef(0);
  const lastCameraPos = useRef(new THREE.Vector3());
  const cameraVelocity = useRef(new THREE.Vector3());

  // Create a static set of randomized distribution points inside the box volume at boot
  const transformMatrix = useMemo(() => {
    const position = new THREE.Vector3();
    const dummy = new THREE.Object3D();

    return (instMesh) => {
      if (!instMesh) return;
      for (let i = 0; i < dropCount; i++) {
        position.set(
          (Math.random() - 0.5) * boxDims.x,
          (Math.random() - 0.5) * boxDims.y,
          (Math.random() - 0.5) * boxDims.z
        );
        dummy.position.copy(position);
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
    fadeIntensity.current = THREE.MathUtils.lerp(fadeIntensity.current, targetIntensity, delta * 0.5);

    // If completely invisible and not raining, skip heavy updates
    if (fadeIntensity.current < 0.01 && !isRaining) return;

    // Update heightmap from chunks synchronously!
    const { playerPos, chunks } = useStore.getState();
    heightmapManager.update(playerPos, chunks);

    if (!materialRef.current) return;
    
    // Calculate Camera Velocity for Shearing
    cameraVelocity.current.subVectors(camera.position, lastCameraPos.current).divideScalar(delta);
    lastCameraPos.current.copy(camera.position);

    // Bundle uniform updates atomically
    const maxLoopTime = boxDims.y / 35.0; // boxDims.y / uFallSpeed
    materialRef.current.uniforms.uTime.value = clock.getElapsedTime() % maxLoopTime;
    materialRef.current.uniforms.uCameraWorldPos.value.copy(camera.position);
    materialRef.current.uniforms.uCameraVelocity.value.copy(cameraVelocity.current);
    materialRef.current.uniforms.uRainIntensity.value = fadeIntensity.current;
    materialRef.current.uniforms.uHeightmapBounds.value.copy(heightmapManager.bounds); // Ensure bounds perfectly sync
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
          uHeightmap: { value: heightmapManager.texture },
          uHeightmapBounds: { value: heightmapManager.bounds }, // [minX, minZ, width, depth]
          uMaxWorldHeight: { value: 256.0 },
          uFallSpeed: { value: 35.0 },
          uRainIntensity: { value: 0.0 }
        }}
        transparent={true}
        depthWrite={false}
      />
    </instancedMesh>
  );
}
