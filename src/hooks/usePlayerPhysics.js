import { useFrame } from '@react-three/fiber';




import { useRapier } from '@react-three/rapier';
import { GlobalRegistry } from '../registry/Registry';
import { EventBus } from '../utils/EventBus';
import { BlockKeyById, BlockRegistry } from '../registry/BlockRegistry';
import { playerLastSafePosition } from '../globals';

const _direction = new Vector3();
const _rayUpDir = { x: 0, y: 1, z: 0 };
const _frontVector = new Vector3();
const _sideVector = new Vector3();
const _grappleTarget = new Vector3();
const _grappleCamPosDist = new Vector3();
const _grappleCamPos = new Vector3();
const _grapplePullDir = new Vector3();
const SPEED = 8;
const _grappleFinalVel = new Vector3();
const MAX_ALLOWED_VELOCITY = 200;
const _intendedDirection = new Vector3();
let _intendedSpeedY = 0;
const _rayOrigin = { x: 0, y: 0, z: 0 };

// FAIL FAST & LOUD
function assertFinite3(vec, context) {
  if (!Number.isFinite(vec.x) || !Number.isFinite(vec.y) || !Number.isFinite(vec.z)) {
    throw new Error(`[Assert] NaN/Infinity Vector detected in ${context}: x=${vec.x}, y=${vec.y}, z=${vec.z}`);
  }
}

const playerSafeStack = [];

const _rayDir = { x: 0, y: -1, z: 0 };
let _intendedJump = false;
const JUMP_FORCE = 12;
const _seatEuler = new Euler();
const _seatOffsetVec = new Vector3();
const _camPos = new Vector3();
const _targetCamPos = new Vector3();
const _camDir = new Vector3();
const _seatQuat = new Quaternion();

import { useBeforePhysicsStep } from '@react-three/rapier';
import { useRef, useEffect, useState, useMemo } from 'react';
import { Vector3, Euler, Quaternion } from 'three';
import { useStore } from '../stores/useStore';
import { useUIStore } from '../stores/useUIStore';
import { useChunkStore } from '../stores/chunkSlice';
import { networkActions } from '../stores/networkActions';
import { getIndex, getTextureId, getIsHidden, CHUNK_Y_MIN, CHUNK_Y_MAX } from '../utils/chunkData';
import { playerPosition, playerRotation, ServerTickMetrics, shipTransforms } from '../globals';

