import { useFrame, useThree } from '@react-three/fiber';
import { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useEnvironmentStore } from '../stores/environmentSlice';
import { useChunkStore } from '../stores/chunkSlice';
import { networkActions } from '../stores/networkActions';
import { useStore } from '../stores/useStore';

export function useWorldLighting(
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
  uiThrottleTimerRef,
  hasRenderedShadowsRef,
  localTimeRef,
  scene,
  gl,
  renderDistance,
  texelSize,
  SHADOW_FAR
) {
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

  // Pre-allocated colors to prevent GC stutters in useFrame
  const _tempColor1 = useMemo(() => new THREE.Color(), []);
  const _tempColor2 = useMemo(() => new THREE.Color(), []);
  const _sunColor = useMemo(() => new THREE.Color(0xffffff), []);
  const _moonColor = useMemo(() => new THREE.Color(0x99bbff), []);

  const stormFactorRef = useRef(0);
  const lightningFlash = useRef(0);

  const isRaining = useEnvironmentStore((state) => state.isRaining);

  // eslint-disable-next-line react-hooks/immutability
  useFrame((state, rawDelta) => {
    // CRITICAL PATCH: Cap delta at 100ms for background tab throttling
    const delta = Math.min(rawDelta, 0.1);

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
      _tempColor1.setHex(hemiBaseColor);
      _tempColor2.setHex(stormyHemi);
      _tempColor1.lerp(_tempColor2, stormFactorRef.current);
      hemiRef.current.color.copy(_tempColor1);
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

    // Angle-Based Shadow Updates
    // We only update if the sun has moved > 0.5 degrees or if the player moved > 32 blocks.
    if (!lastSunRef.current) lastSunRef.current = new THREE.Vector2(sunX, sunY);
    const sunMovedSq = Math.pow(lastSunRef.current.x - sunX, 2) + Math.pow(lastSunRef.current.y - sunY, 2);

    if (!hasRenderedShadowsRef.current) {
      shadowNeedsUpdate = true;
      hasRenderedShadowsRef.current = true;
    } else if (!shadowBusy && distMovedSq > 1024 && shadowTimerRef.current > 2.0) {
      shadowNeedsUpdate = true;
      lastPosRef.current.copy(currentPos);
      shadowTimerRef.current = 0;
    } else if (!shadowBusy && sunMovedSq > 0.000075) {
      // 0.5 degrees = ~0.0087 radians. Squared = ~0.000075.
      shadowNeedsUpdate = true;
      lastSunRef.current.set(sunX, sunY);
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
          _sunColor,
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
          _moonColor,
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

    // Star Rotation & Fading
    const sr = starsRef.current;
    if (sr) {
      sr.rotation.z = angle; // Rotate stars naturally
      const starMat = sr.children[0]?.material;
      if (starMat) {
        starMat.transparent = true;
        // Visible at night, fades out during day and storms
        let starAlpha = isNight ? Math.max(0, -sunY * 2.0) : 0;
        starAlpha = THREE.MathUtils.lerp(starAlpha, 0, stormFactorRef.current);
        starMat.opacity = Math.min(1.0, starAlpha);
      }
    }

    // ──Throttled System Synchronizations ☀☀
    uiThrottleTimerRef.current += delta;
    if (uiThrottleTimerRef.current > 0.1) {
      uiThrottleTimerRef.current = 0;
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

}
