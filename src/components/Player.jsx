import { useFrame, useThree } from '@react-three/fiber';
import { RigidBody, CapsuleCollider, useRapier, useBeforePhysicsStep } from '@react-three/rapier';
import { useRef, useEffect, useState } from 'react';
import { Vector3 } from 'three';
import { useKeyboard } from '../hooks/useKeyboard';
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
import { playerPosition, playerRotation, ServerTickMetrics } from '../globals';
import { gameAudio } from '../audio/GameAudio';
import { GlobalRegistry } from '../registry/Registry';
import { networkActions } from '../stores/networkActions';

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
  TERRAIN: 0x00010001, // Layer 0
  PLAYER: 0x00020002, // Layer 1
  PROJECTILES: 0x00040004, // Layer 2
  ITEMS: 0x00080008, // Layer 3
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

export const Player = () => {
  const { camera } = useThree();
  const { moveBackward, moveForward, moveRight, moveLeft, jump, sprint } =
    useKeyboard();
  const [isFlying, setIsFlying] = useState(false);
  const playerRef = useRef();
  const meshRef = useRef();
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
  const [hasSnappedToGround, setHasSnappedToGround] = useState(() => {
    const initialY = playerPosition.y;
    return initialY < 160; // If they spawned high in the sky (e.g. from an old glitch save), snap them safely!
  });

  const wasGrounded = useRef(true);
  const fallSpeed = useRef(0);
  const frameCounter = useRef(0);

  // RPG Systems Simulation Refs (Tick-based)
  const tickCount = useRef(0);
  const idleTicks = useRef(0);
  const zeroPowerTicks = useRef(0);
  const sprintTicks = useRef(0);

  // Toggle flying with F key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'KeyF' && document.pointerLockElement) {
        setIsFlying((prev) => !prev);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const { rapier, world } = useRapier();

  const cachedRay = useRef(null);
  if (!cachedRay.current && rapier) {
    cachedRay.current = new rapier.Ray({x:0, y:0, z:0}, {x:0, y:-1, z:0});
  }
  const getCachedRay = (origin, dir) => {
    const r = cachedRay.current;
    r.origin.x = origin.x; r.origin.y = origin.y; r.origin.z = origin.z;
    r.dir.x = dir.x; r.dir.y = dir.y; r.dir.z = dir.z;
    return r;
  };

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
          setHasSnappedToGround(false); // Snap them to ground when they respawn at 160
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
            setHasSnappedToGround(false); // Respawn safe snap
          } else {
            setHasSnappedToGround(true); // Normal teleport
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
      if (state.isInventoryOpen) return;

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

      // Dispatch Intent to Host if it's a combat tool
      if (combatStats) {
        const intent = {
          type: 'ATTACK_INTENT',
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
        const hit = world.castRay(new rapier.Ray({x: startPos.x, y: startPos.y, z: startPos.z}, {x: dir.x, y: dir.y, z: dir.z}), 200, false);
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
        console.log('[GrappleDebug] Raycast Start:', startPos, 'Dir:', dir);
        
        // Raycast max 50 blocks
        const hit = world.castRay(
           new rapier.Ray({x: startPos.x, y: startPos.y, z: startPos.z}, {x: dir.x, y: dir.y, z: dir.z}),
           50, false
        );

        console.log('[GrappleDebug] Hit Result:', hit);

        if (hit) {
          const hitTime = (hit.toi ?? hit.timeOfImpact);
          const endPos = startPos.clone().addScaledVector(dir, hitTime);
          console.log('[GrappleDebug] Hit Distance:', hitTime, 'EndPos:', endPos);
          if (Number.isFinite(endPos.x)) {
            console.log('[GrappleDebug] Target SET!');
            state.setGrappleTarget([endPos.x, endPos.y, endPos.z]);
            gameAudio.playGlobal('grapple_shoot');
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
  const lastTickTime = useRef(performance.now());

  useBeforePhysicsStep(() => {
    if (!playerRef.current) return;
    const now = performance.now();
    const delta = now - lastTickTime.current;
    lastTickTime.current = now;
    
    accumulator.current += delta;
    const TICK_TIME = 1000 / ServerTickMetrics.tps;

    let ticksThisFrame = 0;
    while (accumulator.current >= TICK_TIME && ticksThisFrame < 10) {
      let startMSPT = performance.now();
      runFixedTick();
      ServerTickMetrics.mspt = performance.now() - startMSPT;
      accumulator.current -= TICK_TIME;
      ticksThisFrame++;
    }
    if (ticksThisFrame >= 10) accumulator.current = 0;
  });

  const runFixedTick = () => {
    if (!playerRef.current) return;
    const state = useStore.getState();
    if (state.isDead) return;

    tickCount.current++;
    const isCreative = state.gameMode?.toLowerCase() === 'creative';

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

    const translation = playerRef.current.translation();
    let linvel = playerRef.current.linvel();

    // 1. NaN Physics Engine Sanitization Hook
    if (
      !Number.isFinite(translation.x) ||
      !Number.isFinite(translation.y) ||
      !Number.isFinite(translation.z) ||
      !Number.isFinite(linvel.x) ||
      !Number.isFinite(linvel.y) ||
      !Number.isFinite(linvel.z)
    ) {
      console.warn('[Physics Sanitizer] NaN/Infinity detected! Rescuing player...');
      isTeleporting.current = true;
      const safeX = Number.isFinite(translation.x) ? translation.x : initialPos[0];
      const safeZ = Number.isFinite(translation.z) ? translation.z : initialPos[2];
      
      // Plunge player into safe respawn sequence
      playerRef.current.setTranslation({ x: safeX, y: 260, z: safeZ }, true);
      playerRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
      playerRef.current.setGravityScale(0, true);
      setHasSnappedToGround(false);
      isTeleporting.current = false;
      return;
    }

    // Update shared global for AI / ChunkManager
    playerPosition.set(translation.x, translation.y, translation.z);
    playerRotation.copy(camera.rotation);

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

    // Prevent falling through the ground when walking into unloaded chunks!
    const playerCx = Math.floor(translation.x / 16);
    const playerCz = Math.floor(translation.z / 16);
    const playerChunk = useChunkStore.getState().chunks[`${playerCx},${playerCz}`];
    if (!playerChunk || !playerChunk.meshArrays) {
      // Chunk not loaded yet! Freeze player mid-air to wait for it.
      playerRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
      playerRef.current.setGravityScale(0, true);
      return;
    }

    if (isTeleporting.current) return;

    if (!hasSnappedToGround) {
      // Freeze player until we find the ground via the safe spawn scanner
      playerRef.current.setTranslation(
        { x: translation.x, y: 400, z: translation.z },
        true
      );
      playerRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
      playerRef.current.setGravityScale(0, true);

      // Calculate the precise highest solid block at our (X, Z) coordinate!
      const safeY = state.findSafeSpawnY(translation.x, translation.z);
      if (safeY !== 400) {
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
          getCachedRay(rayOrigin, rayDir),
          4.0,
          false
        );

        if (groundHit) {
          // Physics floor is confirmed loaded!
          playerRef.current.setGravityScale(1, true);
          setHasSnappedToGround(true);
          // Prevent 1-frame sky blink by instantly synchronizing the camera
          camera.position.set(translation.x, safeY + 3.1, translation.z);
        } else {
          // Wait for Trimesh to mount! Keep them frozen.
          playerRef.current.setGravityScale(0, true);
          playerRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
          playerRef.current.setTranslation(
            { x: translation.x, y: safeY + 2.5, z: translation.z },
            true
          );
        }
      }
      return;
    }

    // CRITICAL FIX: Ensure the physics engine has actually mounted the terrain before allowing gravity!
    // When loading a save game, the player teleports to their saved position, but the WASM BVH takes a few frames to build.
    if (!isFlying && !state.isDead && translation.y > -60) {
      // Cast a massive ray down. If it hits nothing, the physics world is completely empty under us!
      const hit = world.castRay(
        getCachedRay(
          { x: translation.x, y: translation.y + 1.0, z: translation.z },
          _rayDir
        ),
        400.0,
        false,
        CollisionLayers.TERRAIN
      );
      if (!hit) {
        // Freeze the player in mid-air until the Trimesh mounts!
        playerRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
        playerRef.current.setGravityScale(0, true);
        return;
      }
    }

    // Safety floor below bedrock (or physics NaN glitch) — catches player if they fall out of the world
    if (translation.y < -70 && !Number.isNaN(translation.y)) {
      // Void Death!
      if (state.isWorldReady && !state.isDead) {
        state.damagePlayer(1000); // Instant kill
      }
      return;
    }



    if (state.isInventoryOpen) {
      // Freeze horizontal movement, allow gravity
      const linvel = playerRef.current.linvel();
      playerRef.current.setLinvel({ x: 0, y: linvel.y, z: 0 }, true);
      return;
    }

    // Occasional raycast straight up to check for weather/audio occlusion
    frameCounter.current++;
    if (frameCounter.current % 15 === 0) {
      const hit = world.castRay(
        getCachedRay(
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

    // Movement
    camera.getWorldDirection(_frontVector);
    _frontVector.y = 0;
    _frontVector.normalize();

    _sideVector.copy(_frontVector).cross(camera.up).normalize();

    let currentSpeed = SPEED;
    if (sprint) {
      if (state.playerPower > 0 || isCreative) {
        currentSpeed = SPEED * 1.6;
        if (!isCreative) {
          sprintTicks.current++;
          if (sprintTicks.current >= 30) { // Drain 1 power every 1.5s (30 ticks) of sprinting
            state.drainPower(1);
            sprintTicks.current = 0;
          }
        }
      } else {
        // Exhausted
        currentSpeed = SPEED * 0.7; // Crippled speed
        sprintTicks.current = 0;
      }
    } else {
      sprintTicks.current = 0;
      if (!isCreative && state.playerPower <= 0) {
        currentSpeed = SPEED * 0.7; // Crippled walking speed when empty
      }
    }

    if (isFlying) currentSpeed *= 3;

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
            gameAudio.playGlobal('grapple_reel');
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
      currentSpeed *= liquidDamage > 0 ? 0.25 : 0.5; // Viscosity is thicker in dangerous liquids (Lava/Acid)
      playerRef.current.setGravityScale(liquidDamage > 0 ? 0.05 : 0.1, true); // Slower sinking
      if (liquidDamage > 0 && Date.now() - lastLavaDamage.current > 500) {
        state.damagePlayer(liquidDamage);
        lastLavaDamage.current = Date.now();
      }
    } else {
      playerRef.current.setGravityScale(isFlying ? 0 : 1, true);
    }

    linvel = playerRef.current.linvel();

    if (isFlying) {
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
        getCachedRay(_rayOrigin, _rayDir),
        0.4,
        false
      );
      if (groundHit) {
        isGrounded = true;
        break;
      }
    }

    if (isGrounded && !wasGrounded.current && fallSpeed.current < -8) {
      gameAudio.playGlobal('land');
    }
    wasGrounded.current = isGrounded;
    if (!isGrounded) fallSpeed.current = linvel.y;

    if (
      isGrounded &&
      _intendedDirection.lengthSq() > 0.1 &&
      Date.now() - lastStep.current > 350 &&
      !isFlying &&
      !isInLiquid
    ) {
      gameAudio.playGlobal('footstep');
      lastStep.current = Date.now();
    }

    const { playerJumpMult, playerPower } = state;
    if (_intendedJump && !isFlying) {
      if (isInLiquid) {
        playerRef.current.setLinvel({ x: linvel.x, y: 3, z: linvel.z }, true);
      } else if (isGrounded && Date.now() - lastJump.current > 300) {
        playerRef.current.setLinvel(
          { x: linvel.x, y: JUMP_FORCE * playerJumpMult, z: linvel.z },
          true
        );
        lastJump.current = Date.now();
        gameAudio.playGlobal('jump');
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

  useFrame((state, delta) => {
    // Poll Keyboard & Steer Vectors at 144Hz
    const storeState = useStore.getState();
    const isCreative = storeState.gameMode?.toLowerCase() === 'creative';
    
    let currentSpeed = SPEED;
    if (sprint) {
      if (storeState.playerPower > 0 || isCreative) {
        currentSpeed = SPEED * 1.6;
      } else {
        currentSpeed = SPEED * 0.7;
      }
    } else if (!isCreative && storeState.playerPower <= 0) {
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
    
    if (isFlying) {
      if (jump) _intendedSpeedY = currentSpeed;
      else if (sprint) _intendedSpeedY = -currentSpeed;
      else _intendedSpeedY = 0;
    }

    if (!meshRef.current) return;
    meshRef.current.getWorldPosition(_camPos);
    
    // Mathematically interpolate the camera to chase the 60Hz physics body
    // This perfectly replaces the buggy `interpolate={true}` prop!
    const targetY = _camPos.y + 0.6;
    const lerpFactor = Math.min(1.0, delta * 20.0);
    
    camera.position.x += (_camPos.x - camera.position.x) * lerpFactor;
    camera.position.y += (targetY - camera.position.y) * lerpFactor;
    camera.position.z += (_camPos.z - camera.position.z) * lerpFactor;
  });

  return (
    <RigidBody
      ref={playerRef}
      colliders={false}
      mass={1}
      type="dynamic"
      ccd={true}
      position={initialPos}
      lockRotations
      friction={0}
      gravityScale={isFlying ? 0 : 1}
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
  );
};