export function usePlayerPhysics(playerRef, meshRef, camera, actionsRef) {
  const [isFlying, setIsFlying] = useState(false);
  const isSeated = useStore(state => state.isSeated);
      const lastIntentRef = useRef(null);
  const processedDamageRef = useRef(new Set());
  const isTeleporting = useRef(false);
  const lastJump = useRef(0);
  const lastGrappleReelTime = useRef(0);
  const lastStep = useRef(0);
  const lastLavaDamage = useRef(0);
  const [initialPos] = useState(() => {
    const p = [playerPosition.x, playerPosition.y, playerPosition.z];
    return [p[0], p[1] === 160 ? 160 : p[1] + 1.5, p[2]]; // Bump up to avoid clipping into floor on load
  });
  const hasSnappedToGround = useRef((() => {
    const initialY = playerPosition.y;
    return initialY < 160;
  })());

  const wasGrounded = useRef(true);
  const fallSpeed = useRef(0);
  const frameCounter = useRef(0);
  const wasSeated = useRef(false);

  // RPG Systems Simulation Refs (Tick-based)
  const tickCount = useRef(0);
  const idleTicks = useRef(0);
  const zeroPowerTicks = useRef(0);
  const sprintTicks = useRef(0);

  // Handle flying and dismounting
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!document.pointerLockElement) return;
      const state = useStore.getState();
      
      // Dismount logic
      if (e.code === 'KeyF' && state.isSeated) {
          if (state.isTransitMode) {
              networkActions.getState().addChatMessage('> CANNOT DISMOUNT DURING WARP TRANSIT', 'system', 'System');
              return;
          }
          // Request Release Helm if we had it
          const netState = networkActions.getState();
          if (state.shipHelmPlayerId === netState.playerId) {
             const intent = { type: 'RELEASE_HELM', playerId: netState.playerId };
             netState.broadcastEvent(intent);
             if (netState.isHost) {
                 netState.handleNetworkData(intent);
             }
          }
          
          const shipTransform = shipTransforms.get('default');
          if (shipTransform) {
              const posToUse = shipTransform.actualPosition || shipTransform.position;
              useStore.setState({ isSeated: false, forceTeleportPos: [posToUse.x, posToUse.y + 2, posToUse.z] });
          } else {
              useStore.setState({ isSeated: false });
          }
          return;
      }
      
      // Toggle flying with F key (only if not seated)
      if (e.code === 'KeyF' && !state.isSeated) {
        setIsFlying((prev) => !prev);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const { rapier, world } = useRapier();

  const physicsCachedRay = useRef(null);
  const uiCachedRay = useRef(null);
  useEffect(() => {
    if (rapier) {
      if (!physicsCachedRay.current) physicsCachedRay.current = new rapier.Ray({x:0, y:0, z:0}, {x:0, y:-1, z:0});
      if (!uiCachedRay.current) uiCachedRay.current = new rapier.Ray({x:0, y:0, z:0}, {x:0, y:-1, z:0});
    }
  }, [rapier]);
  const getUiCachedRay = (origin, dir) => {
    const r = uiCachedRay.current;
    if (!r) return null;
    r.origin.x = origin.x; r.origin.y = origin.y; r.origin.z = origin.z;
    r.dir.x = dir.x; r.dir.y = dir.y; r.dir.z = dir.z;
    return r;
  };

  useEffect(() => {
    const handleForceTeleport = (e) => {
        window.__forceLocalTeleportPos = e.detail;
    };
    window.addEventListener('FORCE_LOCAL_TELEPORT', handleForceTeleport);
    return () => window.removeEventListener('FORCE_LOCAL_TELEPORT', handleForceTeleport);
  }, []);

  useEffect(() => {
    // Also save on window unload
    const handleUnload = () => {
      if (playerRef.current) {
        const trans = playerRef.current.translation();
        useStore.getState().ejectTableGrid();
        useStore
          .getState()
          .savePlayerState([trans.x, trans.y, trans.z], [0, 0, 0, 1]);
      }
    };
    window.addEventListener('beforeunload', handleUnload);

    // Watch for Respawn events
    const unsub = useStore.subscribe(
      (state) => state.isDead,
      (isDead, prevIsDead) => {
        if (!isDead && prevIsDead && playerRef.current) {
          // Player just respawned! Teleport the physical body.
          playerRef.current.setTranslation(
            { x: playerPosition.x, y: playerPosition.y, z: playerPosition.z },
            true
          );
          playerRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
          hasSnappedToGround.current = false; // Snap them to ground when they respawn at 160
        } else if (isDead && !prevIsDead) {
          // DEATH SEQUENCE DESYNC FIX
          const state = useStore.getState();
          if (state.isSeated) {
              const netState = networkActions.getState();
              if (state.shipHelmPlayerId === netState.playerId) {
                  const intent = { type: 'RELEASE_HELM', playerId: netState.playerId };
                  netState.broadcastEvent(intent);
                  if (netState.isHost) netState.handleNetworkData(intent);
              }
              useStore.setState({ isSeated: false });
          }
        }
      }
    );



    // Watch for force teleport requests (e.g. command teleports or rubber-banding)
    const unsubForcePos = useStore.subscribe(
      (state) => state.forceTeleportPos,
      (pos) => {
        if (pos && playerRef.current) {
          playerRef.current.setTranslation(
            { x: pos[0], y: pos[1], z: pos[2] },
            true
          );
          playerRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
          isTeleporting.current = false;
          if (pos[1] === 260) {
            hasSnappedToGround.current = false; // Respawn safe snap
          } else {
            hasSnappedToGround.current = true; // Normal teleport
          }
          // Reset the store's forceTeleportPos back to null so we can detect subsequent teleports to the same coordinate
          useStore.setState({ forceTeleportPos: null });
        }
      }
    );

    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      unsub();
      unsubForcePos();
    };
  }, []);

  const lastFired = useRef(0);

  // Handle weapon firing — read from store.getState() to always get latest values
  useEffect(() => {
    const handleMouseDown = () => {
      if (!document.pointerLockElement) return;
      const state = useStore.getState();
      if (useUIStore.getState().getAnyUIOpen()) return;

      const { texture, addLaser, swingSword } = state;
      const networkStore = networkActions.getState();
      const registryItem = GlobalRegistry[texture];
      const combatStats = registryItem?.combat;

      const dir = new Vector3();
      camera.getWorldDirection(dir);
      const trans = playerRef.current.translation();
      const origin = new Vector3(trans.x, trans.y + 0.8, trans.z);

      // RPG: Check Action Costs
      let powerCost = 0;
      if (texture === 'gauss_rifle') powerCost = 20;
      else if (texture === 'sword') powerCost = 2;
      else if (['pickaxe', 'axe', 'shovel'].includes(texture)) powerCost = 0.5;

      if (powerCost > 0 && state.playerPower < powerCost && state.gameMode?.toLowerCase() !== 'creative') {
        networkStore.addChatMessage('> INSUFFICIENT POWER FOR OPERATION', 'system', 'System');
        return; // Fail action
      }

      if (powerCost > 0) {
        state.drainPower(powerCost);
        idleTicks.current = 0;
      }

      // Dispatch Intent to Host if it's a combat tool or repair tool
      if (combatStats) {
        const type = texture === 'repair_tool' ? 'REPAIR_INTENT' : 'ATTACK_INTENT';
        const intent = {
          type,
          weaponId: texture,
          dir: [dir.x, dir.y, dir.z],
          origin: [origin.x, origin.y, origin.z],
        };
        networkStore.broadcastEvent(intent);

        if (networkStore.isHost) {
          networkStore.handleNetworkData(intent, {
            metadata: { playerId: networkStore.playerId },
          });
        }
      }

      if (texture === 'gun') {
        // Client Prediction: Gun sound handled by SFXManager locally based on intent
      } else if (texture === 'gauss_rifle') {
        const cooldownMs = combatStats?.cooldown ?? 1500;
        if (Date.now() - lastFired.current < cooldownMs) return; // Sniper Cooldown
        lastFired.current = Date.now();

        // Client Prediction (Visual Only Raycast)
        const startPos = origin.clone().addScaledVector(dir, 0.45);
        const hit = world.castRay(getUiCachedRay({x: startPos.x, y: startPos.y, z: startPos.z}, {x: dir.x, y: dir.y, z: dir.z}), 200, false);
        let endPos = startPos.clone().addScaledVector(dir, 200);
        if (hit) endPos = startPos.clone().addScaledVector(dir, (hit.toi ?? hit.timeOfImpact));

        const visualStart = origin
          .clone()
          .addScaledVector(dir, 0.5) // Forward
          .addScaledVector(camera.up, -0.2) // Down
          .addScaledVector(dir.clone().cross(camera.up).normalize(), 0.3); // Right

        addLaser(
          [visualStart.x, visualStart.y, visualStart.z],
          [endPos.x, endPos.y, endPos.z]
        );
      } else if (texture === 'grapple') {
        if (state.grappleTarget) {
          // Detach instantly if already grappling
          state.setGrappleTarget(null);

          // The Slingshot Vault mechanic
          if (playerRef.current) {
            const linvel = playerRef.current.linvel();
            // Dampen horizontal speed by 50% and boost vertical for a smooth vault
            playerRef.current.setLinvel(
              {
                x: linvel.x * 0.5,
                y: Math.max(linvel.y * 0.5, 12),
                z: linvel.z * 0.5,
              },
              true
            );
          }
          return;
        }

        const startPos = origin.clone().addScaledVector(dir, 0.45);
        
        // Raycast max 50 blocks
        const hit = world.castRay(
           getUiCachedRay({x: startPos.x, y: startPos.y, z: startPos.z}, {x: dir.x, y: dir.y, z: dir.z}),
           50, false
        );

        if (hit) {
          const hitTime = (hit.toi ?? hit.timeOfImpact);
          const endPos = startPos.clone().addScaledVector(dir, hitTime);
          if (Number.isFinite(endPos.x)) {
            state.setGrappleTarget([endPos.x, endPos.y, endPos.z]);
            EventBus.emit('audio', { sound: 'grapple_shoot', source: 'local' });
          }
        }
      } else if (texture === 'sword') {
        // Client Prediction
        swingSword(1);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [world, rapier, camera]);

  const accumulator = useRef(0);
  const lastTickTime = useRef(null);

  

  const context = { lastIntentRef, processedDamageRef, isTeleporting, lastJump, lastGrappleReelTime, lastStep, lastLavaDamage, hasSnappedToGround, setIsFlying, wasGrounded, fallSpeed, frameCounter, wasSeated, tickCount, idleTicks, zeroPowerTicks, sprintTicks, physicsCachedRay, lastFired, accumulator, lastTickTime };
  useBeforePhysicsStep((world) => runFixedTick(world, playerRef, meshRef, camera, actionsRef, isFlying, isSeated, initialPos, context));

  useFrame((state, delta) => runVisualTick(state, delta, playerRef, meshRef, camera, actionsRef, isFlying, isSeated, initialPos, context));

    return { isFlying, isSeated, initialPos };
}

function runFixedTick(world, playerRef, meshRef, camera, actionsRef, isFlying, isSeated, initialPos, context) {
  const { lastIntentRef, processedDamageRef, isTeleporting, lastJump, lastGrappleReelTime, lastStep, lastLavaDamage, hasSnappedToGround, setIsFlying, wasGrounded, fallSpeed, frameCounter, wasSeated, tickCount, idleTicks, zeroPowerTicks, sprintTicks, physicsCachedRay, lastFired, accumulator, lastTickTime } = context;
    if (!playerRef.current) return;
    if (lastTickTime.current === null) lastTickTime.current = performance.now();
    
    if (wasSeated.current && !isSeated) {
        playerRef.current.setBodyType(0, true);
        const currentTransform = shipTransforms.get('default');
        if (currentTransform && currentTransform.actualVelocity) {
            playerRef.current.setLinvel({
                x: currentTransform.actualVelocity.x,
                y: currentTransform.actualVelocity.y,
                z: currentTransform.actualVelocity.z
            }, true);
        }
    } else if (isSeated) {
        if (!wasSeated.current) {
            playerRef.current.setBodyType(2, true);
        }
        const shipTransform = shipTransforms.get('default');
        if (shipTransform) {
            const localOffset = useStore.getState().seatOffset || [0, 0, -3];
            _seatEuler.fromArray([shipTransform.rotation.x, shipTransform.rotation.y, shipTransform.rotation.z]);
            _seatOffsetVec.set(localOffset[0], localOffset[1] + 1.4, localOffset[2]).applyEuler(_seatEuler);
              const newPos = {
                  x: shipTransform.position.x + _seatOffsetVec.x,
                  y: shipTransform.position.y + _seatOffsetVec.y,
                  z: shipTransform.position.z + _seatOffsetVec.z
              };
              try {
                  playerRef.current.setNextKinematicTranslation(newPos);
              } catch (e) {
                  playerRef.current.setTranslation(newPos, true);
              }
        }
    }
    wasSeated.current = isSeated;
    const now = performance.now();
    const delta = now - lastTickTime.current;
    lastTickTime.current = now;
    
    accumulator.current += delta;
    const TICK_TIME = 1000 / (ServerTickMetrics.tps || 20);

    let ticksThisFrame = 0;
    while (accumulator.current >= TICK_TIME && ticksThisFrame < 10) {
      let startMSPT = performance.now();
      corePhysicsStep(world, playerRef, meshRef, camera, actionsRef, isFlying, isSeated, initialPos, context);
      ServerTickMetrics.mspt = performance.now() - startMSPT;
      accumulator.current -= TICK_TIME;
      ticksThisFrame++;
    }
    if (ticksThisFrame >= 10) accumulator.current = 0;
}

function runVisualTick(state, delta, playerRef, meshRef, camera, actionsRef, isFlying, isSeated, initialPos, context) {
  const { lastIntentRef, processedDamageRef, isTeleporting, lastJump, lastGrappleReelTime, lastStep, lastLavaDamage, hasSnappedToGround, setIsFlying, wasGrounded, fallSpeed, frameCounter, wasSeated, tickCount, idleTicks, zeroPowerTicks, sprintTicks, cachedRay, lastFired, accumulator, lastTickTime } = context;
    // Poll Keyboard & Steer Vectors at 144Hz
    const storeState = useStore.getState();
    const isCreative = storeState.gameMode?.toLowerCase() === 'creative';
    
/* Input vectors calculated in corePhysicsStep to avoid 1-frame latency */

    if (!meshRef.current) return;
    meshRef.current.getWorldPosition(_camPos);
    
    if (storeState.isSeated) {
        const shipTransform = shipTransforms.get('default');
        if (shipTransform) {
            const localOffset = storeState.seatOffset || [0, 0, -3];
            if (shipTransform.actualQuaternion) {
                _seatQuat.set(shipTransform.actualQuaternion.x, shipTransform.actualQuaternion.y, shipTransform.actualQuaternion.z, shipTransform.actualQuaternion.w);
                _seatEuler.setFromQuaternion(_seatQuat);
            } else {
                _seatEuler.fromArray([shipTransform.rotation.x, shipTransform.rotation.y, shipTransform.rotation.z]);
            }
            _seatOffsetVec.set(localOffset[0], localOffset[1] + 1.4, localOffset[2]).applyEuler(_seatEuler);
            
            const posToUse = shipTransform.actualPosition || shipTransform.position;
            _camPos.set(
               posToUse.x + _seatOffsetVec.x,
               posToUse.y + _seatOffsetVec.y,
               posToUse.z + _seatOffsetVec.z
            );
        }
    }

    // Mathematically interpolate the camera to chase the 60Hz physics body
    // This perfectly replaces the buggy `interpolate={true}` prop!
    const lerpFactor = Math.min(1.0, delta * 20.0);
    _targetCamPos.copy(_camPos);
    _targetCamPos.y += 0.6;
    
    if (storeState.isSeated) {
        camera.getWorldDirection(_camDir);
        _targetCamPos.addScaledVector(_camDir, -15);
        _targetCamPos.y += 5;
        // Basic clipping protection
        if (_targetCamPos.y < _camPos.y + 0.6) {
            _targetCamPos.y = _camPos.y + 0.6;
        }
    }
    if (storeState.isSeated && Number.isFinite(_targetCamPos.x)) {
        camera.position.copy(_targetCamPos);
    } else if (Number.isFinite(_targetCamPos.x) && Number.isFinite(_targetCamPos.y) && Number.isFinite(_targetCamPos.z) && Number.isFinite(lerpFactor)) {
        camera.position.x += (_targetCamPos.x - camera.position.x) * lerpFactor;
        camera.position.y += (_targetCamPos.y - camera.position.y) * lerpFactor;
        camera.position.z += (_targetCamPos.z - camera.position.z) * lerpFactor;
    }
}

function corePhysicsStep(world, playerRef, meshRef, camera, actionsRef, isFlying, isSeated, initialPos, context) {
    const { jump, sprint, moveForward, moveBackward, moveLeft, moveRight } = actionsRef.current;
  const { lastIntentRef, processedDamageRef, isTeleporting, lastJump, lastGrappleReelTime, lastStep, lastLavaDamage, hasSnappedToGround, setIsFlying, wasGrounded, fallSpeed, frameCounter, tickCount, idleTicks, zeroPowerTicks, sprintTicks, physicsCachedRay, lastFired } = context;
  const getPhysicsCachedRay = (origin, dir) => {
    const r = physicsCachedRay.current;
    if (!r) return null;
    r.origin.x = origin.x; r.origin.y = origin.y; r.origin.z = origin.z;
    r.dir.x = dir.x; r.dir.y = dir.y; r.dir.z = dir.z;
    return r;
  };


    if (!playerRef.current) return;
    const state = useStore.getState();
    if (state.isDead) return;

    tickCount.current++;
    const isCreative = state.gameMode?.toLowerCase() === 'creative';

    let currentSpeed = SPEED;
    if (sprint) {
      if (state.playerPower > 0 || isCreative) {
        currentSpeed = SPEED * 1.6;
      } else {
        currentSpeed = SPEED * 0.7;
      }
    } else if (!isCreative && state.playerPower <= 0) {
      currentSpeed = SPEED * 0.7;
    }
    if (isFlying) currentSpeed *= 3;

    _frontVector.set(0, 0, -1);
    _frontVector.applyQuaternion(camera.quaternion);
    _frontVector.y = 0;
    _frontVector.normalize();
    _sideVector.copy(_frontVector).cross(camera.up).normalize();

    _direction.set(0, 0, 0);
    if (moveForward) _direction.add(_frontVector);
    if (moveBackward) _direction.sub(_frontVector);
    if (moveRight) _direction.add(_sideVector);
    if (moveLeft) _direction.sub(_sideVector);

    _intendedDirection.copy(_direction.normalize().multiplyScalar(currentSpeed));
    _intendedJump = jump;
    
    if (state.isSeated) {
      _intendedDirection.set(0, 0, 0); // No walking off the helm
      _intendedJump = false;
      
      // Keep player physics body out of the way of the moving ship to prevent explosive collisions
      if (playerRef.current) {
          const currentPos = playerRef.current.translation();
          if (currentPos.y < 9000) {
              playerRef.current.setTranslation({ x: 0, y: 10000, z: 0 }, true);
              playerRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
          }
      }

      const newIntent = `${moveForward}|${moveBackward}|${moveLeft}|${moveRight}|${jump}|${sprint}`;
      if (lastIntentRef.current !== newIntent) {
        lastIntentRef.current = newIntent;
        networkActions.getState().broadcastEvent({
           type: 'SHIP_STEER_INTENT',
           forward: moveForward,
           backward: moveBackward,
           left: moveLeft,
           right: moveRight,
           jump: jump,
           sprint: sprint
        });
        // also send to self if host
        if (networkActions.getState().isHost) {
           networkActions.getState().handleNetworkData({
              type: 'SHIP_STEER_INTENT',
              forward: moveForward,
              backward: moveBackward,
              left: moveLeft,
              right: moveRight,
              jump: jump,
              sprint: sprint
           }, { metadata: { playerId: networkActions.getState().playerId } });
        }
      }
    } else {
      if (lastIntentRef.current !== null) {
        lastIntentRef.current = null;
        const stopIntent = { type: 'SHIP_STEER_INTENT', forward: false, backward: false, left: false, right: false, jump: false, sprint: false };
        networkActions.getState().broadcastEvent(stopIntent);
        if (networkActions.getState().isHost) {
           networkActions.getState().handleNetworkData(stopIntent, { metadata: { playerId: networkActions.getState().playerId } });
        }
      }
    }
    
    if (isFlying) {
      if (jump) _intendedSpeedY = currentSpeed;
      else if (sprint) _intendedSpeedY = -currentSpeed;
      else _intendedSpeedY = 0;
    }


    const RPG_TICK = 1000 / 20; // 20Hz
    if (!window.__rpgAccumulator) window.__rpgAccumulator = 0;
    if (!window.__lastRpgTick) window.__lastRpgTick = performance.now();
    const now = performance.now();
    window.__rpgAccumulator += (now - window.__lastRpgTick);
    window.__lastRpgTick = now;
    
    if (window.__rpgAccumulator >= RPG_TICK) {
        window.__rpgAccumulator -= RPG_TICK;
    // RPG Game Loop
    if (!isCreative && state.hasLoadedState && state.isWorldReady) {
      const { playerPower, playerMaxPower, playerMana, playerMaxMana } = state;

      // 1. Idle Tracking
      if (_direction.lengthSq() > 0.01 || jump || sprint) {
        idleTicks.current = 0;
      } else {
        idleTicks.current++;
      }
      const isIdle = idleTicks.current > 60; // 3 seconds = 60 ticks

      // 2. Mana Regen (+1 per 5s = 100 ticks)
      if (tickCount.current % 100 === 0) {
        if (playerMana < playerMaxMana) state.rechargeMana(1);
      }

      // 3. Power Drain & Soft Regen (Passive drain -1 / 10s = 200 ticks)
      if (tickCount.current % 200 === 0) {
        if (!state.authoritativeSkills?.includes('efficiency_1')) {
          state.drainPower(1);
        }
      }

      // Emergency Idle Regen (Up to 20%)
      if (isIdle && playerPower < playerMaxPower * 0.2) {
        if (idleTicks.current % 20 === 0) { // Fast regen while completely idle (1 power / 1s = 20 ticks)
          state.rechargePower(1);
        }
      }

      // 4. Core Meltdown (Health Drain)
      if (playerPower <= 0) {
        zeroPowerTicks.current++;
        
        if (zeroPowerTicks.current > 80) { // 4s grace period = 80 ticks
          if ((zeroPowerTicks.current - 80) % 20 === 0) { // -2 HP / sec (20 ticks)
            state.damagePlayer(2);
          }
          if ((zeroPowerTicks.current - 80) % 300 === 0) { // Alarm only once every 15s (300 ticks)
            networkActions.getState().addChatMessage('> [ALARM] CORE MELTDOWN: SYSTEM INTEGRITY COMPROMISED', 'system', 'System');
          }
        }
      } else {
        zeroPowerTicks.current = 0;
      }
    }
    } // End RPG Accumulator

    const translation = playerRef.current.translation();
    let linvel = playerRef.current.linvel();

    // 1. Fail Fast & Loud Boundary Assertion
    assertFinite3(translation, "usePlayerPhysics Tick Start - Translation");
    assertFinite3(linvel, "usePlayerPhysics Tick Start - Linvel");

    // Update shared global for AI / ChunkManager
    playerPosition.set(translation.x, translation.y, translation.z);
    playerRotation.copy(camera.rotation);

    const shipTransform = shipTransforms.get('default');
    if (state.isSeated && shipTransform) {
      // RIGIDBODY ABANDONMENT FIX: Capsule movement is now handled in useBeforePhysicsStep
      // Skip normal walking/gravity logic!
      playerRef.current.setGravityScale(0, true); // Ensure gravity is 0 even if transition to kinematic is delayed
      return; 
    }

    // Process Area Damage (Explosions)
    if (state.damageQueue.length > 0) {
      state.damageQueue.forEach((req) => {
        if (processedDamageRef.current.has(req.id)) return;
        processedDamageRef.current.add(req.id);

        if (req.sourceId === networkActions.getState().playerId) return;

        const distSq =
          Math.pow(translation.x - req.pos[0], 2) +
          Math.pow(translation.y - req.pos[1], 2) +
          Math.pow(translation.z - req.pos[2], 2);
        if (distSq <= req.radius * req.radius) {
          state.damagePlayer(req.amount);
        }
      });
      for (const id of processedDamageRef.current) {
        if (!state.damageQueue.some(req => req.id === id)) {
          processedDamageRef.current.delete(id);
        }
      }
    } else if (processedDamageRef.current.size > 0) {
      // No pending damage — clear all processed IDs without allocating sets
      processedDamageRef.current.clear();
    }

    if (!state.isWorldReady) {
      // Freeze movement and completely prevent gravity from sinking the player during loading screen
      playerRef.current.setTranslation(
        { x: initialPos[0], y: initialPos[1], z: initialPos[2] },
        true
      );
      playerRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
      return;
    }

    if (isTeleporting.current) return;

    if (!hasSnappedToGround.current) {
      // Freeze player until we find the ground via the safe spawn scanner
      playerRef.current.setTranslation(
        { x: translation.x, y: translation.y > 380 ? initialPos[1] : translation.y, z: translation.z },
        true
      );
      playerRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
      playerRef.current.setGravityScale(0, true);

      // Calculate the precise highest solid block at our (X, Z) coordinate!
      const safeY = state.findSafeSpawnY(translation.x, translation.z);
      if (safeY !== 400) {
        if (safeY === -999) {
          // Column is completely empty (e.g. over the void). Just drop them.
          playerRef.current.setGravityScale(1, true);
          hasSnappedToGround.current = true;
          return;
        }

        // Data says ground is here! Teleport them safely above the ground.
        // The block's top face is at `safeY + 1`. The capsule half-height is `0.8`.
        // So we must spawn them at `safeY + 1.8` or higher to avoid penetration!
        playerRef.current.setTranslation(
          { x: translation.x, y: safeY + 2.5, z: translation.z },
          true
        );

        // CRITICAL: Prevent Spawn Clipping!
        // The data exists, but the Rapier physics Trimesh might still be calculating in WASM.
        // We must cast a ray down. If it hits nothing, the physics floor is not ready yet!
        // Shift the ray X and Z by 0.5 so it hits the center of the block face, avoiding edge/vertex raycast misses!
        const rayOrigin = {
          x: Math.floor(translation.x) + 0.5,
          y: safeY + 2.5,
          z: Math.floor(translation.z) + 0.5,
        };
        const rayDir = { x: 0, y: -1, z: 0 };
        const groundHit = world.castRay(
          getPhysicsCachedRay(rayOrigin, rayDir),
          4.0,
          false
        );

        if (groundHit) {
          // Physics floor is confirmed loaded!
          playerRef.current.setGravityScale(1, true);
          hasSnappedToGround.current = true;
          // Prevent 1-frame sky blink by instantly synchronizing the camera
          camera.position.set(translation.x, safeY + 3.1, translation.z);
        }
        // If the ray missed, but we KNOW there's a block here (safeY !== -999),
        // it means the physics collider is still loading! We must WAIT!
        // Do NOT drop them yet!
      }
      return;
    }

    // Safety floor below bedrock (or physics NaN glitch) - catches player if they fall out of the world

    // Safety floor below bedrock (or physics NaN glitch) — catches player if they fall out of the world
    if (translation.y < CHUNK_Y_MIN - 10 && !Number.isNaN(translation.y)) {
      // Void Death!
      if (state.isWorldReady && !state.isDead) {
        state.damagePlayer(1000); // Instant kill
      }
      return;
    }



    if (useUIStore.getState().getAnyUIOpen()) {
      // Freeze horizontal movement, allow gravity
      const linvel = playerRef.current.linvel();
      playerRef.current.setLinvel({ x: 0, y: linvel.y, z: 0 }, true);
      return;
    }

    // Occasional raycast straight up to check for weather/audio occlusion
    frameCounter.current++;
    if (frameCounter.current % 15 === 0) {
      const hit = world.castRay(
        getPhysicsCachedRay(
          { x: translation.x, y: translation.y + 0.8, z: translation.z },
          _rayUpDir
        ),
        100,
        false
      );
      const isUnderground = hit !== null;
      if (state.isUnderground !== isUnderground) {
        state.setIsUnderground(isUnderground);
      }
    }

    // Liquid Detection
    let isInLiquid = false;
    let liquidDamage = 0;
    let currentLiquid = null;

    const pcx = Math.floor(translation.x / 16);
    const pcz = Math.floor(translation.z / 16);
    const pChunk = useChunkStore.getState().chunks[`${pcx},${pcz}`];

    if (pChunk && pChunk.buffer) {
      const bx = Math.floor(translation.x);
      const by1 = Math.floor(translation.y - 0.4);
      const by2 = Math.floor(translation.y + 0.8);
      const bz = Math.floor(translation.z);

      const lx = ((bx % 16) + 16) % 16;
      const lz = ((bz % 16) + 16) % 16;

      const checkBlockSubLiquid = (ly, capsuleMinY) => {
        if (ly >= CHUNK_Y_MIN && ly <= CHUNK_Y_MAX) {
          const val = pChunk.buffer[getIndex(lx, ly, lz)];
          if (val !== 0 && !getIsHidden(val)) {
            const tex = getTextureId(val);
            const blockName = BlockKeyById[tex];
            const blockDef = BlockRegistry[blockName];
            if (blockDef?.isLiquid) {
              const level = (val >> 17) & 0xf;
              const fluidTopY = ly + (level / 15.0);
              if (capsuleMinY < fluidTopY) {
                isInLiquid = true;
                currentLiquid = blockName;
                if (blockDef.damagePerTick) {
                  liquidDamage = blockDef.damagePerTick;
                }
              }
            }
          }
        }
      };

      const capsuleBottom = translation.y - 0.4;
      checkBlockSubLiquid(by1, capsuleBottom);
      checkBlockSubLiquid(by2, capsuleBottom);

      if (state.submergedLiquid !== currentLiquid) {
        state.setSubmergedLiquid(currentLiquid);
      }
    } else {
      if (state.submergedLiquid) {
        state.setSubmergedLiquid(null);
      }
    }
    
    // Process local forced teleports (from warp mass teleports)
    if (window.__forceLocalTeleportPos && playerRef.current) {
        playerRef.current.setTranslation({
           x: window.__forceLocalTeleportPos[0],
           y: window.__forceLocalTeleportPos[1],
           z: window.__forceLocalTeleportPos[2]
        }, true);
        window.__forceLocalTeleportPos = null;
    }

    // Movement
    camera.getWorldDirection(_frontVector);
    _frontVector.y = 0;
    _frontVector.normalize();

    _sideVector.copy(_frontVector).cross(camera.up).normalize();

    if (sprint) {
      if (state.playerPower > 0 || isCreative) {
        if (!isCreative) {
          sprintTicks.current++;
          if (sprintTicks.current >= 30) { // Drain 1 power every 1.5s (30 ticks) of sprinting
            state.drainPower(1);
            sprintTicks.current = 0;
          }
        }
      } else {
        // Exhausted
        sprintTicks.current = 0;
      }
    } else {
      sprintTicks.current = 0;
    }

    // Grapple Physics Override (Hybrid Momentum-Retaining Pull)
    if (state.grappleTarget) {
      if (state.texture !== 'grapple') {
        state.setGrappleTarget(null);
      } else {
        _grappleTarget.set(
          state.grappleTarget[0],
          state.grappleTarget[1],
          state.grappleTarget[2]
        );
        const trans = playerRef.current.translation();
        _grappleCamPosDist.set(trans.x, trans.y + 0.8, trans.z);
        const dist = _grappleTarget.distanceTo(_grappleCamPosDist);

        if (dist < 0.8) {
          state.setGrappleTarget(null);
        } else {
          camera.getWorldPosition(_grappleCamPos);
          _grapplePullDir.copy(_grappleTarget).sub(_grappleCamPosDist).normalize();
          const speedMultiplier = Math.min(1.0, (dist - 0.8) / 10.0);
          const currentGrappleSpeed = 30 * Math.max(0.3, speedMultiplier);

          if (Date.now() - lastGrappleReelTime.current > 1000) {
            EventBus.emit('audio', { sound: 'grapple_reel', source: 'local' });
            lastGrappleReelTime.current = Date.now();
          }

          // Standard WASD steering on orthogonal plane
          _frontVector.set(0, 0, moveBackward - moveForward);
          _sideVector.set(moveLeft - moveRight, 0, 0);
          _direction
            .subVectors(_frontVector, _sideVector)
            .normalize()
            .multiplyScalar(SPEED * 0.8)
            .applyEuler(camera.rotation);
          _direction.y = 0; // Zero out vertical input steering

          // Combine pull and steering
          _grappleFinalVel.set(
            _grapplePullDir.x * currentGrappleSpeed + _direction.x,
            _grapplePullDir.y * currentGrappleSpeed,
            _grapplePullDir.z * currentGrappleSpeed + _direction.z
          );

          // Velocity Clamping
          const speed = _grappleFinalVel.length();
          if (speed > MAX_ALLOWED_VELOCITY) {
            _grappleFinalVel.multiplyScalar(MAX_ALLOWED_VELOCITY / speed);
          }

          assertFinite3(_grappleFinalVel, "playerRef setLinvel");
      playerRef.current.setLinvel(_grappleFinalVel, true);
          playerRef.current.setGravityScale(0, true);
        }

        // We still need to update position globals so audio/raycasts work
        const pPos = playerRef.current.translation();
        playerPosition.set(pPos.x, pPos.y, pPos.z);
        return; // Skip normal walking logic
      }
    }

    if (isInLiquid && !isFlying) {
      const liquidPenalty = liquidDamage > 0 ? 0.25 : 0.5; // Viscosity is thicker in dangerous liquids (Lava/Acid)
      _intendedDirection.x *= liquidPenalty;
      _intendedDirection.z *= liquidPenalty;
      playerRef.current.setGravityScale(liquidDamage > 0 ? 0.05 : 0.1, true); // Slower sinking
      if (liquidDamage > 0 && Date.now() - lastLavaDamage.current > 500) {
        state.damagePlayer(liquidDamage);
        lastLavaDamage.current = Date.now();
      }
    } else {
      playerRef.current.setGravityScale(isFlying || isSeated ? 0 : 1, true);
    }

    linvel = playerRef.current.linvel();

    if (isFlying || isSeated) {
      playerRef.current.setLinvel(
        { x: _intendedDirection.x, y: _intendedSpeedY, z: _intendedDirection.z },
        true
      );
    } else {
      // Normal walking: preserve gravity Y velocity
      playerRef.current.setLinvel(
        { x: _intendedDirection.x, y: linvel.y, z: _intendedDirection.z },
        true
      );
    }

    let isGrounded = false;
    const offsets = [
      [0, 0],
      [0.3, 0],
      [-0.3, 0],
      [0, 0.3],
      [0, -0.3],
    ];
    for (const [ox, oz] of offsets) {
      _rayOrigin.x = translation.x + ox;
      _rayOrigin.y = translation.y - 0.75; // Start inside the capsule slightly above the bottom (bottom is 0.8)
      _rayOrigin.z = translation.z + oz;
      const groundHit = world.castRay(
        getPhysicsCachedRay(_rayOrigin, _rayDir),
        0.4,
        false,
        0x00010011
      );
      if (groundHit) {
        isGrounded = true;
        playerLastSafePosition.set(translation.x, translation.y, translation.z);
        break;
      }
    }

    if (isGrounded && !wasGrounded.current && fallSpeed.current < -8) {
      EventBus.emit('audio', { sound: 'land', source: 'local' });
    }
    wasGrounded.current = isGrounded;
    if (!isGrounded) fallSpeed.current = linvel.y;

    if (isGrounded && !isFlying && Number.isFinite(translation.x) && Number.isFinite(translation.y) && Number.isFinite(translation.z)) {
      if (false) /* removed global assign */ [];
      const stack = playerSafeStack;
      const last = stack[stack.length - 1];
      if (!last || Math.pow(translation.x - last[0], 2) + Math.pow(translation.y - last[1], 2) + Math.pow(translation.z - last[2], 2) > 4) {
          stack.push([translation.x, translation.y, translation.z]);
          if (stack.length > 3) stack.shift();
      }
    }

    if (
      isGrounded &&
      _intendedDirection.lengthSq() > 0.1 &&
      Date.now() - lastStep.current > 350 &&
      !isFlying &&
      !isInLiquid
    ) {
      EventBus.emit('audio', { sound: 'footstep', source: 'local' });
      lastStep.current = Date.now();
    }

    const { playerJumpMult, playerPower: _playerPower } = state;
    if (_intendedJump && !isFlying) {
      if (isInLiquid) {
        playerRef.current.setLinvel({ x: linvel.x, y: 3, z: linvel.z }, true);
      } else if (isGrounded && Date.now() - lastJump.current > 300) {
        playerRef.current.setLinvel(
          { x: linvel.x, y: JUMP_FORCE * playerJumpMult, z: linvel.z },
          true
        );
        lastJump.current = Date.now();
        EventBus.emit('audio', { sound: 'jump', source: 'local' });
      }
    }

    if (isInLiquid && !_intendedJump && linvel.y < -2) {
      // Terminal velocity falling in liquid
      playerRef.current.setLinvel({ x: linvel.x, y: -2, z: linvel.z }, true);
    } else if (!isFlying && linvel.y < -35) {
      // Strict terminal velocity to prevent tunneling through the collision mesh
      playerRef.current.setLinvel({ x: linvel.x, y: -35, z: linvel.z }, true);
    }
};
