import { useFrame, useThree } from '@react-three/fiber';
import { Sky, Stars } from '@react-three/drei';
import { useRef, useMemo, useEffect } from 'react';
import { useStore } from '../stores/useStore';
import { useChunkStore } from '../stores/chunkSlice';
import { useEnvironmentStore } from '../stores/environmentSlice';
import { useShallow } from 'zustand/react/shallow';
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
  const shadowTimerRef = useRef(0);
  const syncTimerRef = useRef(0);
  const uiThrottleTimer = useRef(0);
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

    return () => {
      scene.remove(celestial.target);

      // CRITICAL VRAM PATCH: Destroy shadow maps on unmount to prevent memory leaks
      if (celestial.shadow.map) {
        celestial.shadow.map.dispose();
        celestial.shadow.map = null;
      }
    };
  }, [SHADOW_RADIUS, SHADOW_FAR, SHADOW_MAP_SIZE, scene, gl]);

  // Reusable color objects
  const dayColor = useMemo(() => new THREE.Color('#475569'), []);
  const nightColor = useMemo(() => new THREE.Color('#020617'), []);
  const dawnColor = useMemo(() => new THREE.Color('#cbd5e1'), []);
  const fogColor = useMemo(() => new THREE.Color('#475569'), []);

  const stormDayColor = useMemo(() => new THREE.Color('#334155'), []);
  const stormNightColor = useMemo(() => new THREE.Color('#0f172a'), []);
  const stormDawnColor = useMemo(() => new THREE.Color('#64748b'), []);

  const finalDayColor = useMemo(() => new THREE.Color(), []);
  const finalNightColor = useMemo(() => new THREE.Color(), []);
  const finalDawnColor = useMemo(() => new THREE.Color(), []);

  const stormFactorRef = useRef(0);
  const lightningFlash = useRef(0);

  const isRaining = useEnvironmentStore((state) => state.isRaining);

  // eslint-disable-next-line react-hooks/immutability
  useFrame((state, rawDelta) => {
    // CRITICAL PATCH: Cap delta at 100ms for background tab throttling
    const delta = Math.min(rawDelta, 0.1);

    const store = useStore.getState();
    const netState = networkActions.getState();
    const isGuest =
      netState.connectionStatus === 'connected' && !netState.isHost;

    // Smooth decoupled rendering time
    localTimeRef.current += delta * 0.04;

    // Network Easing: Gently rubber-band the guest's time if they drift
    if (isGuest && netState.hostWorldTime !== undefined) {
      const timeDifference = netState.hostWorldTime - localTimeRef.current;
      if (Math.abs(timeDifference) > 1.0) {
        localTimeRef.current = netState.hostWorldTime;
      } else {
        localTimeRef.current += timeDifference * delta * 2.0;
      }
    }

    let t = localTimeRef.current;
    let d = useEnvironmentStore.getState().daysElapsed;

    // CRITICAL PATCH: Handle massive time jumps accurately and wrap local timer
    if (t >= 24) {
      d += Math.floor(t / 24);
      t = t % 24;
      localTimeRef.current = t;
    }

    const angle = ((t - 6) / 24) * Math.PI * 2;
    const sunY = Math.sin(angle);
    const sunX = Math.cos(angle);
    const isNight = sunY < -0.1;
    const isSunset = sunY > -0.3 && sunY < 0.3;

    // ── Weather & Fog ──
    stormFactorRef.current = THREE.MathUtils.lerp(
      stormFactorRef.current,
      isRaining ? 1.0 : 0.0,
      delta * 0.5
    );

    finalDayColor.copy(dayColor).lerp(stormDayColor, stormFactorRef.current);
    finalNightColor
      .copy(nightColor)
      .lerp(stormNightColor, stormFactorRef.current);
    finalDawnColor.copy(dawnColor).lerp(stormDawnColor, stormFactorRef.current);

    if (scene.fog?.color) {
      if (sunY > 0.3) {
        fogColor.copy(finalDayColor);
      } else if (sunY > 0) {
        fogColor.copy(finalDawnColor).lerp(finalDayColor, sunY / 0.3);
      } else if (sunY > -0.3) {
        fogColor.copy(finalNightColor).lerp(finalDawnColor, (sunY + 0.3) / 0.3);
      } else {
        fogColor.copy(finalNightColor);
      }
      scene.fog.color.copy(fogColor);
      state.scene.background = fogColor;

      const baseDensity = 1.0 / (renderDistance * 14);
      // eslint-disable-next-line react-hooks/immutability
      scene.fog.density = THREE.MathUtils.lerp(
        baseDensity,
        0.04,
        stormFactorRef.current
      );
    }

    // No more lightning flashes or thunder. Just rain pitter patter.
    lightningFlash.current = 0;

    if (skyRef.current?.material?.uniforms?.sunPosition) {
      const len = Math.sqrt(sunX * sunX + sunY * sunY + 0.2 * 0.2);
      skyRef.current.material.uniforms.sunPosition.value.set(
        sunX / len,
        sunY / len,
        0.2 / len
      );
    }

    // Sky Shader Mie Scattering
    if (skyRef.current?.material?.uniforms) {
      const uniforms = skyRef.current.material.uniforms;
      if (uniforms.sunPosition) {
        const len = Math.sqrt(sunX * sunX + sunY * sunY + 0.2 * 0.2);
        uniforms.sunPosition.value.set(sunX / len, sunY / len, 0.2 / len);
      }
      if (uniforms.mieCoefficient)
        uniforms.mieCoefficient.value = THREE.MathUtils.lerp(
          0.004,
          0.1,
          stormFactorRef.current
        );
      if (uniforms.turbidity)
        uniforms.turbidity.value = THREE.MathUtils.lerp(
          8,
          20,
          stormFactorRef.current
        );
      if (uniforms.rayleigh)
        uniforms.rayleigh.value = THREE.MathUtils.lerp(
          1.8,
          0.2,
          stormFactorRef.current
        );
    }

    let targetAmbient = isRaining
      ? 0.3
      : isNight
        ? 0.06
        : THREE.MathUtils.lerp(0.06, 0.15, Math.max(0, sunY));
    let targetHemi = isRaining
      ? 0.4
      : isNight
        ? 0.04
        : THREE.MathUtils.lerp(0, 0.25, Math.max(0, sunY));

    targetAmbient += lightningFlash.current;
    targetHemi += lightningFlash.current * 0.5;

    if (ambientRef.current) {
      const lerpSpeed = lightningFlash.current > 0.1 ? 15.0 : 2.0;
      ambientRef.current.intensity = THREE.MathUtils.lerp(
        ambientRef.current.intensity,
        targetAmbient,
        delta * lerpSpeed
      );
    }
    if (hemiRef.current) {
      const lerpSpeed = lightningFlash.current > 0.1 ? 15.0 : 2.0;
      hemiRef.current.intensity = THREE.MathUtils.lerp(
        hemiRef.current.intensity,
        targetHemi,
        delta * lerpSpeed
      );

      let hemiBaseColor = 0x475569;
      if (isNight) hemiBaseColor = 0x020617;
      else if (isSunset) hemiBaseColor = sunY > 0 ? 0xcbd5e1 : 0x1e293b;

      const stormyHemi = 0x334155;
      const finalHemiColor = new THREE.Color(hemiBaseColor).lerp(
        new THREE.Color(stormyHemi),
        stormFactorRef.current
      );
      hemiRef.current.color.copy(finalHemiColor);
    }

    const px = state.camera.position.x;
    const py = state.camera.position.y;
    const pz = state.camera.position.z;
    const snappedPx = Math.round(px / texelSize) * texelSize;
    const snappedPy = Math.round(py / texelSize) * texelSize;
    const snappedPz = Math.round(pz / texelSize) * texelSize;

    // CRITICAL PATCH: Break the shadow map death spiral
    const currentPos = state.camera.position;
    // Only track 2D movement (X and Z). Jumping/falling (Y) should NOT trigger massive shadow updates!
    const distMovedSq = Math.pow(lastPosRef.current.x - currentPos.x, 2) + Math.pow(lastPosRef.current.z - currentPos.z, 2);
    let shadowNeedsUpdate = false;

    // Suppress shadow map updates while the GPU is busy uploading chunk geometry.
    // During a load burst, triggering a full shadow re-render on every movement
    // tick on top of geometry uploads causes visible FPS collapse.
    // pendingMeshMounts drains at 4-12/frame so this window is ~0.5-2s max.
    const pendingMounts = useChunkStore.getState().pendingMeshMounts?.length ?? 0;
    const shadowBusy = pendingMounts > 8;

    shadowTimerRef.current += delta;

    // Update shadows if moved > 32 blocks horizontally, max once every 2 seconds
    if (!shadowBusy && distMovedSq > 1024 && shadowTimerRef.current > 2.0) {
      shadowNeedsUpdate = true;
      lastPosRef.current.copy(currentPos);
      shadowTimerRef.current = 0;
    } else if (!shadowBusy && shadowTimerRef.current > 5.0) {
      // 5fps Throttle to shadows for smooth time-of-day shadow updates
      shadowTimerRef.current = 0;
      shadowNeedsUpdate = true;
    }

    if (shadowNeedsUpdate) {
      // eslint-disable-next-line react-hooks/immutability
      gl.shadowMap.needsUpdate = true;
    }

    // ── Light Intensity Fades & Safest Baton Pass ──
    const baseSun = Math.max(0, sunY * 2.8);
    const targetSun = isRaining ? Math.min(0.1, baseSun * 2.0) : baseSun;
    const targetMoon = isNight ? Math.max(0, -sunY * 0.8) : 0;

    // ── Celestial Light (Sun/Moon Combo) ──
    if (celestialLightRef.current) {
      if (sunY >= 0) {
        // Day / Sunset (Target Sun is fading to 0 as it hits horizon)
        celestialLightRef.current.intensity = THREE.MathUtils.lerp(
          celestialLightRef.current.intensity,
          targetSun,
          delta * 2.0
        );
        celestialLightRef.current.color.lerpColors(
          celestialLightRef.current.color,
          new THREE.Color(0xffffff),
          delta * 5.0
        );
      } else {
        // Night
        celestialLightRef.current.intensity = THREE.MathUtils.lerp(
          celestialLightRef.current.intensity,
          targetMoon,
          delta * 2.0
        );
        celestialLightRef.current.color.lerpColors(
          celestialLightRef.current.color,
          new THREE.Color(0x99bbff),
          delta * 5.0
        );
      }

      // CRITICAL PATCH: Only update projection matrix when shadow texture is re-rendered
      if (shadowNeedsUpdate) {
        const shadowOffset = SHADOW_FAR / 2.0;

        // Prevent infinite shadow stretching at sunrise/sunset
        const clampedSunY = Math.min(1.0, Math.max(0.3, sunY));
        const clampedSunX =
          sunX > 0
            ? Math.cos(Math.asin(clampedSunY))
            : -Math.cos(Math.asin(clampedSunY));

        if (sunY >= 0) {
          celestialLightRef.current.position.set(
            snappedPx + clampedSunX * shadowOffset,
            snappedPy + clampedSunY * shadowOffset,
            snappedPz + 16
          );
        } else {
          // Night time moon shadows
          const clampedMoonY = Math.min(1.0, Math.max(0.3, -sunY));
          const clampedMoonX =
            -sunX > 0
              ? Math.cos(Math.asin(clampedMoonY))
              : -Math.cos(Math.asin(clampedMoonY));
          celestialLightRef.current.position.set(
            snappedPx + clampedMoonX * shadowOffset,
            snappedPy + clampedMoonY * shadowOffset,
            snappedPz - 0.2 * shadowOffset
          );
        }
        celestialLightRef.current.target.position.set(
          snappedPx,
          snappedPy,
          snappedPz
        );
        celestialLightRef.current.target.updateMatrixWorld();
      }
    }

    // ── Celestial Sky Group Updates ──
    if (skyGroupRef.current) {
      skyGroupRef.current.position.set(px, py, pz);
    }
    
    if (skyRef.current && skyRef.current.material) {
      skyRef.current.material.uniforms.sunPosition.value.set(sunX, sunY, 0.2).normalize();
    }

    // ── Celestial Moon Mesh & Procedural Phases ──
    if (moonMeshRef.current) {
      // Placed relative to the skyGroup which is already at px, py, pz
      moonMeshRef.current.position.set(-sunX * 400, -sunY * 400, -0.2 * 400);
      moonMeshRef.current.lookAt(px, py, pz); // lookAt uses absolute world coordinates
    }

    if (sunMeshRef.current) {
      sunMeshRef.current.position.set(sunX * 400, sunY * 400, 0.2 * 400);
      sunMeshRef.current.lookAt(px, py, pz);
    }

    if (moonMaterialRef.current) {
      const LUNAR_CYCLE_DAYS = 8;
      const dayInCycle = d % LUNAR_CYCLE_DAYS;
      const totalPhaseProgress = (dayInCycle + t / 24) / LUNAR_CYCLE_DAYS;

      const moonPhase = (totalPhaseProgress * 2.0) % 2.0; // 0 to 2
      moonMaterialRef.current.uniforms.uPhase.value = moonPhase;
      // Fade out moon during storms
      moonMaterialRef.current.uniforms.uOpacity.value =
        1.0 - stormFactorRef.current;
    }

    if (sunMaterialRef.current) {
      // Fade out sun during storms
      sunMaterialRef.current.uniforms.uOpacity.value =
        1.0 - stormFactorRef.current;
    }

    // ── Star Rotation & Fading ──
    if (starsRef.current) {
      starsRef.current.rotation.z = angle; // Rotate stars naturally
      const starMat = starsRef.current.children[0]?.material;
      if (starMat) {
        starMat.transparent = true;
        // Visible at night, fades out during day and storms
        let starAlpha = isNight ? Math.max(0, -sunY * 2.0) : 0;
        starAlpha = THREE.MathUtils.lerp(starAlpha, 0, stormFactorRef.current);
        starMat.opacity = Math.min(1.0, starAlpha);
      }
    }

    // ── Throttled System Synchronizations ──
    uiThrottleTimer.current += delta;
    if (uiThrottleTimer.current > 0.1) {
      uiThrottleTimer.current = 0;
      useEnvironmentStore.getState().setWorldTime(t, d);
      if (useEnvironmentStore.getState().isNightTime !== isNight) {
        useEnvironmentStore.setState({ isNightTime: isNight });
      }
    }

    // Maintain TIME_SYNC broadcast within DynamicSky as GameManager doesn't exist yet
    syncTimerRef.current += delta;
    if (syncTimerRef.current > 0.2) {
      syncTimerRef.current = 0;
      if (netState.isHost && netState.connections.length > 0) {
        netState.broadcastEvent({
          type: 'TIME_SYNC',
          worldTime: t,
          daysElapsed: d,
        });
      }
    }
  });

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
