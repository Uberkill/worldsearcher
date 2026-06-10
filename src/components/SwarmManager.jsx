/* eslint-disable */
import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { InstancedRigidBodies, useRapier, useBeforePhysicsStep } from '@react-three/rapier';
import * as THREE from 'three';
import { useStore } from '../stores/useStore';
import { useChunkStore } from '../stores/chunkSlice';
import { networkActions } from '../stores/networkActions';
import { useConnectionStore } from '../stores/connectionSlice';
import { playerPosition, ServerTickMetrics } from '../globals';
import { globalAudioPool } from '../audio/globalAudioPool';
import { SWARM_CONFIG, swarmActiveCounts } from '../utils/swarmConfig';
import lootTable from '../data/loot.json';

// AI Modes
const MODE_DEAD = 0;
const MODE_WANDER = 1;
const MODE_CHASE = 2;
const MODE_FLEE = 3;
const MODE_EXPLODING = 4;
const MODE_IDLE = 5;

// Module-level pre-allocated math objects to prevent Garbage Collection stutter
const _pos = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _mat = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _color = new THREE.Color();
const _visualPos = new THREE.Vector3();

// Animation hoisted variables (GC stutter fix)
const _yAxis = new THREE.Vector3(0, 1, 0);
const _xAxis = new THREE.Vector3(1, 0, 0);
const _hPos = new THREE.Vector3();
const _hDir = new THREE.Vector3();
const _hQ = new THREE.Quaternion();
const _aPos = new THREE.Vector3();
const _aQ = new THREE.Quaternion();
const _aPivotDrop = new THREE.Vector3();
const _eulerHost = new THREE.Euler();
const _qHost = new THREE.Quaternion();

const _separation = new THREE.Vector3();
const _velGuest = { x: 0, y: 0, z: 0 };
const _rayOrigin = { x: 0, y: 0, z: 0 };
const _rayDir = { x: 0, y: -1, z: 0 };
let _cachedRay = null;

// Reusable dummy materials and geometries for InstancedMeshes
const baseGeo = new THREE.BoxGeometry(1, 1, 1);
const baseMat = new THREE.MeshStandardMaterial();


// Track active entity counts per swarm type for spawn throttling


