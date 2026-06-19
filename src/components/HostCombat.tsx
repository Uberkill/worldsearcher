/* eslint-disable no-unused-vars */
import { useRef, useState, useEffect } from 'react';
import { useRapier, RigidBody, BallCollider, useBeforePhysicsStep } from '@react-three/rapier';
import * as THREE from 'three';
import { useStore } from '../stores/useStore';
import { networkActions } from '../stores/networkActions';
import { useConnectionStore } from '../stores/connectionSlice';
import { GlobalRegistry } from '../registry/Registry';
import { ServerTickMetrics } from '../globals';

// Generates unique IDs for projectiles
let projIdCounter = 0;

export function HostCombat() {
  const { world, rapier } = useRapier();
  const isHost = useConnectionStore((state) => state.isHost);
  const [projectiles, setProjectiles] = useState([]);

  // Projectile limits and tracking
  const maxProjectiles = 100;

  const accumulator = useRef(0);
  const lastTickTime = useRef(null);

  useBeforePhysicsStep(() => {
    if (!isHost) return;
    const now = performance.now();
    if (lastTickTime.current === null) lastTickTime.current = now;
    const delta = now - lastTickTime.current;
    lastTickTime.current = now;
    
    accumulator.current += delta;
    const TICK_TIME = 1000 / ServerTickMetrics.tps;

    let ticksThisFrame = 0;
    while (accumulator.current >= TICK_TIME && ticksThisFrame < 10) {
      runFixedTick();
      accumulator.current -= TICK_TIME;
      ticksThisFrame++;
    }
    if (ticksThisFrame >= 10) accumulator.current = 0;
  });

  function runFixedTick() {
    if (!isHost) return;
    // 1. Process pending attacks
    const pendingAttacks = networkActions.getState().popPendingAttacks();

    for (const attack of pendingAttacks) {
      const { senderId, weaponId, dir, origin, timestamp } = attack;

      const weaponDef = GlobalRegistry[weaponId];
      const combatStats = weaponDef?.combat;
      if (!combatStats) continue;

      // Validate Cooldown
      const lastTime = (networkActions.getState().lastAttackTimestamps || {})[senderId] || 0;
      if (timestamp - lastTime < combatStats.cooldownMs * 0.9) {
        // Too fast, ignore (0.9 to allow slight network variance)
        continue;
      }
      networkActions.setState((prev) => ({
        lastAttackTimestamps: {
          ...prev.lastAttackTimestamps,
          [senderId]: timestamp,
        },
      }));

      const originVec = new THREE.Vector3(origin[0], origin[1], origin[2]);
      const dirVec = new THREE.Vector3(dir[0], dir[1], dir[2]);
      if (dirVec.lengthSq() < 0.0001) dirVec.set(0, 0, 1);
      else dirVec.normalize();

      // Projectile Resolution
      if (combatStats.type === 'projectile') {
        const projId = `proj_${++projIdCounter}`;

        // Advance the origin slightly so it doesn't collide with the player shooting it
        const startPos = originVec.clone().addScaledVector(dirVec, 0.5);
        const velocity = dirVec.clone().multiplyScalar(combatStats.speed || 40);

        const newProj = {
          id: projId,
          position: [startPos.x, startPos.y, startPos.z],
          velocity: [velocity.x, velocity.y, velocity.z],
          damage: combatStats.damage,
          sourceId: senderId,
          createdAt: performance.now(),
        };

        setProjectiles((prev) => {
          const next = [...prev, newProj];
          if (next.length > maxProjectiles) next.shift();
          return next;
        });

        // Broadcast to network for clients to render deterministic tracers
        networkActions.getState().broadcastEvent({
          type: 'SPAWN_PROJECTILE',
          id: projId,
          origin: [startPos.x, startPos.y, startPos.z],
          velocity: [velocity.x, velocity.y, velocity.z],
        });

        // Locally trigger visual spawn
        useStore.getState().spawnVisualProjectile({
          id: projId,
          origin: [startPos.x, startPos.y, startPos.z],
          velocity: [velocity.x, velocity.y, velocity.z],
        });
      } else if (combatStats.type === 'hitscan') {
        const startPos = originVec.clone().addScaledVector(dirVec, 0.5);
        const ray = new rapier.Ray(startPos, dirVec);

        // Host physics engine is authoritative!
        const hit = world.castRay(
          ray,
          combatStats.range || 5,
          false,
          0x00030003
        );

        let endPos = startPos
          .clone()
          .addScaledVector(dirVec, combatStats.range || 5);
        if (hit) endPos = startPos.clone().addScaledVector(dirVec, (hit.toi ?? hit.timeOfImpact));

        if (
          weaponId === 'sword' ||
          weaponId === 'pickaxe' ||
          combatStats.range <= 5
        ) {
          // MELEE WEAPONS: Thick sweeping hitbox
          // Ignore the thin raycast point and place a massive cleave right in front of the player.
          // This guarantees we hit tiny enemies like Muck Pigs even if the crosshair misses slightly.
          const reach = combatStats.range || 4;
          const centerPos = originVec
            .clone()
            .addScaledVector(dirVec, reach * 0.45);
          const sweepRadius = reach * 0.55;
          useStore
            .getState()
            .requestAreaDamage(
              [centerPos.x, centerPos.y, centerPos.z],
              sweepRadius,
              combatStats.damage,
              senderId
            );
        } else {
          // RANGED HITSCAN (Gauss Rifle)
          // Needs pinpoint accuracy at the raycast hit point
          const radius = combatStats.areaOfEffect || 1.0;
          useStore
            .getState()
            .requestAreaDamage(
              [endPos.x, endPos.y, endPos.z],
              radius,
              combatStats.damage,
              senderId
            );
        }
      }
    }

    // 2. Cleanup old physical projectiles to save memory
    const now = performance.now();
    setProjectiles((prev) => {
      const valid = prev.filter((p) => now - p.createdAt < 5000); // 5 sec max lifetime
      if (valid.length !== prev.length) return valid;
      return prev;
    });
  };

  // Render the physical rigidbodies
  if (!isHost) return null;

  return (
    <group>
      {projectiles.map((proj) => (
        <HostProjectile
          key={proj.id}
          proj={proj}
          onImpact={(impactPoint) => {
            // Impact resolved
            setProjectiles((prev) => prev.filter((p) => p.id !== proj.id));

            // Broadcast impact event
            networkActions.getState().broadcastEvent({
              type: 'PROJECTILE_IMPACT',
              id: proj.id,
              point: impactPoint,
            });

            // Locally destroy visual
            useStore.getState().destroyVisualProjectile(proj.id, impactPoint);

            // INSTEAD OF USERDATA: Trigger a small localized explosion/cleave at impact
            useStore
              .getState()
              .requestAreaDamage(impactPoint, 1.5, proj.damage, proj.sourceId);
          }}
        />
      ))}
    </group>
  );
}

function HostProjectile({ proj, onImpact }) {
  const rbRef = useRef();

  // Only apply initial velocity once
  useEffect(() => {
    if (rbRef.current) {
      rbRef.current.setLinvel(
        { x: proj.velocity[0], y: proj.velocity[1], z: proj.velocity[2] },
        true
      );
    }
  }, [proj.velocity]);

  return (
    <RigidBody
      ref={rbRef}
      position={proj.position}
      type="dynamic"
      gravityScale={0.1} // Slight gravity for arrows/bullets
      ccd={true} // Continuous Collision Detection to prevent tunneling
      onCollisionEnter={(e) => {
        if (e.other.rigidBodyObject?.userData?.id === proj.sourceId || e.other.rigidBody?.userData?.id === proj.sourceId) return;
        const hitPos = rbRef.current
          ? rbRef.current.translation()
          : proj.position;
        // Defer to next tick to avoid Rapier unsafe aliasing crash when unmounting the RigidBody
        setTimeout(() => {
          onImpact([hitPos.x, hitPos.y, hitPos.z]);
        }, 0);
      }}
    >
      <BallCollider args={[0.2]} />
    </RigidBody>
  );
}
