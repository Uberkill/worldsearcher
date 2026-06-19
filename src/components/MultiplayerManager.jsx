import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';
import { RigidBody, CapsuleCollider } from '@react-three/rapier';
import * as THREE from 'three';
import { useConnectionStore } from '../stores/connectionSlice';
import { useSyncStore } from '../stores/syncSlice';
import { networkActions } from '../stores/networkActions';
import { useShallow } from 'zustand/react/shallow';
const _euler = new THREE.Euler();

import { BODY_GEO, HEAD_GEO, LIMB_GEO, VISOR_GEO, BODY_MAT, HEAD_MAT, VISOR_MAT } from '../utils/playerModels';

const PlayerAvatar = ({ id }) => {
  const meshRef = useRef();
  const rbRef = useRef();
  const headGroupRef = useRef();
  const targetPos = useRef(new THREE.Vector3());
  const targetQuat = useRef(new THREE.Quaternion());
  const playerName = useSyncStore((state) => state.players[id]?.name);
  const isInitialized = useRef(false);

  // Animation Refs
  const armLRef = useRef();
  const armRRef = useRef();
  const legLRef = useRef();
  const legRRef = useRef();

  const lastPos = useRef(new THREE.Vector3());
  const smoothedVelocity = useRef(0);

  useFrame((state, delta) => {
    if (delta <= 0) return;
    const safeDelta = Math.min(delta, 0.1);

    const networkState = networkActions.getState();
    const pData = networkState.players[id];
    if (!pData || !meshRef.current) return;

    const buffer = pData.positionBuffer;
    if (!buffer || buffer.length === 0) {
      if (
        pData.x !== undefined &&
        pData.y !== undefined &&
        pData.z !== undefined
      ) {
        targetPos.current.set(pData.x, pData.y, pData.z);
        const bodyEuler = new THREE.Euler(0, pData.ry, 0, 'YXZ');
        targetQuat.current.setFromEuler(bodyEuler);
        if (headGroupRef.current) {
          headGroupRef.current.rotation.x = pData.rx;
        }
      }
    } else {
      // Time-Delayed Interpolation (100ms)
      const renderTime = Date.now() - 100;
      let past = null;
      let future = null;

      for (let i = buffer.length - 1; i >= 0; i--) {
        if (buffer[i].timestamp <= renderTime) {
          past = buffer[i];
          future = buffer[i + 1] || null;
          break;
        }
      }

      if (past && future) {
        const timeSpan = future.timestamp - past.timestamp;
        const fraction =
          timeSpan > 0 ? (renderTime - past.timestamp) / timeSpan : 1;

        targetPos.current.set(
          THREE.MathUtils.lerp(past.x, future.x, fraction),
          THREE.MathUtils.lerp(past.y, future.y, fraction),
          THREE.MathUtils.lerp(past.z, future.z, fraction)
        );

        let diffY = future.yaw - past.yaw;
        while (diffY < -Math.PI) diffY += Math.PI * 2;
        while (diffY > Math.PI) diffY -= Math.PI * 2;
        const lerpY = past.yaw + diffY * fraction;

        targetQuat.current.setFromEuler(new THREE.Euler(0, lerpY, 0, 'YXZ'));

        if (headGroupRef.current) {
          headGroupRef.current.rotation.x = THREE.MathUtils.lerp(
            past.pitch,
            future.pitch,
            fraction
          );
        }
      } else if (past && !future) {
        // Lag spike: Extrapolate or halt
        targetPos.current.set(past.x, past.y, past.z);
        targetQuat.current.setFromEuler(
          new THREE.Euler(0, past.yaw, 0, 'YXZ')
        );
        if (headGroupRef.current) headGroupRef.current.rotation.x = past.pitch;
      } else if (!past && buffer.length > 0) {
        // Render time too old
        const first = buffer[0];
        targetPos.current.set(first.x, first.y, first.z);
        targetQuat.current.setFromEuler(
          new THREE.Euler(0, first.yaw, 0, 'YXZ')
        );
        if (headGroupRef.current)
          headGroupRef.current.rotation.x = first.pitch;
      }
    }

    if (!isInitialized.current) {
      meshRef.current.position.copy(targetPos.current);
      meshRef.current.quaternion.copy(targetQuat.current);
      lastPos.current.copy(targetPos.current);
      isInitialized.current = true;
      return;
    }

    // Low-pass filter velocity calculation
    const dx = targetPos.current.x - lastPos.current.x;
    const dz = targetPos.current.z - lastPos.current.z;
    const currentSpeed = Math.sqrt(dx * dx + dz * dz) / safeDelta;
    smoothedVelocity.current = THREE.MathUtils.lerp(
      smoothedVelocity.current,
      currentSpeed,
      safeDelta * 5
    );

    // Save target pos for next frame's speed calculation
    lastPos.current.copy(targetPos.current);

    // Exact interpolation overrides physics/lerp smoothing!
    meshRef.current.position.copy(targetPos.current);
    meshRef.current.quaternion.copy(targetQuat.current);
    if (rbRef.current) rbRef.current.setNextKinematicTranslation(targetPos.current);

    // Procedural walk cycle
    const isMoving = smoothedVelocity.current > 0.5;
    const time = state.clock.elapsedTime;
    const swing = isMoving
      ? Math.sin(time * 15) * 0.6 * Math.min(1, smoothedVelocity.current / 5)
      : 0;

    if (armLRef.current) armLRef.current.rotation.x = swing;
    if (armRRef.current) armRRef.current.rotation.x = -swing;
    if (legLRef.current) legLRef.current.rotation.x = -swing;
    if (legRRef.current) legRRef.current.rotation.x = swing;
  });

  return (
    <>
    <group ref={meshRef}>
      {/* Root offset to align feet to ground (-0.9 since center of 1.8 capsule is 0.9) */}
      <group position={[0, -0.9, 0]}>
        {/* Name Tag (Moved up to compensate for root offset) */}
        <Billboard position={[0, 2.5 + 0.9, 0]}>
          <Text
            fontSize={0.3}
            color="white"
            outlineWidth={0.03}
            outlineColor="black"
            anchorX="center"
            anchorY="middle"
            font="https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfMZhrib2Bg-4.ttf"
          >
            {playerName
              ? playerName
              : `Guest-${id.substring(0, 4).toUpperCase()}`}
          </Text>
        </Billboard>

        {/* Head & Visor Group */}
        <group ref={headGroupRef} position={[0, 1.65, 0]}>
          <mesh
            geometry={HEAD_GEO}
            material={HEAD_MAT}
            castShadow
            receiveShadow
          />
          <mesh
            position={[0, 0.05, 0.26]}
            geometry={VISOR_GEO}
            material={VISOR_MAT}
          />
        </group>

        {/* Torso */}
        <mesh
          position={[0, 1.05, 0]}
          geometry={BODY_GEO}
          material={BODY_MAT}
          castShadow
          receiveShadow
        />

        {/* Left Arm (Pivot at shoulder: y=1.4, x=0.4) */}
        <group ref={armLRef} position={[0.4, 1.4, 0]}>
          <mesh
            position={[0, -0.35, 0]}
            geometry={LIMB_GEO}
            material={BODY_MAT}
            castShadow
            receiveShadow
          />
        </group>

        {/* Right Arm */}
        <group ref={armRRef} position={[-0.4, 1.4, 0]}>
          <mesh
            position={[0, -0.35, 0]}
            geometry={LIMB_GEO}
            material={BODY_MAT}
            castShadow
            receiveShadow
          />
        </group>

        {/* Left Leg (Pivot at hip: y=0.7, x=0.2) */}
        <group ref={legLRef} position={[0.2, 0.7, 0]}>
          <mesh
            position={[0, -0.35, 0]}
            geometry={LIMB_GEO}
            material={BODY_MAT}
            castShadow
            receiveShadow
          />
        </group>

        {/* Right Leg */}
        <group ref={legRRef} position={[-0.2, 0.7, 0]}>
          <mesh
            position={[0, -0.35, 0]}
            geometry={LIMB_GEO}
            material={BODY_MAT}
            castShadow
            receiveShadow
          />
        </group>
      </group>
    </group>
    <RigidBody 
      ref={rbRef} 
      type="kinematicPosition" 
      colliders={false} 
      collisionGroups={0x00020002}
      userData={{ type: 'player', id }}
    >
      <CapsuleCollider args={[0.4, 0.4]} />
    </RigidBody>
    </>
  );
};

export const MultiplayerManager = () => {
  const connectionStatus = useConnectionStore(state => state.connectionStatus);
  const playerIds = useSyncStore(useShallow(state => Object.keys(state.players || {})));

  React.useEffect(() => {
    if (connectionStatus !== 'connected') return;

    // Garbage Collector: Remove players whose connections died without firing conn.on('close')
    const interval = setInterval(() => {
      const state = networkActions.getState();
      const now = Date.now();

      for (const id in state.players) {
        const p = state.players[id];
        if (p.lastUpdate && now - p.lastUpdate > 5000) {
          console.log('Culling dead player connection:', id);
          state.cullDeadConnection(id);
        }
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [connectionStatus]);

  if (connectionStatus !== 'connected') return null;

  return (
    <group>
      {playerIds.map((id) => (
        <PlayerAvatar key={id} id={id} />
      ))}
    </group>
  );
};
