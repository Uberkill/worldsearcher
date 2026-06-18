import { useFrame, useThree } from '@react-three/fiber';
import { Sky, Stars } from '@react-three/drei';
import { useRef, useMemo, useEffect } from 'react';
import { useWorldLighting } from '../hooks/useWorldLighting';
import { useStore } from '../stores/useStore';
import { useChunkStore } from '../stores/chunkSlice';
import { useEnvironmentStore } from '../stores/environmentSlice';
import { networkActions } from '../stores/networkActions';
import * as THREE from 'three';

// ── Procedural Sun Shader ──
const SunShaderMaterial = {
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uGlowColor: { value: new THREE.Color(1.0, 0.95, 0.7) }, // Warm sun glow
    uOpacity: { value: 1.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 uGlowColor;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec2 uv = vUv * 2.0 - 1.0;
      float dist = length(uv);
      
      // Crisp edge
      float sunMask = 1.0 - smoothstep(0.75, 0.8, dist);
      
      // Soft corona
      float corona = 1.0 - smoothstep(0.8, 1.0, dist);
      
      float finalAlpha = clamp(sunMask + (corona * 0.5), 0.0, 1.0) * uOpacity;
      if (finalAlpha < 0.05) discard;

      gl_FragColor = vec4(uGlowColor, finalAlpha);
    }
  `,
};

// ── Procedural Moon Phase Shader ──
// Defined outside the component to prevent re-instantiation overhead.
const MoonShaderMaterial = {
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uPhase: { value: 0.5 }, // 0.0 = New Moon, 0.5 = Half, 1.0 = Full
    uGlowColor: { value: new THREE.Color(0.8, 0.9, 1.0) }, // Nice soft blue-white glow
    uOpacity: { value: 1.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uPhase;
    uniform vec3 uGlowColor;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec2 uv = vUv * 2.0 - 1.0;
      float dist = length(uv);
      
      // Crisp moon edge with slight anti-aliasing
      float moonRadius = 0.8;
      float moonMask = 1.0 - smoothstep(moonRadius - 0.02, moonRadius + 0.02, dist);
      
      // Mathematically accurate sphere illumination
      // Calculate Z normal assuming the moon is a sphere
      float z = sqrt(max(0.0, 1.0 - (uv.x/moonRadius)*(uv.x/moonRadius) - (uv.y/moonRadius)*(uv.y/moonRadius)));
      vec3 normal = normalize(vec3(uv.x/moonRadius, uv.y/moonRadius, z));
      
      // uPhase 0.0 = New Moon (light from back)
      // uPhase 0.5 = Half Moon (light from side)
      // uPhase 1.0 = Full Moon (light from front)
      // uPhase 1.5 = Last Quarter (light from other side)
      float angle = uPhase * 3.14159265;
      vec3 lightDir = normalize(vec3(sin(angle), 0.0, -cos(angle)));
      
      float illumination = max(0.0, dot(normal, lightDir));
      // Sharp terminator line with slight softness for atmosphere
      float phaseMask = smoothstep(0.0, 0.05, illumination);
      
      float finalAlpha = moonMask * phaseMask * uOpacity;
      
      if (finalAlpha < 0.05) discard; 

      gl_FragColor = vec4(uGlowColor, finalAlpha);
    }
  `,
};

const SunHelper = ({ lightRef }) => {
  const { scene } = useThree();
  const helperRef = useRef();

  useEffect(() => {
    if (
      lightRef.current &&
      lightRef.current.shadow &&
      lightRef.current.shadow.camera
    ) {
      const helper = new THREE.CameraHelper(lightRef.current.shadow.camera);
      scene.add(helper);
      helperRef.current = helper;
      return () => {
        scene.remove(helper);
        helper.dispose();
      };
    }
  }, [lightRef, scene]);

  useFrame(() => {
    if (helperRef.current) {
      helperRef.current.update();
    }
  });

  return null;
};