export const SwarmManager = ({ type, max }) => {
  const cfg = SWARM_CONFIG[type] || SWARM_CONFIG['shadowman'];

  const physicsRef = useRef();
  const { world, rapier } = useRapier();
  const processedDamageRef = useRef(new Set());
  const lastBroadcastRef = useRef(0);

  // Mesh Refs
  const bodyRef = useRef();
  const headRef = useRef();
  const armLRef = useRef();
  const armRRef = useRef();
  const legLRef = useRef();
  const legRRef = useRef();

  const colorsNeedUpdate = useRef(false);
  const isGuest = useConnectionStore((state) => state.connectionStatus === 'connected' && !state.isHost);

  // Reset active counts on mount (fixes HMR desync where module-level counter persists)
  useEffect(() => {
    swarmActiveCounts[type] = 0;
  }, [type]);

  // Object Pool (AI State) -> Replaced with SoA (Struct of Arrays) for Cache Locality
  const pool = useRef({
    active: new Uint8Array(max),
    mode: new Uint8Array(max),
    health: new Float32Array(max),
    timer: new Float64Array(max),
    wanderX: new Float32Array(max),
    wanderZ: new Float32Array(max),
    fuseStart: new Float64Array(max),
    lastAttack: new Float64Array(max),
    jumpCooldown: new Float64Array(max),
    flashUntil: new Float64Array(max),
    spawnTime: new Float64Array(max),
    // A* Pathfinding Data
    pathSequenceIDs: new Float64Array(max),
    pathLengths: new Uint16Array(max),
    pathIndexes: new Uint16Array(max),
    paths: new Float32Array(max * 30 * 3), // Max 30 waypoints, 3 floats each
    lastPathRequest: new Float64Array(max),
  });

  // Track free entity indices for fast allocation
  const freeIndices = useRef([...Array(max).keys()]);

  // Initial Physics State (All dead entities placed deep underground)
  const instances = useMemo(
    () =>
      Array.from({ length: max }).map((_, i) => ({
        key: i,
        position: [i * 2, -100, 0],
        rotation: [0, 0, 0],
      })),
    [max]
  );

  // Dummy geometry for Rapier collider generation
  const dummyGeo = useMemo(
    () => new THREE.BoxGeometry(cfg.hitbox[0], cfg.hitbox[1], cfg.hitbox[2]),
    [cfg]
  );

  // Base Color buffer to flash white when taking damage/exploding
  const colorBuffer = useMemo(() => {
    const arr = new Float32Array(max * 3);
    const c = new THREE.Color(cfg.color);
    for (let i = 0; i < max; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    return arr;
  }, [max, cfg.color]);

  // Utility to set color of an instance
  const setInstanceColor = (i, hex) => {
    _color.set(hex);
    colorBuffer[i * 3] = _color.r;
    colorBuffer[i * 3 + 1] = _color.g;
    colorBuffer[i * 3 + 2] = _color.b;
    colorsNeedUpdate.current = true;
  };

  // --- Process Event Queues ---

  useEffect(() => {
    // We use a small interval to process the queue so we don't bog down useFrame with Zustand subscriptions
    const interval = setInterval(() => {
      if (!physicsRef.current) return; // Physics not mounted yet
      const state = useStore.getState();
      const p = pool.current;

      // 1. Spawning
      if (state.spawnQueue.length > 0) {
        const mySpawns = state.spawnQueue.filter((q) => q.type === type);
        mySpawns.forEach((req) => {
          const freeIdx = freeIndices.current.shift();
          if (freeIdx === undefined) {
            // Pool is full – silently discard this spawn request
            state.shiftSpawnQueue(req.id);
            return;
          }

          p.active[freeIdx] = 1;
          p.health[freeIdx] = cfg.maxHealth;
          swarmActiveCounts[type] = (swarmActiveCounts[type] || 0) + 1;
          p.mode[freeIdx] =
            type === 'muck-pig' || type === 'wooly-grazer'
              ? MODE_WANDER
              : MODE_CHASE;
          p.timer[freeIdx] = Date.now() + 2000;
          p.spawnTime[freeIdx] = Date.now();

          if (!physicsRef.current) {
            console.warn(`[SwarmManager] physicsRef missing for ${type}`);
          }
          const rb =
            typeof physicsRef.current?.at === 'function'
              ? physicsRef.current.at(freeIdx)
              : physicsRef.current?.[freeIdx];
          if (rb) {
            rb.setTranslation(
              { x: req.pos[0], y: req.pos[1] + cfg.yOffset + 1.0, z: req.pos[2] },
              true
            );
            rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
            rb.wakeUp();
          } else {
            // Roll back spawn — entity becomes a zombie if we don't
            console.warn(
              `[SwarmManager] Failed to spawn ${type} at idx ${freeIdx} (rb not found)`
            );
            p.active[freeIdx] = 0;
            p.mode[freeIdx] = MODE_DEAD;
            freeIndices.current.push(freeIdx);
            swarmActiveCounts[type] = Math.max(
              0,
              (swarmActiveCounts[type] || 0) - 1
            );
          }
          state.shiftSpawnQueue(req.id);
        });
      }

      // 2. Area Damage (Explosions)
      if (state.damageQueue.length > 0) {
        state.damageQueue.forEach((req) => {
          if (processedDamageRef.current.has(req.id)) return;
          processedDamageRef.current.add(req.id);

          for (let i = 0; i < max; i++) {
            if (p.active[i] === 0) continue;
            const rb =
              typeof physicsRef.current?.at === 'function'
                ? physicsRef.current.at(i)
                : physicsRef.current?.[i];
            if (!rb) continue;

            const pos = rb.translation();
            const distSq =
              Math.pow(pos.x - req.pos[0], 2) +
              Math.pow(pos.y - req.pos[1], 2) +
              Math.pow(pos.z - req.pos[2], 2);
            const effectiveRadius =
              req.radius +
              Math.max(cfg.hitbox[0], cfg.hitbox[1], cfg.hitbox[2]) / 2;
            if (distSq <= effectiveRadius * effectiveRadius) {
              p.health[i] -= req.amount;
              if (globalAudioPool)
                globalAudioPool.playSpatial('damage', [pos.x, pos.y, pos.z]);
              setInstanceColor(i, '#ffffff');
              p.flashUntil[i] = Date.now() + 200; // Frame-based flash reset (no setTimeout)
              // Animals flee from explosions
              if (cfg.attackDamage === 0) {
                p.mode[i] = MODE_FLEE;
                p.timer[i] = Date.now() + 5000;
              }
            }
          }
        });
        for (const id of processedDamageRef.current) {
          if (!state.damageQueue.some(req => req.id === id)) {
            processedDamageRef.current.delete(id);
          }
        }
      } else if (processedDamageRef.current.size > 0) {
        // No pending damage — clear all processed IDs
        processedDamageRef.current.clear();
      }

      // 3. Direct Damage (Hitscan / Projectiles)
      if (state.directDamageQueue.length > 0) {
        state.directDamageQueue.forEach((req) => {
          if (req.type !== type) return;
          const i = req.id;
          if (i >= 0 && i < max && p.active[i] === 1) {
            p.health[i] -= req.amount;
            // Try to get rb for exact position, otherwise fallback to req.pos which is slightly offset
            const rb =
              typeof physicsRef.current?.at === 'function'
                ? physicsRef.current.at(i)
                : physicsRef.current?.[i];
            const pos = rb ? rb.translation() : { x: 0, y: 0, z: 0 };
            if (globalAudioPool)
              globalAudioPool.playSpatial('damage', [
                pos.x || 0,
                pos.y || 0,
                pos.z || 0,
              ]);
            setInstanceColor(i, '#ff0000');
            p.flashUntil[i] = Date.now() + 200;
            if (cfg.attackDamage === 0) {
              p.mode[i] = MODE_FLEE;
              p.timer[i] = Date.now() + 5000;
            }
          }
          state.shiftDirectDamageQueue(req.id);
        });
      }
    }, 50);
    return () => clearInterval(interval);
  }, [type, cfg, max]);

  // --- Centralized AI and Animation Loop ---
  useBeforePhysicsStep(() => {
    runFixedTick();
  });

  const runFixedTick = () => {
    if (!physicsRef.current) return;
    const now = Date.now();
    const state = useStore.getState();
    const netState = networkActions.getState();
    const isGuest =
      netState.connectionStatus === 'connected' && !netState.isHost;
    const dynDespawnDistSq = Math.pow(
      Math.max(32, (state.renderDistance || 8) * 16),
      2
    );
    const p = pool.current;

    // --- Network Sync ---

    // --- Flow Field Trigger (Host / Local Only) ---
    // (Removed: Global flow fields have been replaced by individualized A* Pathfinding requested per-entity in MODE_CHASE)

    if (isGuest) {
      const buffer = netState.enemySyncBuffers[cfg.subTypeId];
      if (buffer) {
        p.active.fill(0);
        let newActiveCount = 0;
        for (const ent of buffer) {
          const i = ent.id;
          if (i >= max) continue;
          p.active[i] = 1;
          p.mode[i] = ent.mode;
          p.health[i] = ent.health;

          const rb =
            typeof physicsRef.current.at === 'function'
              ? physicsRef.current.at(i)
              : physicsRef.current[i];
          if (rb) {
            const oldPos = rb.translation();
            const distSq =
              (ent.x - oldPos.x) ** 2 +
              (ent.y - oldPos.y) ** 2 +
              (ent.z - oldPos.z) ** 2;
            if (distSq > 25) {
              rb.setNextKinematicTranslation({ x: ent.x, y: ent.y, z: ent.z });
            } else {
              const lerpFactor = 1.0 - Math.exp(-10 * (1 / ServerTickMetrics.tps));
              const nextX = oldPos.x + (ent.x - oldPos.x) * lerpFactor;
              const nextY = oldPos.y + (ent.y - oldPos.y) * lerpFactor;
              const nextZ = oldPos.z + (ent.z - oldPos.z) * lerpFactor;
              rb.setNextKinematicTranslation({ x: nextX, y: nextY, z: nextZ });
            }
            rb.setLinvel({ x: 0, y: 0, z: 0 }, true);

            if (!Number.isNaN(ent.yaw)) {
              _q.setFromAxisAngle(_yAxis, ent.yaw);
              rb.setRotation(_q, true);
            }
          }
          newActiveCount++;
        }
        swarmActiveCounts[type] = newActiveCount;
      }
    } else if (
      netState.isHost &&
      netState.connections.length > 0 &&
      now - lastBroadcastRef.current > 100
    ) {
      const entities = [];
      for (let i = 0; i < max; i++) {
        if (p.active[i] === 1) {
          const rb =
            typeof physicsRef.current.at === 'function'
              ? physicsRef.current.at(i)
              : physicsRef.current[i];
          if (rb) {
            const pos = rb.translation();
            const q = rb.rotation();
            _qHost.set(q.x, q.y, q.z, q.w);
            _eulerHost.setFromQuaternion(_qHost, 'YXZ');
            entities.push({
              id: i,
              mode: p.mode[i],
              health: p.health[i],
              x: pos.x,
              y: pos.y,
              z: pos.z,
              yaw: _eulerHost.y,
            });
          }
        }
      }
      netState.broadcastEntityState(cfg.subTypeId, entities);
      lastBroadcastRef.current = now;
    }

    for (let i = 0; i < max; i++) {
      if (p.active[i] === 0) continue;

      const rb =
        typeof physicsRef.current.at === 'function'
          ? physicsRef.current.at(i)
          : physicsRef.current[i];
      if (!rb) continue;

      // -- Flash Timer (replaces setTimeout for color resets) --
      if (p.flashUntil[i] > 0 && now > p.flashUntil[i]) {
        setInstanceColor(i, cfg.color);
        p.flashUntil[i] = 0;
      }

      const pos = rb.translation();
      const vel = rb.linvel();

      // Fix: Clamp vertical velocity to prevent entities from launching into the sky
      // Sometimes physics glitches push them up with immense force. This caps their upward and downward speed.
      if (!Number.isFinite(vel.y)) vel.y = 0;
      vel.y = Math.max(-30, Math.min(10, vel.y));

      _pos.set(pos.x, pos.y, pos.z);
      _vel.set(vel.x, vel.y, vel.z);

      // If the player is dead, enemies immediately lose aggro and wander off or despawn
      const distSqToPlayer = state.isDead
        ? 999999
        : _pos.distanceToSquared(playerPosition);

      // -- Despawn & Death --
      if (
        p.health[i] <= 0 ||
        distSqToPlayer > dynDespawnDistSq ||
        pos.y < -100 || // Phase 2: Absolute Kill Plane Failsafe
        (pos.y < -20 && now - p.spawnTime[i] > 1000)
      ) {
        // Drop loot and XP if killed by player
        if (p.health[i] <= 0) {
          if (!isGuest && netState.isHost) {
            // $O(1)$ Downward Raycast (maxToi: 100) to find the floor
            const rayOrigin = new THREE.Vector3(pos.x, pos.y, pos.z);
            const rayDir = new THREE.Vector3(0, -1, 0);
            const hit = world.castRay(new rapier.Ray(rayOrigin, rayDir), 100, false);
            
            if (hit) {
              const hitPoint = { x: rayOrigin.x, y: rayOrigin.y - (hit.toi ?? hit.timeOfImpact), z: rayOrigin.z };
              
              // --- DROP XP ORB ---
              let xpAmount = 5;
              if (type === 'beast') xpAmount = 50;
              else if (type === 'creeper') xpAmount = 15;

              useStore.getState().updateObjectiveProgress('KILL', type, 1);
              
              const xpDropId = `drop_xp_${Date.now()}_${Math.random()}`;
              const xpEvent = {
                type: 'SPAWN_LOOT',
                id: xpDropId,
                dropId: xpDropId,
                itemId: 'xp_orb', // Special intercepted texture
                amount: xpAmount,
                position: [hitPoint.x, hitPoint.y + 0.25, hitPoint.z],
              };
              netState.broadcastEvent(xpEvent);
              useStore.getState().spawnLoot(xpEvent);

              // --- NORMAL LOOT ---
              const lootDef = lootTable[type] || lootTable['zombie'];
              if (lootDef) {
                for (let r = 0; r < (lootDef.rolls || 1); r++) {
                  let roll = Math.random();
                  let cumulative = 0;
                  for (const drop of lootDef.drops) {
                    cumulative += drop.chance;
                    if (roll <= cumulative) {
                      if (drop.id !== 'nothing') {
                        const amount = drop.min + Math.floor(Math.random() * (drop.max - drop.min + 1));
                        const dropId = `drop_${Date.now()}_${Math.random()}`;
                        const ev = {
                          type: 'SPAWN_LOOT',
                          id: dropId,
                          dropId: dropId,
                          itemId: drop.id,
                          amount: amount,
                          position: [hitPoint.x + (Math.random() - 0.5), hitPoint.y + 0.25, hitPoint.z + (Math.random() - 0.5)],
                        };
                        netState.broadcastEvent(ev);
                        useStore.getState().spawnLoot(ev);
                      }
                      break;
                    }
                  }
                }
              }
            }
          }
        }

        p.active[i] = 0;
        p.mode[i] = MODE_DEAD;
        // Return index to free pool
        freeIndices.current.push(i);
        swarmActiveCounts[type] = Math.max(
          0,
          (swarmActiveCounts[type] || 0) - 1
        );
        rb.setTranslation({ x: i * 2, y: -100, z: 0 }, true);
        rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
        rb.sleep();

        // Hide meshes
        _mat.makeTranslation(0, -100, 0);
        if (bodyRef.current) bodyRef.current.setMatrixAt(i, _mat);
        if (headRef.current) headRef.current.setMatrixAt(i, _mat);
        if (cfg.isHumanoid) {
          armLRef.current?.setMatrixAt(i, _mat);
          armRRef.current?.setMatrixAt(i, _mat);
          legLRef.current?.setMatrixAt(i, _mat);
          legRRef.current?.setMatrixAt(i, _mat);
        }
        continue;
      }

      // -- AI Logic --
      if (!isGuest) {
        const dist = Math.sqrt(distSqToPlayer);
        const isHostile = cfg.attackDamage > 0;
        const mode = p.mode[i];

        // Kamikaze (Creeper)
        if (type === 'creeper') {
          if (mode === MODE_EXPLODING) {
            rb.setLinvel({ x: 0, y: vel.y, z: 0 }, true);
            const flash = Math.sin(((now - p.fuseStart[i]) / 1500) * 30) > 0;
            setInstanceColor(i, flash ? '#ffffff' : cfg.color);

            if (now - p.fuseStart[i] > 1500) {
              if (globalAudioPool)
                globalAudioPool.playSpatial('explosion', [pos.x, pos.y, pos.z]);
              state.triggerExplosion(pos.x, pos.y, pos.z);
              p.health[i] = 0; // Trigger death next frame
            } else if (dist > 4.5) {
              p.mode[i] = MODE_CHASE;
              setInstanceColor(i, cfg.color);
            }
          } else if (dist < 2.5) {
            p.mode[i] = MODE_EXPLODING;
            p.fuseStart[i] = now;
          }
        }

        // Transitions
        if (p.mode[i] !== MODE_EXPLODING && p.mode[i] !== MODE_FLEE) {
          if (isHostile) {
            const aggroRange = p.health[i] < cfg.maxHealth ? 50 : 20;
            if (dist > aggroRange) p.mode[i] = MODE_WANDER;
            else p.mode[i] = MODE_CHASE;
          } else {
            if (dist > 30) p.mode[i] = MODE_IDLE;
            else if (p.mode[i] === MODE_IDLE) p.mode[i] = MODE_WANDER; // Unfreeze when player approaches
          }
        }

        // Flee (Animals)
        if (p.mode[i] === MODE_FLEE) {
          if (now > p.timer[i]) p.mode[i] = MODE_WANDER;
          else {
            _dir.copy(_pos).sub(playerPosition).normalize();
            rb.setLinvel(
              {
                x: _dir.x * (cfg.speed * 1.5),
                y: vel.y,
                z: _dir.z * (cfg.speed * 1.5),
              },
              true
            );
            const angle = Math.atan2(_dir.x, _dir.z);
            _q.setFromAxisAngle(_yAxis, angle);
            rb.setRotation(_q, true);
          }
        }
        // Wander
        else if (p.mode[i] === MODE_WANDER) {
          if (now > p.timer[i]) {
            const angle = Math.random() * Math.PI * 2;
            p.wanderX[i] = Math.cos(angle);
            p.wanderZ[i] = Math.sin(angle);
            p.timer[i] = now + 2000 + Math.random() * 3000;
          }
          _dir.set(p.wanderX[i], 0, p.wanderZ[i]);
          rb.setLinvel(
            {
              x: _dir.x * (cfg.speed * 0.4),
              y: vel.y,
              z: _dir.z * (cfg.speed * 0.4),
            },
            true
          );
          const angle = Math.atan2(_dir.x, _dir.z);
          _q.setFromAxisAngle(_yAxis, angle);
          rb.setRotation(_q, true);
        }
        // Chase
        else if (p.mode[i] === MODE_CHASE) {
          if (dist > 1.2) {
            let usingPath = false;
            const entityId = `${type}_${i}`;

            // Check if worker returned a new path for us
            const resolvedPath = state.resolvedPaths[entityId];
            if (resolvedPath && resolvedPath.sequenceID > p.pathSequenceIDs[i]) {
              p.pathSequenceIDs[i] = resolvedPath.sequenceID;
              p.pathLengths[i] = Math.min(30, resolvedPath.length); // Max 30 waypoints
              p.pathIndexes[i] = 0;
              for (let j = 0; j < p.pathLengths[i] * 3; j++) {
                p.paths[i * 90 + j] = resolvedPath.pathBuffer[j];
              }
            }

            // Path Following Logic
            if (p.pathLengths[i] > 0 && p.pathIndexes[i] < p.pathLengths[i]) {
              usingPath = true;
              const idx = p.pathIndexes[i];
              const targetX = p.paths[i * 90 + idx * 3];
              const targetY = p.paths[i * 90 + idx * 3 + 1];
              const targetZ = p.paths[i * 90 + idx * 3 + 2];

              // Calculate vector to waypoint
              const dx = targetX - pos.x;
              const dz = targetZ - pos.z;
              const distToWaypointSq = dx * dx + dz * dz;

              // If close to waypoint, advance to next
              if (distToWaypointSq < 0.5) {
                p.pathIndexes[i]++;
              } else {
                _dir.set(dx, 0, dz).normalize();
              }

              // Local Steering (Boids Separation) to prevent the "Conga Line"
              _separation.set(0, 0, 0);
              let neighbors = 0;
              for (let j = 0; j < max; j++) {
                if (i !== j && p.active[j] === 1 && p.mode[j] === MODE_CHASE) {
                  const otherRb = typeof physicsRef.current?.at === 'function' ? physicsRef.current.at(j) : physicsRef.current?.[j];
                  if (otherRb) {
                    const otherPos = otherRb.translation();
                    const sDistSq = Math.pow(pos.x - otherPos.x, 2) + Math.pow(pos.z - otherPos.z, 2);
                    if (sDistSq < 1.0 && sDistSq > 0.001) {
                      _separation.x += (pos.x - otherPos.x) / sDistSq;
                      _separation.z += (pos.z - otherPos.z) / sDistSq;
                      neighbors++;
                    }
                  }
                }
              }
              if (neighbors > 0) {
                _separation.multiplyScalar(0.5); // Separation weight
                _dir.add(_separation).normalize();
              }

              // Apply Pathfinding Vector
              rb.setLinvel({ x: _dir.x * cfg.speed, y: vel.y, z: _dir.z * cfg.speed }, true);
              const angle = Math.atan2(_dir.x, _dir.z);
              _q.setFromAxisAngle(_yAxis, angle);
              rb.setRotation(_q, true);

              // Auto-Jump over stairs/obstacles
              if (targetY > pos.y - cfg.hitbox[1] / 2 + 0.5 && now > p.jumpCooldown[i]) {
                _rayOrigin.x = pos.x;
                _rayOrigin.y = pos.y - cfg.hitbox[1] / 2 + 0.1;
                _rayOrigin.z = pos.z;
                if (!_cachedRay) _cachedRay = new rapier.Ray(_rayOrigin, _rayDir);
                else {
                  _cachedRay.origin.x = _rayOrigin.x;
                  _cachedRay.origin.y = _rayOrigin.y;
                  _cachedRay.origin.z = _rayOrigin.z;
                }
                const hit = world.castRay(_cachedRay, 0.4, false, 0x00010001); // Layer 1 (Terrain)
                if (hit) {
                  rb.setLinvel({ x: _dir.x * cfg.speed, y: 7, z: _dir.z * cfg.speed }, true);
                  p.jumpCooldown[i] = now + 1000;
                }
              }
            }

            // Recalculate Path if needed
            if (!usingPath || now - p.lastPathRequest[i] > 2000) {
              if (now - p.lastPathRequest[i] > 500) { // Throttle requests
                p.lastPathRequest[i] = now;
                const seqID = Date.now();
                state.requestPath(entityId, seqID, [pos.x, pos.y, pos.z], [playerPosition.x, playerPosition.y, playerPosition.z]);
              }
              
              // Fallback Euclidean movement while waiting for path
              if (!usingPath) {
                _dir.copy(playerPosition).sub(_pos).normalize();
                rb.setLinvel({ x: _dir.x * cfg.speed, y: vel.y, z: _dir.z * cfg.speed }, true);
                const angle = Math.atan2(_dir.x, _dir.z);
                _q.setFromAxisAngle(_yAxis, angle);
                rb.setRotation(_q, true);
              }
            }
          } else {
            rb.setLinvel({ x: 0, y: vel.y, z: 0 }, true);
          }

          // Attack & Jump (Stuck Detector)
          _dir.copy(playerPosition).sub(_pos).normalize();
          if (dist > 1.2) {
            if (Math.abs(vel.x) < 0.2 && Math.abs(vel.z) < 0.2) {
              // If completely stuck despite Flow Field, try to jump
              if (now > p.jumpCooldown[i]) {
                _rayOrigin.x = pos.x;
                _rayOrigin.y = pos.y - cfg.hitbox[1] / 2 + 0.1;
                _rayOrigin.z = pos.z;
                if (!_cachedRay) _cachedRay = new rapier.Ray(_rayOrigin, _rayDir);
                else {
                  _cachedRay.origin.x = _rayOrigin.x;
                  _cachedRay.origin.y = _rayOrigin.y;
                  _cachedRay.origin.z = _rayOrigin.z;
                }
                const hit = world.castRay(_cachedRay, 0.4, false, 0x00010001); // Layer 1 (Terrain)
                if (hit) {
                  rb.setLinvel(
                    { x: _dir.x * cfg.speed, y: 7, z: _dir.z * cfg.speed },
                    true
                  );
                  p.jumpCooldown[i] = now + 1500;
                }
              }
              if (now - p.lastAttack[i] > 1000) {
                // Stuck, damage block
                const targetX = Math.floor(pos.x + _dir.x * 1.5);
                const targetY = Math.floor(pos.y);
                const targetZ = Math.floor(pos.z + _dir.z * 1.5);
                if (type === 'beast') {
                  const blocksToDamage = [];
                  for (let dx = -2; dx <= 2; dx++) {
                    for (let dy = 0; dy <= 4; dy++) {
                      for (let dz = -2; dz <= 2; dz++) {
                        blocksToDamage.push({
                          x: targetX + dx,
                          y: targetY + dy,
                          z: targetZ + dz,
                          amount: cfg.attackDamage
                        });
                      }
                    }
                  }
                  if (state.damageBlocksBulk) {
                    state.damageBlocksBulk(blocksToDamage);
                  } else {
                    blocksToDamage.forEach(b => state.damageBlock(b.x, b.y, b.z, b.amount, true));
                  }
                } else {
                  state.damageBlock(
                    Math.floor(pos.x + _dir.x),
                    targetY,
                    Math.floor(pos.z + _dir.z),
                    cfg.attackDamage,
                    true
                  );
                }
                p.lastAttack[i] = now;
              }
            }
          } else {
            // Close enough to hit player
            if (now - p.lastAttack[i] > 1000) {
              state.damagePlayer(cfg.attackDamage);
              p.lastAttack[i] = now;
            }
          }
        }
      } // End of !isGuest block
    } // End of runFixedTick loop
  };

  useFrame(({ clock }) => {
    if (!physicsRef.current) return;
    const time = clock.getElapsedTime();
    const p = pool.current;
    const cfg = SWARM_CONFIG[type] || SWARM_CONFIG['shadowman'];
    for (let i = 0; i < max; i++) {
      if (p.active[i] === 0) continue;
      const rb = typeof physicsRef.current.at === 'function' ? physicsRef.current.at(i) : physicsRef.current[i];
      if (!rb) continue;
      let vel = _velGuest;
      if (!isGuest) vel = rb.linvel();

      // -- Animation Math (Zero Object Allocation) --
      // Calculate walk cycle based on planar velocity
      const flatSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
      const isMoving = flatSpeed > 0.1;
      const swing = isMoving ? Math.sin(time * 10 * flatSpeed) * 0.5 : 0;

      const rbRot = rb.rotation();
      const baseQ = _q.set(rbRot.x, rbRot.y, rbRot.z, rbRot.w);
      const rPos = rb.translation();
      _pos.set(rPos.x, rPos.y, rPos.z);

      // Dynamically align visual meshes to the bottom of the physics collider
      const bottomY = _pos.y - cfg.hitbox[1] / 2;
      const legHeight = cfg.limbGeo ? cfg.limbGeo[1] : 0;

      _visualPos.copy(_pos);
      if (cfg.isHumanoid) {
        _visualPos.y = bottomY + legHeight + cfg.bodyGeo[1] / 2;
      } else {
        _visualPos.y = bottomY + cfg.bodyGeo[1] / 2;
      }

      // Body
      if (bodyRef.current) {
        _scale.set(...cfg.bodyGeo);
        _mat.compose(_visualPos, baseQ, _scale);
        bodyRef.current.setMatrixAt(i, _mat);
      }

      // Head
      if (headRef.current) {
        _scale.set(...cfg.headGeo);
        const headYOffset = cfg.bodyGeo[1] / 2 + cfg.headGeo[1] / 2;

        _hPos.set(0, headYOffset, 0).applyQuaternion(baseQ).add(_visualPos);
        _hDir.copy(playerPosition).sub(_hPos).normalize();

        const hAngle = Math.atan2(_hDir.x, _hDir.z);
        _hQ.setFromAxisAngle(_yAxis, hAngle);

        _mat.compose(_hPos, _hQ, _scale);
        headRef.current.setMatrixAt(i, _mat);
      }

      // Limbs (Humanoids)
      if (cfg.isHumanoid && armLRef.current) {
        _scale.set(...cfg.limbGeo);

        // Left Arm
        const armX = cfg.bodyGeo[0] / 2 + cfg.limbGeo[0] / 2;
        const armY = cfg.bodyGeo[1] / 2; // Shoulder height

        _aPos.set(armX, armY, 0).applyQuaternion(baseQ).add(_visualPos);
        _aQ.setFromAxisAngle(_xAxis, swing).premultiply(baseQ);
        _aPivotDrop.set(0, -cfg.limbGeo[1] / 2, 0).applyQuaternion(_aQ);
        _aPos.add(_aPivotDrop);

        _mat.compose(_aPos, _aQ, _scale);
        armLRef.current.setMatrixAt(i, _mat);

        // Right Arm
        _aPos.set(-armX, armY, 0).applyQuaternion(baseQ).add(_visualPos);
        _aQ.setFromAxisAngle(_xAxis, -swing).premultiply(baseQ);
        _aPivotDrop.set(0, -cfg.limbGeo[1] / 2, 0).applyQuaternion(_aQ);
        _aPos.add(_aPivotDrop);

        _mat.compose(_aPos, _aQ, _scale);
        armRRef.current.setMatrixAt(i, _mat);

        // Left Leg
        const legY = -(cfg.bodyGeo[1] / 2); // Hip height
        const legX = cfg.bodyGeo[0] / 4;

        _aPos.set(legX, legY, 0).applyQuaternion(baseQ).add(_visualPos);
        _aQ.setFromAxisAngle(_xAxis, -swing).premultiply(baseQ);
        _aPivotDrop.set(0, -cfg.limbGeo[1] / 2, 0).applyQuaternion(_aQ);
        _aPos.add(_aPivotDrop);

        _mat.compose(_aPos, _aQ, _scale);
        legLRef.current.setMatrixAt(i, _mat);

        // Right Leg
        _aPos.set(-legX, legY, 0).applyQuaternion(baseQ).add(_visualPos);
        _aQ.setFromAxisAngle(_xAxis, swing).premultiply(baseQ);
        _aPivotDrop.set(0, -cfg.limbGeo[1] / 2, 0).applyQuaternion(_aQ);
        _aPos.add(_aPivotDrop);

        _mat.compose(_aPos, _aQ, _scale);
        legRRef.current.setMatrixAt(i, _mat);
      }
    }

    // Flag instanced meshes for re-render
    if (bodyRef.current) bodyRef.current.instanceMatrix.needsUpdate = true;
    if (headRef.current) headRef.current.instanceMatrix.needsUpdate = true;
    if (cfg.isHumanoid) {
      if (armLRef.current) armLRef.current.instanceMatrix.needsUpdate = true;
      if (armRRef.current) armRRef.current.instanceMatrix.needsUpdate = true;
      if (legLRef.current) legLRef.current.instanceMatrix.needsUpdate = true;
      if (legRRef.current) legRRef.current.instanceMatrix.needsUpdate = true;
    }

    // Always upload color buffer — damage flashes can happen from setInterval/event callbacks
    if (colorsNeedUpdate.current) {
      if (bodyRef.current) bodyRef.current.instanceColor.needsUpdate = true;
      if (headRef.current) headRef.current.instanceColor.needsUpdate = true;
      if (cfg.isHumanoid) {
        if (armLRef.current) armLRef.current.instanceColor.needsUpdate = true;
        if (armRRef.current) armRRef.current.instanceColor.needsUpdate = true;
        if (legLRef.current) legLRef.current.instanceColor.needsUpdate = true;
        if (legRRef.current) legRRef.current.instanceColor.needsUpdate = true;
      }
      colorsNeedUpdate.current = false;
    }
  });

  // Handle Bullet Collisions (Spatial Hashing Fallback)
  const handleCollision = (e) => {
    // Bullets spawn with user data
    if (e.other.rigidBodyObject?.userData?.type === 'bullet') {
      const hitPos = e.intersection?.point || e.target?.translation();
      if (!hitPos) return; // Physics engine failure

      const p = pool.current;

      // Find closest active entity
      let closestId = -1;
      let minD = Infinity;
      for (let i = 0; i < max; i++) {
        if (p.active[i] === 0) continue;
        const rb =
          typeof physicsRef.current?.at === 'function'
            ? physicsRef.current.at(i)
            : physicsRef.current?.[i];
        if (!rb) continue;
        const pos = rb.translation();
        const d =
          Math.pow(pos.x - hitPos.x, 2) +
          Math.pow(pos.y - hitPos.y, 2) +
          Math.pow(pos.z - hitPos.z, 2);
        const maxDist =
          2 + Math.max(cfg.hitbox[0], cfg.hitbox[1], cfg.hitbox[2]) / 2;
        if (d < minD && d < maxDist * maxDist) {
          // Must be within hitbox bounding sphere
          minD = d;
          closestId = i;
        }
      }

      if (closestId !== -1) {
        const dmg = 50 * useStore.getState().playerDamageMult;
        p.health[closestId] -= dmg;
        if (cfg.attackDamage === 0) {
          p.mode[closestId] = MODE_FLEE;
          p.timer[closestId] = Date.now() + 5000; // Flee for 5 seconds
        }

        setInstanceColor(closestId, '#ff0000');
        p.flashUntil[closestId] = Date.now() + 200; // Frame-based flash reset
      }
    }
  };

  return (
    <group>
      <InstancedRigidBodies
        ref={physicsRef}
        type={isGuest ? 'kinematicPosition' : 'dynamic'}
        instances={instances}
        colliders="cuboid"
        ccd={true}
        mass={cfg.hitbox[0] * cfg.hitbox[1] * cfg.hitbox[2] * 10} // Mass based on volume
        lockRotations
        collisionGroups={0x00020001}
        onCollisionEnter={handleCollision}
      >
        <instancedMesh args={[dummyGeo, baseMat, max]} visible={false} />
      </InstancedRigidBodies>

      {/* Visual Meshes - Frustum Culled is FALSE to prevent Invisibility Bug */}
      <instancedMesh
        ref={bodyRef}
        args={[baseGeo, baseMat, max]}
        frustumCulled={false}
        castShadow
        onBeforeRender={() => {
          if (window.__DEBUG_STATS__) {
            const activeCount = swarmActiveCounts[type] || 0;
            window.__DEBUG_STATS__.entitiesRendered += activeCount;
            window.__DEBUG_STATS__.totalEntities += activeCount;
          }
        }}
      >
        <instancedBufferAttribute
          attach="instanceColor"
          args={[colorBuffer, 3]}
        />
      </instancedMesh>

      <instancedMesh
        ref={headRef}
        args={[baseGeo, baseMat, max]}
        frustumCulled={false}
        castShadow
      >
        <instancedBufferAttribute
          attach="instanceColor"
          args={[colorBuffer, 3]}
        />
      </instancedMesh>

      {cfg.isHumanoid && (
        <>
          <instancedMesh
            ref={armLRef}
            args={[baseGeo, baseMat, max]}
            frustumCulled={false}
            castShadow
          >
            <instancedBufferAttribute
              attach="instanceColor"
              args={[colorBuffer, 3]}
            />
          </instancedMesh>
          <instancedMesh
            ref={armRRef}
            args={[baseGeo, baseMat, max]}
            frustumCulled={false}
            castShadow
          >
            <instancedBufferAttribute
              attach="instanceColor"
              args={[colorBuffer, 3]}
            />
          </instancedMesh>
          <instancedMesh
            ref={legLRef}
            args={[baseGeo, baseMat, max]}
            frustumCulled={false}
            castShadow
          >
            <instancedBufferAttribute
              attach="instanceColor"
              args={[colorBuffer, 3]}
            />
          </instancedMesh>
          <instancedMesh
            ref={legRRef}
            args={[baseGeo, baseMat, max]}
            frustumCulled={false}
            castShadow
          >
            <instancedBufferAttribute
              attach="instanceColor"
              args={[colorBuffer, 3]}
            />
          </instancedMesh>
        </>
      )}
    </group>
  );
};
