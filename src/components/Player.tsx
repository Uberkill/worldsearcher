import { useFrame, useThree } from '@react-three/fiber';
import { RigidBody, CapsuleCollider, useRapier, useBeforePhysicsStep } from '@react-three/rapier';
import { useRef, useEffect, useState, useMemo } from 'react';
import { Vector3, Euler, Quaternion } from 'three';
import { useKeyboard } from '../hooks/useKeyboard';
import { usePlayerPhysics } from '../hooks/usePlayerPhysics';
import { useStore } from '../stores/useStore';
import { useChunkStore } from '../stores/chunkSlice';
import {
  BlockRegistry,
  BlockKeyById,
} from '../registry/BlockRegistry';
import {
  getIndex,
  getTextureId,
  getIsHidden,
  CHUNK_Y_MIN,
  CHUNK_Y_MAX,
} from '../utils/chunkData';
import { playerPosition, playerRotation, ServerTickMetrics, shipTransforms, playerLastSafePosition } from '../globals';
import { EventBus } from '../utils/EventBus';
import { GlobalRegistry } from '../registry/Registry';
import { networkActions } from '../stores/networkActions';
import { BODY_GEO, HEAD_GEO, LIMB_GEO, VISOR_GEO, BODY_MAT, HEAD_MAT, VISOR_MAT } from '../utils/playerModels';

const LocalAvatar = ({ isSeated }: { isSeated: boolean }) => {
   const groupRef = useRef<import('three').Group>(null);
   const headGroupRef = useRef<import('three').Group>(null);
   const { camera } = useThree();
   const seatOffsetEuler = useMemo(() => new Euler(), []);
   const seatOffsetVec = useMemo(() => new Vector3(), []);

   useFrame(() => {
      if (!isSeated || !groupRef.current) return;
      
      const shipTransform = shipTransforms.get('default');
      const state = useStore.getState();
      
      if (shipTransform) {
         // Face front of the ship (-Z direction) by adding Math.PI to Y
         groupRef.current.rotation.set(shipTransform.rotation.x, shipTransform.rotation.y + Math.PI, shipTransform.rotation.z, 'YXZ');
         
         const localOffset = state.seatOffset || [0, 0, -3];
         seatOffsetEuler.fromArray([shipTransform.rotation.x, shipTransform.rotation.y, shipTransform.rotation.z]);
         // Lower the root so the pelvis visually rests directly on the seat block top face (-0.2 below center)
         seatOffsetVec.set(localOffset[0], localOffset[1] - 0.2, localOffset[2]).applyEuler(seatOffsetEuler);
         
         groupRef.current.position.set(
             shipTransform.position.x + seatOffsetVec.x,
             shipTransform.position.y + seatOffsetVec.y,
             shipTransform.position.z + seatOffsetVec.z
         );
      }

      if (headGroupRef.current) {
          headGroupRef.current.rotation.x = camera.rotation.x;
          let diffY = camera.rotation.y - groupRef.current.rotation.y;
          // Constrain head rotation
          if (diffY > Math.PI) diffY -= Math.PI * 2;
          if (diffY < -Math.PI) diffY += Math.PI * 2;
          if (diffY > 1.5) diffY = 1.5;
          if (diffY < -1.5) diffY = -1.5;
          headGroupRef.current.rotation.y = diffY;
      }
   });

   if (!isSeated) return null;

   return (
        <group ref={groupRef}>
          <group ref={headGroupRef} position={[0, 1.65, 0]}>
            <mesh geometry={HEAD_GEO} material={HEAD_MAT} castShadow receiveShadow />
            <mesh position={[0, 0.05, 0.26]} geometry={VISOR_GEO} material={VISOR_MAT} />
          </group>
          <mesh position={[0, 1.05, 0]} geometry={BODY_GEO} material={BODY_MAT} castShadow receiveShadow />
          <group position={[0.4, 1.4, 0]} rotation={[0,0,-0.1]}>
            <mesh position={[0, -0.35, 0]} geometry={LIMB_GEO} material={BODY_MAT} castShadow receiveShadow />
          </group>
          <group position={[-0.4, 1.4, 0]} rotation={[0,0,0.1]}>
            <mesh position={[0, -0.35, 0]} geometry={LIMB_GEO} material={BODY_MAT} castShadow receiveShadow />
          </group>
          <group position={[0.2, 0.7, 0]} rotation={[-1.5,0,0]}>
            <mesh position={[0, -0.35, 0]} geometry={LIMB_GEO} material={BODY_MAT} castShadow receiveShadow />
          </group>
          <group position={[-0.2, 0.7, 0]} rotation={[-1.5,0,0]}>
            <mesh position={[0, -0.35, 0]} geometry={LIMB_GEO} material={BODY_MAT} castShadow receiveShadow />
          </group>
        </group>
   );
};