export const DynamicSky = () => {
  const skyRef = useRef();
  const ambientRef = useRef();
  const celestialLightRef = useRef();
  const moonMeshRef = useRef();
  const sunMeshRef = useRef();
  const moonMaterialRef = useRef();
  const sunMaterialRef = useRef();
  const skyGroupRef = useRef();
  const starsRef = useRef();
  const hemiRef = useRef();
  const lastPosRef = useRef(new THREE.Vector3());
  const lastSunRef = useRef(null);
  const shadowTimerRef = useRef(0);
  const syncTimerRef = useRef(0);
  const uiThrottleTimer = useRef(0);
  const hasRenderedShadows = useRef(false);
  const localTimeRef = useRef(useEnvironmentStore.getState().worldTime);
  const { scene, gl } = useThree();

  const renderDistance = useStore((state) => state.renderDistance);
  const shadowQuality = useStore((state) => state.shadowQuality);
  const debugShadows = useStore((state) => state.debugShadows);

  const SHADOW_RADIUS = shadowQuality === 'performance' ? 64 : 160;
  const SHADOW_FAR = shadowQuality === 'performance' ? 400 : 800;
  const SHADOW_MAP_SIZE = shadowQuality === 'performance' ? 512 : 1024;

  const texelSize = useMemo(() => {
    return (SHADOW_RADIUS * 2) / SHADOW_MAP_SIZE;
  }, [SHADOW_RADIUS, SHADOW_MAP_SIZE]);

  const moonUniforms = useMemo(() => ({
    uPhase: { value: 0.5 },
    uGlowColor: { value: new THREE.Color(0.8, 0.9, 1.0) },
    uOpacity: { value: 1.0 },
  }), []);

  const sunUniforms = useMemo(() => ({
    uGlowColor: { value: new THREE.Color(1.0, 0.95, 0.7) },
    uOpacity: { value: 1.0 },
  }), []);

  // Handle shadow map bounds, sizing, and VRAM cleanup on mount/unmount
  // eslint-disable-next-line react-hooks/immutability
  useEffect(() => {
    const celestial = celestialLightRef.current;
    if (!celestial) return;

    // Configure Celestial Shadow Camera
    // Removed celestial.layers.enable(1) because entities are on layer 0
    celestial.shadow.camera.left = -SHADOW_RADIUS;
    celestial.shadow.camera.right = SHADOW_RADIUS;
    celestial.shadow.camera.top = SHADOW_RADIUS;
    celestial.shadow.camera.bottom = -SHADOW_RADIUS;
    celestial.shadow.camera.far = SHADOW_FAR;
    celestial.shadow.camera.updateProjectionMatrix();
    celestial.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    if (celestial.shadow.map)
      celestial.shadow.map.setSize(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);

    scene.add(celestial.target);
    // eslint-disable-next-line react-hooks/immutability
    gl.shadowMap.autoUpdate = false;
    hasRenderedShadows.current = false;

    return () => {
      scene.remove(celestial.target);

      // CRITICAL VRAM PATCH: Destroy shadow maps on unmount to prevent memory leaks
      if (celestial.shadow.map) {
        celestial.shadow.map.dispose();
        celestial.shadow.map = null;
      }
    };
  }, [SHADOW_RADIUS, SHADOW_FAR, SHADOW_MAP_SIZE, scene, gl]);
  useWorldLighting(
    skyRef,
    ambientRef,
    celestialLightRef,
    moonMeshRef,
    sunMeshRef,
    moonMaterialRef,
    sunMaterialRef,
    skyGroupRef,
    starsRef,
    hemiRef,
    lastPosRef,
    lastSunRef,
    shadowTimerRef,
    syncTimerRef,
    uiThrottleTimer,
    hasRenderedShadows,
    localTimeRef,
    scene,
    gl,
    renderDistance,
    texelSize,
    SHADOW_FAR
  );

    return (
    <>
      <group ref={skyGroupRef}>
        <Sky
          ref={skyRef}
          distance={900}
          sunPosition={[1, 0.5, 0]}
          turbidity={8}
          rayleigh={1.8}
          mieCoefficient={0.004}
          mieDirectionalG={0.88}
        />

        <group ref={starsRef}>
          <Stars
            radius={180}
            depth={50}
            count={3500}
            factor={2.5}
            saturation={0.2}
            fade
            speed={0.4}
          />
        </group>

        {/* Absolute Celestial Layer Background Moon */}
        {/* frustumCulled={false} prevents edge flickering */}
        <mesh ref={moonMeshRef} dispose={null} frustumCulled={false}>
          <planeGeometry args={[40, 40]} dispose={null} />
          <shaderMaterial
            ref={moonMaterialRef}
            uniforms={moonUniforms}
            vertexShader={MoonShaderMaterial.vertexShader}
            fragmentShader={MoonShaderMaterial.fragmentShader}
            transparent={true}
            depthWrite={false}
            depthTest={true}
            toneMapped={false}
            blending={THREE.AdditiveBlending}
            dispose={null}
          />
        </mesh>

        {/* Absolute Celestial Layer Background Sun */}
        <mesh ref={sunMeshRef} dispose={null} frustumCulled={false}>
          <planeGeometry args={[45, 45]} dispose={null} />
          <shaderMaterial
            ref={sunMaterialRef}
            uniforms={sunUniforms}
            vertexShader={SunShaderMaterial.vertexShader}
            fragmentShader={SunShaderMaterial.fragmentShader}
            transparent={true}
            depthWrite={false}
            depthTest={true}
            toneMapped={false}
            blending={THREE.AdditiveBlending}
            dispose={null}
          />
        </mesh>
      </group>

      <ambientLight ref={ambientRef} intensity={0.15} />
      <hemisphereLight ref={hemiRef} args={['#475569', '#1e293b', 0.25]} />

      {/* CRITICAL PATCH: normalBias applied to fix voxel sunrise/sunset shadow acne */}
      {/* We apply castShadow={true} by default to start the shadow pipeline */}
      <directionalLight
        ref={celestialLightRef}
        castShadow
        position={[200, 200, 16]}
        intensity={2.4}
        shadow-bias={0}
        shadow-normalBias={0.15}
      />

      {debugShadows && <SunHelper lightRef={celestialLightRef} />}
    </>
  );
};
