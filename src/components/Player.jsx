import { useFrame, useThree } from '@react-three/fiber';
import { RigidBody, CapsuleCollider, useRapier } from '@react-three/rapier';
import { useRef, useEffect, useState } from 'react';
import { Vector3, Euler } from 'three';
import { useKeyboard } from '../hooks/useKeyboard';
import { useStore } from '../stores/useStore';
import { BlockRegistry, BlockById, BlockKeyById } from '../registry/BlockRegistry';
import { getIndex, getTextureId, getIsHidden, CHUNK_Y_MIN, CHUNK_Y_MAX } from '../utils/chunkData';
import { playerPosition, playerRotation } from '../globals';
import { sfxManager } from '../utils/SFXManager';
import { GlobalRegistry } from '../registry/Registry';
import { useNetworkStore } from '../stores/useNetworkStore';

const SPEED      = 5;
const JUMP_FORCE = 7;

const MAX_ALLOWED_VELOCITY = 60;
const CollisionLayers = {
  TERRAIN:     0x00010001, // Layer 0
  PLAYER:      0x00020002, // Layer 1
  PROJECTILES: 0x00040004, // Layer 2
  ITEMS:       0x00080008  // Layer 3
};

// FIX: Hoist reusable vectors to module level.
// Before: new Vector3() × 3 + new rapier.Ray() created every frame at 60fps
// = 240+ heap allocations/sec → constant GC pressure → stutters.
// After: zero allocations per frame.
const _direction   = new Vector3();
const _frontVector = new Vector3();
const _sideVector  = new Vector3();
const _yAxis       = new Vector3(0, 1, 0);
const _camPos      = new Vector3();
const _rayOrigin   = { x: 0, y: 0, z: 0 };
const _rayDir      = { x: 0, y: -1, z: 0 };
const _rayUpDir    = { x: 0, y: 1, z: 0 };

