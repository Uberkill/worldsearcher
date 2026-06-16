import { useMemo, useRef, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody, CuboidCollider, useBeforePhysicsStep } from '@react-three/rapier';
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

  useFrame((_, delta) => {
    // Local Kill Plane for the "Two Boats" system.
    if (playerPosition.y < 9990 && playerPosition.y > 5000 && !useStore.getState().forceTeleportPos) {
      if (useStore.getState().isTransitMode) {
          // EXPLOIT FIX: Stranded player during warp is returned to the ship instead of Y=800
          if (!shipTransforms.has('default')) {
              shipTransforms.set('default', { position: new Vector3(0, 10000, 0), rotation: new Euler() });
          }
          const currentTransform = shipTransforms.get('default');
          if (currentTransform) {
              const offset = new Vector3(0, 15, -3).applyEuler(currentTransform.rotation);
              useStore.setState({ forceTeleportPos: [currentTransform.position.x + offset.x, currentTransform.position.y + offset.y, currentTransform.position.z + offset.z] });
          }
      } else {
          useStore.setState({ forceTeleportPos: [playerPosition.x, 260, playerPosition.z] });
      }
    }
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
    if (!currentTransform) return;
    
    if (networkActions.getState().isHost && isShipActive) {
        try {
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
                if (!storeState.isTransitMode) {
                    velocityRef.current.y -= 10 * delta; // Simulated Gravity
                }
            }
            
            if (shipCorePower > 0) {
                velocityRef.current.z += fwd * accel;
                velocityRef.current.y += up * accel;
            }
            
            velocityRef.current.z *= 0.92;
            velocityRef.current.y *= 0.92;
            
            if (velocityRef.current.z > maxSpeed) velocityRef.current.z = maxSpeed;
            if (velocityRef.current.z < -maxSpeed) velocityRef.current.z = -maxSpeed;
            if (velocityRef.current.y > maxSpeed) velocityRef.current.y = maxSpeed;
            if (velocityRef.current.y < -maxSpeed) velocityRef.current.y = -maxSpeed;

            velocityRef.current.x += side * rotAccel;
            velocityRef.current.x *= 0.80; 
            if (velocityRef.current.x > maxRotSpeed) velocityRef.current.x = maxRotSpeed;
            if (velocityRef.current.x < -maxRotSpeed) velocityRef.current.x = -maxRotSpeed;
            
            if (Math.abs(velocityRef.current.z) > 0.1 || Math.abs(velocityRef.current.y) > 0.1 || Math.abs(velocityRef.current.x) > 0.01) {
               
               if (shipCorePower > 0 && (fwd !== 0 || side !== 0 || up !== 0)) {
                   storeState.drainShipPower(5 * delta * drainMultiplier);
               }

               const newRotY = currentTransform.rotation.y + velocityRef.current.x * delta;

               _euler.set(0, newRotY, 0);
               _forwardVec.set(0, 0, -1).applyEuler(_euler);
               
               _pos.set(
                  currentTransform.position.x + _forwardVec.x * velocityRef.current.z * delta,
                  currentTransform.position.y + velocityRef.current.y * delta,
                  currentTransform.position.z + _forwardVec.z * velocityRef.current.z * delta
               );
               lastValidTransform.current.position.copy(currentTransform.position);
               lastValidTransform.current.rotation.copy(currentTransform.rotation);
               
               currentTransform.position.copy(_pos);
               currentTransform.rotation.copy(_euler);
               if (!currentTransform.actualVelocity) currentTransform.actualVelocity = new Vector3();
               currentTransform.actualVelocity.set(
                   _forwardVec.x * velocityRef.current.z,
                   velocityRef.current.y,
                   _forwardVec.z * velocityRef.current.z
               );
               
               // Low frequency UI region update
               const newRegionX = Math.floor(_pos.x / 2000) * 2000;
               const newRegionZ = Math.floor(_pos.z / 2000) * 2000;
               if (storeState.shipRegion.x !== newRegionX || storeState.shipRegion.z !== newRegionZ) {
                   storeState.setShipRegion(newRegionX, newRegionZ);
               }
            }
        } catch (err) {
            console.error("CRITICAL ERROR IN SHIP PHYSICS HOST LOOP:", err);
        }
    }

  });

  const lastTimeRef = useRef(performance.now());
  useBeforePhysicsStep((world) => {
    const now = performance.now();
    const delta = (now - lastTimeRef.current) / 1000.0;
    lastTimeRef.current = now;

    const currentTransform = shipTransforms.get('default');
    if (!currentTransform) return;
    
    if (rbRef.current) {
        // Lerp kinematic body to shipTransform
        const rot = rbRef.current.rotation();
        _quat.set(rot.x, rot.y, rot.z, rot.w);
        const currentPos = rbRef.current.translation();
        const targetPos = currentTransform.position;
        // Instant teleport if distance is huge (e.g. warping to Sky Dimension)
        const distSq = Math.pow(targetPos.x - currentPos.x, 2) + Math.pow(targetPos.y - currentPos.y, 2) + Math.pow(targetPos.z - currentPos.z, 2);
        
        _targetQuat.setFromEuler(currentTransform.rotation);

        if (distSq > 1000000) {
            rbRef.current.setTranslation({
                x: targetPos.x,
                y: targetPos.y,
                z: targetPos.z
            }, true);
            rbRef.current.setNextKinematicRotation({ x: _targetQuat.x, y: _targetQuat.y, z: _targetQuat.z, w: _targetQuat.w });
            
            if (currentTransform.actualPosition) {
                currentTransform.actualPosition.copy(targetPos);
                
                // Keep actualQuaternion if initialized, or fall back
                if (!currentTransform.actualQuaternion) currentTransform.actualQuaternion = { x: 0, y: 0, z: 0, w: 1 };
                _quat.setFromEuler(currentTransform.rotation);
                currentTransform.actualQuaternion.x = _quat.x;
                currentTransform.actualQuaternion.y = _quat.y;
                currentTransform.actualQuaternion.z = _quat.z;
                currentTransform.actualQuaternion.w = _quat.w;
            }
        } else {
            const lerpFactor = Math.min(1.0, delta * 10.0);
            if (distSq > 0.0001) {
                _pos.set(
                    currentPos.x + (targetPos.x - currentPos.x) * lerpFactor,
                    currentPos.y + (targetPos.y - currentPos.y) * lerpFactor,
                    currentPos.z + (targetPos.z - currentPos.z) * lerpFactor
                );
                rbRef.current.setNextKinematicTranslation({ x: _pos.x, y: _pos.y, z: _pos.z });
            } else {
                _pos.copy(currentPos);
            }
            
            // Slerp rotation
            _quat.slerp(_targetQuat, lerpFactor);
            rbRef.current.setNextKinematicRotation({ x: _quat.x, y: _quat.y, z: _quat.z, w: _quat.w });
            
            if (currentTransform.actualPosition) {
                currentTransform.actualPosition.copy(_pos);
                
                if (!currentTransform.actualQuaternion) currentTransform.actualQuaternion = { x: 0, y: 0, z: 0, w: 1 };
                currentTransform.actualQuaternion.x = _quat.x;
                currentTransform.actualQuaternion.y = _quat.y;
                currentTransform.actualQuaternion.z = _quat.z;
                currentTransform.actualQuaternion.w = _quat.w;
            }
        }
    }
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
         type="kinematicPosition" 
         colliders={false} 
         collisionGroups={0x0010FFFF}
         activeCollisionTypes={8704}
         onCollisionEnter={(e) => {
             const isTerrain = e.rigidBodyObject?.userData?.type === 'chunk' || e.colliderObject?.userData?.type === 'terrain';
             if (!isTerrain) return;
             
             if (networkActions.getState().isHost) {
                 const now = performance.now();
                 if (now - (window.__lastShipCollision || 0) < 500) return;
                 window.__lastShipCollision = now;
                 const velocityMag = Math.sqrt(velocityRef.current.x**2 + velocityRef.current.y**2 + velocityRef.current.z**2);
                 if (velocityMag > 2) {
                     // Fix: Defer state update to prevent synchronous unmount crash in Rapier
                     setTimeout(() => {
                         useStore.getState().damageShip(velocityMag * 5);
                     }, 0);
                     try { EventBus.emit('audio', { sound: 'explosion', source: 'local' }); } catch(err){}
                 }
                 
                  const currentTransform = shipTransforms.get('default');
                  if (currentTransform && lastValidTransform.current) {
                      // True Event-Based Rollback
                      const newPos = lastValidTransform.current.position.toArray();
                      const rot = currentTransform.rotation;
                      useStore.getState().setShipTransform('default', newPos, [rot.x, rot.y, rot.z]);
                  }
                  
                  // Reverse strict velocity vectors to bounce mathematically away from the impact plane
                  velocityRef.current.z *= -0.5;
                  velocityRef.current.x *= -0.5;
                  velocityRef.current.y *= -0.5;
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
