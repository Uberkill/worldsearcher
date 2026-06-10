import { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useEnvironmentStore } from '../stores/environmentSlice';
import * as THREE from 'three';
import { useStore } from '../stores/useStore';


const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
const boxDims = new THREE.Vector3(128, 60, 128); // Size of the weather box (Expanded from 40x30x40)
const dropCount = 15000; // Total instances active on the GPU (Reduced to save performance)

const vertexShader = `
#include <packing>

uniform float uTime;
uniform vec3 uCameraWorldPos;
uniform vec3 uCameraVelocity;
uniform vec3 uBoxDimensions;
uniform sampler2D tDepth;
uniform vec4 uHeightmapBounds; // vec4(minX, minZ, width, depth)
uniform float uFallSpeed;
uniform float uRainIntensity; // To fade in/out
uniform float uDepthCamY;
uniform float uDepthNear;
uniform float uDepthFar;

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

    // Read high-precision 32-bit depth from RGBA texture
    vec4 depthColor = texture2D(tDepth, heightmapUV);
    float depthVal = unpackRGBAToDepth(depthColor);
    
    // If depth is exactly 1.0, nothing was hit (background).
    // Convert 0.0 - 1.0 orthographic depth back to World Y
    float roofY = depthVal >= 0.999 ? -999.0 : (uDepthCamY - uDepthNear - depthVal * (uDepthFar - uDepthNear));

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
  const isRaining = useEnvironmentStore((state) => state.isRaining);
  const fadeIntensity = useRef(0);
  const lastCameraPos = useRef(new THREE.Vector3());
  const cameraVelocity = useRef(new THREE.Vector3());

  const [renderTarget, setRenderTarget] = useState(null);

  // Dispose render target on unmount to prevent memory leaks
  useEffect(() => {
    const rt = new THREE.WebGLRenderTarget(256, 256, {
      format: THREE.RedFormat,
      type: THREE.FloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRenderTarget(rt);
    return () => {
      rt.dispose();
    };
  }, []);

  const depthCam = useMemo(() => {
    return new THREE.OrthographicCamera(
      -64,
      64,
      64,
      -64,
      1,
      365
    );
  }, []);

  const bounds = useMemo(() => new THREE.Vector4(0, 0, 128, 128), []);

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

    // Only render weather particles when raining and everything is initialized
    if (!isRaining || !renderTarget || fadeIntensity.current < 0.01) return;

    // Update Depth Camera position
    // Snap to integer to prevent aliasing/shimmering in the depth map
    const snapX = Math.floor(camera.position.x);
    const snapZ = Math.floor(camera.position.z);

    depthCam.position.set(snapX, 300, snapZ);
    // Fix Gimbal lock/NaN: Cannot look straight down when up is (0,1,0)
    depthCam.up.set(0, 0, -1);
    depthCam.lookAt(snapX, 0, snapZ);
    depthCam.updateMatrixWorld();

    bounds.set(snapX - 64, snapZ - 64, 128, 128);



    // Hardware-Accelerated Occlusion Render Pass
    const gl = state.gl;
    const oldTarget = gl.getRenderTarget();
    const oldClearColor = gl.getClearColor(new THREE.Color());
    const oldClearAlpha = gl.getClearAlpha();

    gl.setRenderTarget(renderTarget);
    // Clear to white (depth 1.0)
    gl.setClearColor(0xffffff, 1);
    gl.clear();
    
    if (meshRef.current) meshRef.current.visible = false;
    const oldOverride = state.scene.overrideMaterial;
    state.scene.overrideMaterial = depthMaterial;
    gl.render(state.scene, depthCam);
    state.scene.overrideMaterial = oldOverride;
    if (meshRef.current) meshRef.current.visible = true;

    // Restore WebGL State
    gl.setRenderTarget(oldTarget);
    gl.setClearColor(oldClearColor, oldClearAlpha);

    if (!materialRef.current) return;

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
    materialRef.current.uniforms.uTime.value =
      clock.getElapsedTime() % maxLoopTime;
    materialRef.current.uniforms.uCameraWorldPos.value.copy(camera.position);
    materialRef.current.uniforms.uCameraVelocity.value.copy(
      cameraVelocity.current
    );
    materialRef.current.uniforms.uRainIntensity.value = fadeIntensity.current;
    materialRef.current.uniforms.uHeightmapBounds.value.copy(bounds);
  });

  if (!renderTarget) return null;

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
          tDepth: { value: renderTarget.texture },
          uHeightmapBounds: { value: bounds }, // [minX, minZ, width, depth]
          uDepthCamY: { value: 300.0 },
          uDepthNear: { value: 1.0 },
          uDepthFar: { value: 365.0 },
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