export const Player = () => {
  const { camera } = useThree();
  const { moveBackward, moveForward, moveRight, moveLeft, jump, sprint } = useKeyboard();
  const [isFlying, setIsFlying] = useState(false);
  const playerRef = useRef();
  const processedDamageRef = useRef(new Set());
  const isTeleporting = useRef(false);
  const lastJump  = useRef(0);
  const lastStep  = useRef(0);
  const lastLavaDamage = useRef(0);
  const snapGraceTimer = useRef(null);
  const [initialPos] = useState(() => {
     const p = useStore.getState().playerPos;
     return [p[0], p[1] === 160 ? 160 : p[1] + 1.5, p[2]]; // Bump up to avoid clipping into floor on load
  });
  const [hasSnappedToGround, setHasSnappedToGround] = useState(() => {
     const initialY = useStore.getState().playerPos[1];
     return initialY < 160; // If they spawned high in the sky (e.g. from an old glitch save), snap them safely!
  });
  
  const wasGrounded = useRef(true);
  const fallSpeed = useRef(0);
  const frameCounter = useRef(0);

  // Toggle flying with F key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'KeyF' && document.pointerLockElement) {
        setIsFlying(prev => !prev);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const { rapier, world } = useRapier();

  useEffect(() => {
    // Also save on window unload
    const handleUnload = () => {
      if (playerRef.current) {
        const trans = playerRef.current.translation();
        useStore.getState().ejectTableGrid();
        useStore.getState().savePlayerState([trans.x, trans.y, trans.z], [0, 0, 0, 1]);
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    
    // Watch for Respawn events
    const unsub = useStore.subscribe(
      (state) => state.isDead,
      (isDead, prevIsDead) => {
        if (!isDead && prevIsDead && playerRef.current) {
          // Player just respawned! Teleport the physical body.
          const pos = useStore.getState().playerPos;
          playerRef.current.setTranslation({ x: pos[0], y: pos[1], z: pos[2] }, true);
          playerRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
          setHasSnappedToGround(false); // Snap them to ground when they respawn at 160
        }
      }
    );
    
    // Watch for late-join network teleports
    const unsubPos = useStore.subscribe(
      (state) => state.playerPos,
      (pos, prevPos) => {
        if (pos !== prevPos && playerRef.current) {
           const dx = Math.abs(pos[0] - prevPos[0]);
           const dy = Math.abs(pos[1] - prevPos[1]);
           const dz = Math.abs(pos[2] - prevPos[2]);
           if (dx > 5 || dy > 5 || dz > 5) { // It's a teleport!
               playerRef.current.setTranslation({ x: pos[0], y: pos[1], z: pos[2] }, true);
               playerRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
               isTeleporting.current = false;
               if (pos[1] === 260) {
                   setHasSnappedToGround(false); // Respawn safe snap
               } else {
                   setHasSnappedToGround(true); // Normal teleport
               }
           }
        }
      }
    );
    
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      unsub();
      unsubPos();
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
      const networkStore = useNetworkStore.getState();
      const registryItem = GlobalRegistry[texture];
      const combatStats = registryItem?.combat;
      
      const dir = new Vector3();
      camera.getWorldDirection(dir);
      const origin = camera.position.clone();
      
      // Dispatch Intent to Host if it's a combat tool
      if (combatStats) {
         const intent = {
             type: 'ATTACK_INTENT',
             weaponId: texture,
             dir: [dir.x, dir.y, dir.z],
             origin: [origin.x, origin.y, origin.z]
         };
         networkStore.broadcastEvent(intent);
         
         if (networkStore.isHost) {
             networkStore.handleNetworkData(intent, { metadata: { playerId: networkStore.playerId } });
         }
      }
      
      if (texture === 'gun') {
         // Client Prediction: Gun sound handled by SFXManager locally based on intent
      } else if (texture === 'gauss_rifle') {
        if (Date.now() - lastFired.current < 1500) return; // Sniper Cooldown
        lastFired.current = Date.now();
        
        // Client Prediction (Visual Only Raycast)
        const startPos = origin.clone().addScaledVector(dir, 0.45);
        const hit = world.castRay(new rapier.Ray(startPos, dir), 200, false, CollisionLayers.TERRAIN);
        let endPos = startPos.clone().addScaledVector(dir, 200);
        if (hit) endPos = startPos.clone().addScaledVector(dir, hit.toi);
        
        const visualStart = origin.clone()
           .addScaledVector(dir, 0.5) // Forward
           .addScaledVector(camera.up, -0.2) // Down
           .addScaledVector(dir.clone().cross(camera.up).normalize(), 0.3); // Right
           
        addLaser([visualStart.x, visualStart.y, visualStart.z], [endPos.x, endPos.y, endPos.z]);
      } else if (texture === 'grapple') {
        if (state.grappleTarget) {
            // Detach instantly if already grappling
            state.setGrappleTarget(null);
            
            // The Slingshot Vault mechanic
            if (playerRef.current) {
                const linvel = playerRef.current.linvel();
                // Dampen horizontal speed by 50% and boost vertical for a smooth vault
                playerRef.current.setLinvel({ x: linvel.x * 0.5, y: Math.max(linvel.y * 0.5, 12), z: linvel.z * 0.5 }, true);
            }
            return;
        }

        const startPos = origin.clone().addScaledVector(dir, 0.45);
        
        // Raycast max 50 blocks
        const hit = world.castRay(
           new rapier.Ray({ x: startPos.x, y: startPos.y, z: startPos.z }, { x: dir.x, y: dir.y, z: dir.z }),
           50, false, CollisionLayers.TERRAIN
        );
        
        if (hit) {
           const endPos = startPos.clone().addScaledVector(dir, hit.toi);
           state.setGrappleTarget([endPos.x, endPos.y, endPos.z]);
        }
      } else if (texture === 'sword') {
        // Client Prediction
        swingSword(1);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [camera]); // only camera as dep — everything else read from store directly

  useFrame(() => {
    if (!playerRef.current) return;
    const state = useStore.getState();
    if (state.isDead) return;

    const translation = playerRef.current.translation();
    
    // Update shared global for AI / ChunkManager — reuse Vector3, no allocation
    playerPosition.set(translation.x, translation.y, translation.z);
    playerRotation.copy(camera.rotation);

    // Process Area Damage (Explosions)
    if (state.damageQueue.length > 0) {
      state.damageQueue.forEach(req => {
         if (processedDamageRef.current.has(req.id)) return;
         processedDamageRef.current.add(req.id);
         
         const distSq = Math.pow(translation.x - req.pos[0], 2) + Math.pow(translation.y - req.pos[1], 2) + Math.pow(translation.z - req.pos[2], 2);
         if (distSq <= req.radius * req.radius) {
            state.damagePlayer(req.amount);
         }
      });
    } else if (processedDamageRef.current.size > 0) {
       // No pending damage — clear all processed IDs without allocating sets
       processedDamageRef.current.clear();
    }

    if (!state.isWorldReady) {
      // Freeze movement and completely prevent gravity from sinking the player during loading screen
      playerRef.current.setTranslation({ x: initialPos[0], y: initialPos[1], z: initialPos[2] }, true);
      playerRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
      return;
    }

    // Prevent falling through the ground when walking into unloaded chunks!
    const playerCx = Math.floor(translation.x / 16);
    const playerCz = Math.floor(translation.z / 16);
    const playerChunk = state.chunks[`${playerCx},${playerCz}`];
    if (!playerChunk || !playerChunk.meshArrays) {
       // Chunk not loaded yet! Freeze player mid-air to wait for it.
       playerRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
       playerRef.current.setGravityScale(0, true);
       return;
    }

    if (isTeleporting.current) return;
    
    if (!hasSnappedToGround) {
       // Freeze player until we find the ground via the safe spawn scanner
       playerRef.current.setTranslation({ x: translation.x, y: 400, z: translation.z }, true);
       playerRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
       playerRef.current.setGravityScale(0, true);
       
       // Calculate the precise highest solid block at our (X, Z) coordinate!
       const safeY = state.findSafeSpawnY(translation.x, translation.z);
       if (safeY !== 400) {
          // Data says ground is here! Teleport them safely above the ground.
          // The block's top face is at `safeY + 1`. The capsule half-height is `0.8`.
          // So we must spawn them at `safeY + 1.8` or higher to avoid penetration!
          playerRef.current.setTranslation({ x: translation.x, y: safeY + 2.5, z: translation.z }, true);
          
          // CRITICAL: Prevent Spawn Clipping!
          // The data exists, but the Rapier physics Trimesh might still be calculating in WASM.
          // We must cast a ray down. If it hits nothing, the physics floor is not ready yet!
          // Shift the ray X and Z by 0.5 so it hits the center of the block face, avoiding edge/vertex raycast misses!
          const rayOrigin = { x: Math.floor(translation.x) + 0.5, y: safeY + 2.5, z: Math.floor(translation.z) + 0.5 };
          const rayDir = { x: 0, y: -1, z: 0 };
          const groundHit = world.castRay(new rapier.Ray(rayOrigin, rayDir), 4.0, false);
          
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
             playerRef.current.setTranslation({ x: translation.x, y: safeY + 2.5, z: translation.z }, true);
          }
       }
       return;
    }

    // CRITICAL FIX: Ensure the physics engine has actually mounted the terrain before allowing gravity!
    // When loading a save game, the player teleports to their saved position, but the WASM BVH takes a few frames to build.
    if (!isFlying && !state.isDead && translation.y > -60) {
        // Cast a massive ray down. If it hits nothing, the physics world is completely empty under us!
        const hit = world.castRay(new rapier.Ray({ x: translation.x, y: translation.y + 1.0, z: translation.z }, _rayDir), 400.0, false, CollisionLayers.TERRAIN);
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

    if (Number.isNaN(translation.y) || Number.isNaN(translation.x) || Number.isNaN(translation.z)) {
      isTeleporting.current = true;
      const safeX = Number.isNaN(translation.x) ? initialPos[0] : translation.x;
      const safeZ = Number.isNaN(translation.z) ? initialPos[2] : translation.z;
      
      playerRef.current.setTranslation({ x: safeX, y: 160, z: safeZ }, true);
      playerRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
      playerRef.current.setGravityScale(0, true);
      
      // Plunge the player back into the loading freeze until the chunk correctly generates!
      setHasSnappedToGround(false);
      isTeleporting.current = false;
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
       const hit = world.castRay(new rapier.Ray({ x: translation.x, y: translation.y + 0.8, z: translation.z }, _rayUpDir), 100, false);
       const isUnderground = hit !== null;
       if (state.isUnderground !== isUnderground) {
          state.setIsUnderground(isUnderground);
       }
    }

    // Camera follows player — reuse _camPos
    _camPos.set(translation.x, translation.y + 0.6, translation.z);
    camera.position.copy(_camPos);

    // Liquid Detection
    let isInLiquid = false;
    let isInLava = false;
    
    const pcx = Math.floor(translation.x / 16);
    const pcz = Math.floor(translation.z / 16);
    const pChunk = state.chunks[`${pcx},${pcz}`];
    
    if (pChunk && pChunk.buffer) {
       const bx = Math.floor(translation.x);
       const by1 = Math.floor(translation.y - 0.4);
       const by2 = Math.floor(translation.y + 0.8);
       const bz = Math.floor(translation.z);
       
       const lx = (bx % 16 + 16) % 16;
       const lz = (bz % 16 + 16) % 16;
       
       const getBlockTexName = (ly) => {
          if (ly >= CHUNK_Y_MIN && ly <= CHUNK_Y_MAX) {
             const val = pChunk.buffer[getIndex(lx, ly, lz)];
             if (val !== 0 && !getIsHidden(val)) {
                const tex = getTextureId(val);
                return BlockKeyById[tex];
             }
          }
          return null;
       };
       
       const tex1 = getBlockTexName(by1);
       const tex2 = getBlockTexName(by2);

       if (tex1 && BlockRegistry[tex1]?.isLiquid) {
          isInLiquid = true;
          if (tex1 === 'lava') isInLava = true;
       } else if (tex2 && BlockRegistry[tex2]?.isLiquid) {
          isInLiquid = true;
          if (tex2 === 'lava') isInLava = true;
       }
       const eyeTex = tex2;
       const liquidType = (eyeTex === 'lava' || eyeTex === 'water') ? eyeTex : null;
       
       if (state.submergedLiquid !== liquidType) {
          state.setSubmergedLiquid(liquidType);
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

    let currentSpeed = (sprint ? SPEED * 1.6 : SPEED) * (isFlying ? 3 : 1);
    
    // Grapple Physics Override (Hybrid Momentum-Retaining Pull)
    if (state.grappleTarget) {
       if (state.texture !== 'grapple') {
          state.setGrappleTarget(null);
       } else {
           const target = new Vector3(state.grappleTarget[0], state.grappleTarget[1], state.grappleTarget[2]);
           const dist = target.distanceTo(camera.position);
           
           if (dist < 2.5) {
              state.setGrappleTarget(null);
           } else {
              const pullDir = target.clone().sub(camera.position).normalize();
              const GRAPPLE_SPEED = 30; 
              
              // Standard WASD steering on orthogonal plane
              _frontVector.set(0, 0, moveBackward - moveForward);
              _sideVector.set(moveLeft - moveRight, 0, 0);
              _direction.subVectors(_frontVector, _sideVector).normalize().multiplyScalar(SPEED * 0.8).applyEuler(camera.rotation);
              _direction.y = 0; // Zero out vertical input steering

              // Combine pull and steering
              const finalVel = new Vector3(
                 pullDir.x * GRAPPLE_SPEED + _direction.x,
                 pullDir.y * GRAPPLE_SPEED,
                 pullDir.z * GRAPPLE_SPEED + _direction.z
              );
              
              // Velocity Clamping
              const speed = finalVel.length();
              if (speed > MAX_ALLOWED_VELOCITY) {
                 finalVel.multiplyScalar(MAX_ALLOWED_VELOCITY / speed);
              }
              
              playerRef.current.setLinvel(finalVel, true);
              playerRef.current.setGravityScale(0, true);
           }
           
           // We still need to update position globals so audio/raycasts work
           const pPos = playerRef.current.translation();
           playerPosition.set(pPos.x, pPos.y, pPos.z);
           return; // Skip normal walking logic
       }
    }

    if (isInLiquid && !isFlying) {
       currentSpeed *= isInLava ? 0.25 : 0.5; // Viscosity is thicker in Lava
       playerRef.current.setGravityScale(isInLava ? 0.05 : 0.1, true); // Slower sinking in Lava
       if (isInLava && Date.now() - lastLavaDamage.current > 500) {
          state.damagePlayer(10); // Magma burns!
          lastLavaDamage.current = Date.now();
       }
    } else {
       playerRef.current.setGravityScale(isFlying ? 0 : 1, true);
    }
    
    _direction.set(0, 0, 0);
    if (moveForward) _direction.add(_frontVector);
    if (moveBackward) _direction.sub(_frontVector);
    if (moveRight) _direction.add(_sideVector);
    if (moveLeft) _direction.sub(_sideVector);
    
    _direction.normalize().multiplyScalar(currentSpeed);

    const linvel = playerRef.current.linvel();
    
    if (isFlying) {
      let flyY = 0;
      if (jump) flyY = currentSpeed;
      else if (sprint) flyY = -currentSpeed;
      playerRef.current.setLinvel({ x: _direction.x, y: flyY, z: _direction.z }, true);
    } else {
      // Normal walking: preserve gravity Y velocity
      playerRef.current.setLinvel({ x: _direction.x, y: linvel.y, z: _direction.z }, true);
    }

    let isGrounded = false;
    const offsets = [[0,0], [0.3,0], [-0.3,0], [0,0.3], [0,-0.3]];
    for (const [ox, oz] of offsets) {
      _rayOrigin.x = translation.x + ox;
      _rayOrigin.y = translation.y - 0.75; // Start inside the capsule slightly above the bottom (bottom is 0.8)
      _rayOrigin.z = translation.z + oz;
      const groundHit = world.castRay(new rapier.Ray(_rayOrigin, _rayDir), 0.4, false);
      if (groundHit) { isGrounded = true; break; }
    }

    if (isGrounded && !wasGrounded.current && fallSpeed.current < -8) {
      sfxManager.play('land');
    }
    wasGrounded.current = isGrounded;
    if (!isGrounded) fallSpeed.current = linvel.y;

    if (isGrounded && _direction.lengthSq() > 0.1 && Date.now() - lastStep.current > 350 && !isFlying && !isInLiquid) {
      sfxManager.play('footstep');
      lastStep.current = Date.now();
    }

    const { playerJumpMult } = state;
    if (jump && !isFlying) {
      if (isInLiquid) {
        playerRef.current.setLinvel({ x: linvel.x, y: 3, z: linvel.z }, true);
      } else if (isGrounded && Date.now() - lastJump.current > 300) {
        playerRef.current.setLinvel({ x: linvel.x, y: JUMP_FORCE * playerJumpMult, z: linvel.z }, true);
        lastJump.current = Date.now();
        sfxManager.play('jump');
      }
    }
    
    if (isInLiquid && !jump && linvel.y < -2) {
       // Terminal velocity falling in liquid
       playerRef.current.setLinvel({ x: linvel.x, y: -2, z: linvel.z }, true);
    } else if (!isFlying && linvel.y < -35) {
       // Strict terminal velocity to prevent tunneling through the collision mesh
       playerRef.current.setLinvel({ x: linvel.x, y: -35, z: linvel.z }, true);
    }
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
      ccd={true}
      collisionGroups={CollisionLayers.PLAYER}
    >
      <CapsuleCollider args={[0.4, 0.4]} />
      {/* Invisible player body — physics only */}
      <mesh visible={false}>
        <sphereGeometry args={[0.4]} />
      </mesh>
    </RigidBody>
  );
};