/**
 * ============================================================================
 * CRITICAL PHYSICS ENGINE QUIRKS (DO NOT IGNORE)
 * ============================================================================
 * 
 * 1. Raycast Hit Distance (`toi` vs `timeOfImpact`):
 *    In modern versions of `@react-three/rapier` and RapierJS, the raycast 
 *    distance property on the hit object was renamed from `.toi` to `.timeOfImpact`. 
 *    ALWAYS use `(hit.toi ?? hit.timeOfImpact)` when calculating raycast hits to 
 *    ensure compatibility and prevent catastrophic `NaN` coordinate math failures.
 * 
 * 2. Raycast Self-Collision Prevention:
 *    When casting rays from the player's perspective, DO NOT rely on 
 *    `collisionGroups` or bitmasks to filter out the player's own capsule. The 
 *    React wrapper often ignores raw integer bitmasks.
 *    Instead, ALWAYS offset the raycast origin physically outside the player's 
 *    capsule by using: `startPos.clone().addScaledVector(dir, 0.45)`
 *    (Since the capsule radius is 0.4, 0.45 safely clears it).
 * ============================================================================
 */

const SPEED = 5;
const JUMP_FORCE = 7;

const MAX_ALLOWED_VELOCITY = 60;
const CollisionLayers = {
  TERRAIN: 0x0001FFFF, // Layer 0
  PLAYER: 0x0002FFFF, // Layer 1
  PROJECTILES: 0x0004FFFF, // Layer 2
  ITEMS: 0x0008FFFF, // Layer 3
};

// FIX: Hoist reusable vectors to module level.
// Before: new Vector3() × 3 + new rapier.Ray() created every frame at 60fps
// = 240+ heap allocations/sec → constant GC pressure → stutters.
// After: zero allocations per frame.
const _direction = new Vector3();
const _frontVector = new Vector3();
const _sideVector = new Vector3();
const _intendedDirection = new Vector3();
let _intendedJump = false;
let _intendedSpeedY = 0;
const _yAxis = new Vector3(0, 1, 0);
const _camPos = new Vector3();
const _grappleTarget = new Vector3();
const _grappleCamPosDist = new Vector3();
const _grappleCamPos = new Vector3();
const _grapplePullDir = new Vector3();
const _grappleFinalVel = new Vector3();
const _rayOrigin = { x: 0, y: 0, z: 0 };
const _rayDir = { x: 0, y: -1, z: 0 };
const _rayUpDir = { x: 0, y: 1, z: 0 };
const _seatEuler = new Euler();
const _seatOffsetVec = new Vector3();

export const Player = () => {
  const { camera } = useThree();
  const actionsRef = useKeyboard();
  const playerRef = useRef<any>(null); // Type any for rapier RigidBody
  const meshRef = useRef<import('three').Mesh>(null);
  const { isFlying, isSeated, initialPos } = usePlayerPhysics(playerRef, meshRef, camera, actionsRef);

  const spawnPhysicsPending = useStore((state) => state.spawnPhysicsPending);
  const { rapier, world } = useRapier();
  const physicsWaitFrames = useRef(0);

  useFrame(() => {
    if (spawnPhysicsPending) {
       physicsWaitFrames.current++;
       const ray = new rapier.Ray(
         { x: playerPosition.x, y: playerPosition.y + 10, z: playerPosition.z },
         { x: 0, y: -1, z: 0 }
       );
       const hit = world.castRay(ray, 300, false, 1); // TERRAIN is 1
       if (hit || physicsWaitFrames.current > 300) {
          useStore.getState().setWorldReady();
          useStore.getState().setSpawnPhysicsPending(false);
          physicsWaitFrames.current = 0;
       }
    }
  });

    return (
    <group>
      <RigidBody
        ref={playerRef}
        colliders={false}
        mass={1}
        type={isSeated ? "kinematicPosition" : "dynamic"}
        ccd={true}
        position={initialPos}
        lockRotations
        friction={0}
        gravityScale={isSeated || isFlying || spawnPhysicsPending ? 0 : 1}
        collisionGroups={CollisionLayers.PLAYER}
        userData={{ type: 'player', id: networkActions.getState().playerId }}
      >
        <CapsuleCollider
          args={[0.4, 0.4]}
          collisionGroups={CollisionLayers.PLAYER}
        />
        {/* Invisible player body — physics only */}
        <mesh ref={meshRef} visible={false}>
          <sphereGeometry args={[0.4]} />
        </mesh>
      </RigidBody>
      <LocalAvatar isSeated={isSeated} />
    </group>
  );
};
