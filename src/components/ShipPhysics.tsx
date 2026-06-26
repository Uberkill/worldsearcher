// @ts-nocheck
import { useMemo, useRef, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody, CuboidCollider, useBeforePhysicsStep, useRapier } from '@react-three/rapier';
import { Vector3, Matrix4, Color, Euler, Quaternion } from 'three';
import { useStore } from '../stores/useStore';
import { networkActions } from '../stores/networkActions';
import { SHIP_SIZE_X, SHIP_SIZE_Y, SHIP_SIZE_Z, SHIP_VOLUME, SHIP_CENTER_X, SHIP_CENTER_Y, SHIP_CENTER_Z } from '../stores/createShipSlice';
import { playerPosition, shipTransforms } from '../globals';
import { BlockById } from '../registry/BlockRegistry';
import { GlitchFire } from './GlitchFire';
import { EventBus } from '../utils/EventBus';
import { getShipWorker } from '../workers/shipWorkerPool';

const _mat = new Matrix4();
const _pos = new Vector3();
const _color = new Color();
const _euler = new Euler();
const _quat = new Quaternion();
const _forwardVec = new Vector3();
const _targetQuat = new Quaternion();

export const ShipPhysics = () => {
  const { rapier, world } = useRapier();
  const shipShapeRef = useRef(null);
  useEffect(() => {
    if (rapier && !shipShapeRef.current) {
        // Use a smaller core bounding box for the physics sweep to prevent instant ground intersection
        shipShapeRef.current = new rapier.Cuboid({ x: 1.5, y: 1.5, z: 1.5 });
    }
  }, [rapier]);

  const isShipActive = useStore((state) => state.isShipActive);
  const isBuildMode = useStore((state) => state.isBuildMode);
  const shipBuffer = useStore((state) => state.shipBuffer);
  const shipFullRebuildId = useStore((state) => state.shipFullRebuildId);

  const setShipTransform = useStore((state) => state.setShipTransform);
  const activeFires = useStore((state) => state.activeFires);
  const rbRef = useRef();
  const meshRef = useRef();
  const velocityRef = useRef(new Vector3());
  const lastValidTransform = useRef({ position: new Vector3(), rotation: new Euler() });

  const shipHardwareCounts = useStore((state) => state.shipHardwareCounts);
  const hasEngine = shipHardwareCounts.engine > 0;
  const hasCapacitor = shipHardwareCounts.capacitor > 0;

  useFrame((_, delta) => runShipFrame(delta, isShipActive, hasEngine, hasCapacitor, rbRef, meshRef, velocityRef, lastValidTransform, setShipTransform, shipBuffer, isBuildMode, shipFullRebuildId, activeFires, world, shipShapeRef));

  const lastTimeRef = useRef(null);
  useBeforePhysicsStep((world) => {
    if (lastTimeRef.current === null) lastTimeRef.current = performance.now();
    runShipPhysicsStep(world, lastTimeRef, isShipActive, hasEngine, rbRef, meshRef, velocityRef, lastValidTransform, setShipTransform);
  });
  useEffect(() => {
    if (!meshRef.current || !shipBuffer) return;

    for (let x = 0; x < SHIP_SIZE_X; x++) {
      for (let y = 0; y < SHIP_SIZE_Y; y++) {
          for (let z = 0; z < SHIP_SIZE_Z; z++) {
            const bufferIdx = y * (SHIP_SIZE_X * SHIP_SIZE_Z) + z * SHIP_SIZE_X + x;
            const val = shipBuffer[bufferIdx];
            const texId = val & 0xff;

            const px = x - SHIP_SIZE_X / 2;
            const py = y - SHIP_SIZE_Y / 2;
            const pz = z - SHIP_SIZE_Z / 2;
            
            _pos.set(px, py, pz);
            _mat.makeTranslation(_pos.x, _pos.y, _pos.z);
            
            if (texId !== 0) {
              const blockDef = BlockById[texId];
              let r = 0.8, g = 0.8, b = 0.8;
              if (blockDef && blockDef.color) {
                 const hex = blockDef.color.replace('#', '');
                 r = parseInt(hex.substring(0,2), 16) / 255;
                 g = parseInt(hex.substring(2,4), 16) / 255;
                 b = parseInt(hex.substring(4,6), 16) / 255;
              }
              _color.setRGB(r, g, b);
              meshRef.current.setColorAt(bufferIdx, _color);
            } else {
              _mat.scale(new Vector3(0, 0, 0)); // Hide air blocks
            }
            meshRef.current.setMatrixAt(bufferIdx, _mat);
          }
      }
    }

    meshRef.current.count = 32768; // Always render 32k, invisible are scaled to 0
    meshRef.current.computeBoundingSphere();
    if (meshRef.current.boundingSphere) {
       meshRef.current.boundingSphere.radius = 32;
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;

    // O(1) Targeted Visual Updates
    let lastVisualChangeRef = null;
    const unsub = useStore.subscribe((state) => {
        const change = state.lastShipVoxelChange;
        if (change && change !== lastVisualChangeRef) {
            lastVisualChangeRef = change;
            const { x, y, z, val } = change;
            const bufferIdx = y * (SHIP_SIZE_X * SHIP_SIZE_Z) + z * SHIP_SIZE_X + x;
            const texId = val & 0xff;
            
            const px = x - SHIP_SIZE_X / 2;
            const py = y - SHIP_SIZE_Y / 2;
            const pz = z - SHIP_SIZE_Z / 2;
            _pos.set(px, py, pz);
            _mat.makeTranslation(_pos.x, _pos.y, _pos.z);
            
            if (texId !== 0) {
               const blockDef = BlockById[texId];
               let r = 0.8, g = 0.8, b = 0.8;
               if (blockDef && blockDef.color) {
                  const hex = blockDef.color.replace('#', '');
                  r = parseInt(hex.substring(0,2), 16) / 255;
                  g = parseInt(hex.substring(2,4), 16) / 255;
                  b = parseInt(hex.substring(4,6), 16) / 255;
               }
               _color.setRGB(r, g, b);
               meshRef.current.setColorAt(bufferIdx, _color);
            } else {
               _mat.scale(new Vector3(0, 0, 0));
            }
            meshRef.current.setMatrixAt(bufferIdx, _mat);
            meshRef.current.instanceMatrix.needsUpdate = true;
            if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
        }
    });
    
    return () => unsub();
  }, [shipBuffer, shipFullRebuildId]);

  const [shipVolumes, setShipVolumes] = useState([]);
  const [tempBlocks, setTempBlocks] = useState([]);

  useEffect(() => {
    if (!isShipActive) {
      // eslint-disable-next-line
      setTempBlocks([]);
    }
  }, [isShipActive, shipFullRebuildId]);

  useEffect(() => {
    const worker = getShipWorker();
    const handleMessage = (e) => {
       const { shipId, volumes, jobId } = e.data;
       if (shipId !== 'default') return;
       if (volumes) {
          setShipVolumes(volumes);
       }
       // Process temp blocks immediately using returned jobId
       setTempBlocks(prev => prev.filter(t => t.jobId > jobId));
    };
    worker.addEventListener('message', handleMessage);
    return () => {
       worker.removeEventListener('message', handleMessage);
    };
  }, []);

  // Dispatch full greedy mesh on full rebuilds
  useEffect(() => {
     if (shipBuffer) {
        const worker = getShipWorker();
        const clonedBuffer = shipBuffer.slice(0).buffer;
        worker.postMessage({ 
            shipId: 'default',
            type: 'FULL_BUFFER',
            buffer: clonedBuffer, // Ownership transferred
            jobId: 999999999 // Force clear all temps
        }, [clonedBuffer]);
     }
  }, [shipBuffer, shipFullRebuildId]);

  // Worker Dispatch for partial rebuilds (no physics debounce)
  useEffect(() => {
     let lastPhysicsChangeRef = null;
     const unsub = useStore.subscribe((state) => {
        const change = state.lastShipVoxelChange;
        if (change && change !== lastPhysicsChangeRef) {
            lastPhysicsChangeRef = change;
            const { x, y, z, val, jobId } = change;
            
            // Push instant temp block for rendering and physics (latency hiding)
            setTempBlocks(prev => [...prev, { x, y, z, val, jobId }]);
            
            // Update instance color immediately for break effect
            if (meshRef.current) {
                _color.setHex(BlockById[val] ? parseInt((BlockById[val].color || '#ffffff').replace('#', '0x')) : 0x000000);
                meshRef.current.setColorAt(y * 1024 + z * 32 + x, _color);
                if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
            }
            
            // Zero-debounce dispatch to worker's Hybrid Action Reducer
            getShipWorker().postMessage({
                shipId: 'default',
                type: 'VOXEL_UPDATE',
                x, y, z, val, jobId
            });
        }
     });
     return () => {
         unsub();
     };
  }, []);

  return (
    <group name="ship-physics-grid">
      <RigidBody 
         ref={rbRef} 
         type={networkActions.getState().isHost && hasEngine && isShipActive && !isBuildMode ? 'dynamic' : 'kinematicPosition'}
         enabledRotations={[false, true, false]}
         linearDamping={1.0}
         angularDamping={2.0}
         gravityScale={0}
         colliders={false} 
         collisionGroups={0x0010FFFF}
         activeCollisionTypes={8704}
         onCollisionEnter={(e) => {
             const isTerrain = e.rigidBodyObject?.userData?.type === 'chunk' || e.colliderObject?.userData?.type === 'terrain';
             if (!isTerrain) return;
             
             if (networkActions.getState().isHost) {
                   const velocityMag = Math.sqrt(velocityRef.current.x**2 + velocityRef.current.y**2 + velocityRef.current.z**2);
                   const now = performance.now();
                   if (now - (window.__lastShipCollision || 0) > 500 && velocityMag > 2) {
                       window.__lastShipCollision = now;
                       setTimeout(() => {
                           useStore.getState().damageShip(velocityMag * 5);
                       }, 0);
                       try {
                           EventBus.emit('audio', { sound: 'explosion', source: 'local' });
                       } catch (err) {}
                   }

                   // Organic bounce logic: Reflect momentum along all axes, rather than forcing Math.abs
                   velocityRef.current.z = -velocityRef.current.z * 0.4;
                   velocityRef.current.x = -velocityRef.current.x * 0.4;
                   velocityRef.current.y = -velocityRef.current.y * 0.4;
             }
         }}
      >
        {/* Optimized Greedy Meshed Physics Volumes */}
        {shipVolumes.map((vol, i) => (
           <CuboidCollider key={`vol_${i}_${vol[1].join(',')}`} args={vol[1]} position={vol[0]} userData={{ type: 'ship' }} />
        ))}
        
        {/* Zero-Latency Temporary Block Colliders */}
        {tempBlocks.filter(t => t.val !== 0).map((t, i) => (
           <CuboidCollider key={`temp_${t.jobId}_${i}`} args={[0.5, 0.5, 0.5]} position={[t.x - SHIP_CENTER_X, t.y - SHIP_CENTER_Y, t.z - SHIP_CENTER_Z]} userData={{ type: 'ship' }} />
        ))}

        {isBuildMode && (
          <mesh>
             <boxGeometry args={[32, 32, 32]} />
             <meshBasicMaterial color="#00ffcc" wireframe transparent opacity={0.3} depthTest={false} />

          </mesh>
        )}

        <instancedMesh ref={meshRef} args={[null, null, SHIP_VOLUME]} castShadow receiveShadow>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial />
        </instancedMesh>
        
        {/* Render Active Fires */}
        {activeFires.map((fire) => (
           <GlitchFire 
              key={fire.id} 
              id={fire.id} 
              position={[fire.pos[0] - SHIP_SIZE_X / 2, fire.pos[1] - SHIP_SIZE_Y / 2, fire.pos[2] - SHIP_SIZE_Z / 2]} 
           />
        ))}
      </RigidBody>
    </group>
  );
};

function runShipFrame(delta, isShipActive, hasEngine, hasCapacitor, rbRef, meshRef, velocityRef, lastValidTransform, setShipTransform, shipBuffer, isBuildMode, shipFullRebuildId, activeFires, world, shipShapeRef) {
    const currentTransform = ensureShipTransform(lastValidTransform);
    
    if (networkActions.getState().isHost && isShipActive) {
        calculateShipSteering(delta, hasEngine, velocityRef, currentTransform, lastValidTransform);
    }
}

function ensureShipTransform(lastValidTransform) {
    if (!shipTransforms.has('default')) {
        shipTransforms.set('default', { 
            position: new Vector3(0, 10000, 0), 
            rotation: new Euler(),
            actualPosition: new Vector3(0, 10000, 0),
            actualQuaternion: { x: 0, y: 0, z: 0, w: 1 },
            actualVelocity: new Vector3(0, 0, 0)
        });
    }
    const currentTransform = shipTransforms.get('default');
    if (!currentTransform) throw new Error("Missing default ship transform!"); // FAIL FAST

    if (!lastValidTransform.current.initialized && currentTransform.position.y !== 10000) {
        lastValidTransform.current.position.copy(currentTransform.position);
        lastValidTransform.current.rotation.copy(currentTransform.rotation);
        lastValidTransform.current.initialized = true;
    }
    return currentTransform;
}

function applyVelocityClamping(vel, maxSpeed, maxRotSpeed) {
    vel.z *= 0.92;
    vel.y *= 0.92;
    
    if (vel.z > maxSpeed) vel.z = maxSpeed;
    if (vel.z < -maxSpeed) vel.z = -maxSpeed;
    if (vel.y > maxSpeed) vel.y = maxSpeed;
    if (vel.y < -maxSpeed) vel.y = -maxSpeed;

    vel.x *= 0.80; 
    if (vel.x > maxRotSpeed) vel.x = maxRotSpeed;
    if (vel.x < -maxRotSpeed) vel.x = -maxRotSpeed;
}

function calculateShipSteering(delta, hasEngine, velocityRef, currentTransform, lastValidTransform) {
    const steering = useStore.getState().shipSteerIntents;
    let fwd = 0; let side = 0; let up = 0;
    const shipHelmPlayerId = useStore.getState().shipHelmPlayerId;
    if (shipHelmPlayerId && steering[shipHelmPlayerId]) {
       const intent = steering[shipHelmPlayerId];
       if (intent.forward) fwd += 1;
       if (intent.backward) fwd -= 1;
       if (intent.left) side += 1;
       if (intent.right) side -= 1;
       if (intent.jump) up += 1;
       if (intent.sprint) up -= 1;
    }
    
    const storeState = useStore.getState();
    const shipCorePower = storeState.shipCorePower;
    const shipHealth = storeState.shipHealth;
    const speedMultiplier = hasEngine ? 1.5 : 1.0;
    const drainMultiplier = hasEngine ? 0.5 : 1.0;
    
    let maxSpeed = 20 * speedMultiplier;
    let maxRotSpeed = 1.5 * speedMultiplier;
    
    const accel = 40 * speedMultiplier * delta; 
    const rotAccel = 5 * speedMultiplier * delta;
    
    if (shipHealth <= 0) {
        maxSpeed = 1.0; // Limp Mode
        maxRotSpeed = 0.2;
    }
    
    if (shipCorePower > 0) {
        velocityRef.current.z += fwd * accel;
        velocityRef.current.y += up * accel;
    }
    velocityRef.current.x += side * rotAccel;
    
    applyVelocityClamping(velocityRef.current, maxSpeed, maxRotSpeed);
    
    if (Math.abs(velocityRef.current.z) > 0.1 || Math.abs(velocityRef.current.y) > 0.1 || Math.abs(velocityRef.current.x) > 0.01) {
       
       if (shipCorePower > 0 && (fwd !== 0 || side !== 0 || up !== 0)) {
           storeState.drainShipPower(5 * delta * drainMultiplier);
       }

       const newRotY = currentTransform.rotation.y + velocityRef.current.x * delta;

       _euler.set(0, newRotY, 0);
       _forwardVec.set(0, 0, -1).applyEuler(_euler);
       
       lastValidTransform.current.position.copy(currentTransform.position);
       lastValidTransform.current.rotation.copy(currentTransform.rotation);
       
       if (!currentTransform.actualVelocity) currentTransform.actualVelocity = new Vector3();
       currentTransform.actualVelocity.set(
           _forwardVec.x * velocityRef.current.z,
           velocityRef.current.y,
           _forwardVec.z * velocityRef.current.z
       );
       
       // Low frequency UI region update
       const newRegionX = Math.floor(currentTransform.position.x / 2000) * 2000;
       const newRegionZ = Math.floor(currentTransform.position.z / 2000) * 2000;
       if (storeState.shipRegion.x !== newRegionX || storeState.shipRegion.z !== newRegionZ) {
           storeState.setShipRegion(newRegionX, newRegionZ);
       }
    }
}

export function runShipPhysicsStep(world, lastTimeRef, isShipActive, hasEngine, rbRef, meshRef, velocityRef, lastValidTransform, setShipTransform) {
      const now = performance.now();
      const delta = (now - lastTimeRef.current) / 1000.0;
      lastTimeRef.current = now;
  
      const currentTransform = shipTransforms.get('default');
      if (!currentTransform) return;
      
      const isHost = networkActions.getState().isHost;
      if (isHost) {
          applyShipPhysics(rbRef, velocityRef, currentTransform, lastValidTransform);
      } else {
          // Guest: smoothly interpolate kinematic body to the networked transform
          if (rbRef.current) {
              rbRef.current.setNextKinematicTranslation(currentTransform.position);
              _targetQuat.setFromEuler(currentTransform.rotation);
              rbRef.current.setRotation({ x: _targetQuat.x, y: _targetQuat.y, z: _targetQuat.z, w: _targetQuat.w }, true);
              
              if (currentTransform.actualPosition) {
                  currentTransform.actualPosition.copy(currentTransform.position);
                  if (!currentTransform.actualQuaternion) currentTransform.actualQuaternion = { x: 0, y: 0, z: 0, w: 1 };
                  currentTransform.actualQuaternion.x = _targetQuat.x;
                  currentTransform.actualQuaternion.y = _targetQuat.y;
                  currentTransform.actualQuaternion.z = _targetQuat.z;
                  currentTransform.actualQuaternion.w = _targetQuat.w;
              }
          }
      }
}

function applyShipPhysics(rbRef, velocityRef, currentTransform, lastValidTransform) {
      if (rbRef.current) {
          const currentPos = rbRef.current.translation();
          const currentRot = rbRef.current.rotation();
          _quat.set(currentRot.x, currentRot.y, currentRot.z, currentRot.w);
          _euler.setFromQuaternion(_quat);
          
          if (currentTransform.forceTeleport) {
              currentTransform.forceTeleport = false;
              rbRef.current.setTranslation({ x: currentTransform.position.x, y: currentTransform.position.y, z: currentTransform.position.z }, true);
              _targetQuat.setFromEuler(currentTransform.rotation);
              rbRef.current.setRotation({ x: _targetQuat.x, y: _targetQuat.y, z: _targetQuat.z, w: _targetQuat.w }, true);
              
              if (lastValidTransform.current) {
                  lastValidTransform.current.position.copy(currentTransform.position);
                  lastValidTransform.current.rotation.copy(currentTransform.rotation);
                  lastValidTransform.current.initialized = true;
              }
              if (velocityRef.current) {
                  velocityRef.current.set(0, 0, 0);
              }
              if (currentTransform.actualPosition) {
                  currentTransform.actualPosition.copy(currentTransform.position);
                  if (!currentTransform.actualQuaternion) currentTransform.actualQuaternion = { x: 0, y: 0, z: 0, w: 1 };
                  currentTransform.actualQuaternion.x = _targetQuat.x;
                  currentTransform.actualQuaternion.y = _targetQuat.y;
                  currentTransform.actualQuaternion.z = _targetQuat.z;
                  currentTransform.actualQuaternion.w = _targetQuat.w;
              }
              return;
          }

            // Apply our manual velocityRef steering as physical linear/angular velocity
            _forwardVec.set(0, 0, -1).applyEuler(_euler);
            
            const currentLinvel = rbRef.current.linvel();
            const isMovingZ = Math.abs(velocityRef.current.z) > 0.05;
            const isMovingY = Math.abs(velocityRef.current.y) > 0.05;

            const targetLinvel = {
                x: isMovingZ ? _forwardVec.x * velocityRef.current.z : currentLinvel.x * 0.95,
                y: isMovingY ? velocityRef.current.y : currentLinvel.y,
                z: isMovingZ ? _forwardVec.z * velocityRef.current.z : currentLinvel.z * 0.95
            };
            
            // No manual stabilizing needed. Pitch and Roll are locked natively by the engine via enabledRotations!
            const targetAngvel = {
                x: 0,
                y: velocityRef.current.x,
                z: 0
            };
            
            rbRef.current.setLinvel(targetLinvel, true);
            rbRef.current.setAngvel(targetAngvel, true);

          // Write back to our visual tracker
          currentTransform.position.copy(currentPos);
          currentTransform.rotation.setFromQuaternion(_quat);
          
          if (currentTransform.actualPosition) {
              currentTransform.actualPosition.copy(currentPos);
              if (!currentTransform.actualQuaternion) currentTransform.actualQuaternion = { x: 0, y: 0, z: 0, w: 1 };
              currentTransform.actualQuaternion.x = _quat.x;
              currentTransform.actualQuaternion.y = _quat.y;
              currentTransform.actualQuaternion.z = _quat.z;
              currentTransform.actualQuaternion.w = _quat.w;
          }
      }
}

