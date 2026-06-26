// @ts-nocheck
import { useEffect, useRef } from 'react';
import { useStore } from '../stores/useStore';
import { useChunkStore } from '../stores/chunkSlice';
import { useFrame } from '@react-three/fiber';
import { SHIP_SIZE_X, SHIP_SIZE_Y, SHIP_SIZE_Z } from '../stores/createShipSlice';
import { EventBus } from '../utils/EventBus';
import { networkActions } from '../stores/networkActions';
import { playerPosition, shipTransforms } from '../globals';

const GLITCH_INTERVAL = 3000; // time between glitch strikes in ms

export const TransitManager = () => {
  const isLongWarping = useStore((state) => state.isLongWarping);
  const setLongWarping = useStore((state) => state.setLongWarping);
  const isTransitMode = useStore((state) => state.isTransitMode);
  const activeFires = useStore((state) => state.activeFires);
  const spawnFire = useStore((state) => state.spawnFire);
  const clearFires = useStore((state) => state.clearFires);
  const drainShipPower = useStore((state) => state.drainShipPower);
  
  const lastGlitchRef = useRef(0);
  const warpTimerRef = useRef(0);
  const descentPhaseRef = useRef(0); // 0: sky/glitching, 1: holding, 2: descending
  const pxRef = useRef(0);
  const pzRef = useRef(0);
  const targetSurfaceYRef = useRef(0);

  // Trigger for Long Warp minigame
  useEffect(() => {
     if (isLongWarping) {
        warpTimerRef.current = 30000; // 30 seconds to survive
        lastGlitchRef.current = performance.now();
     }
  }, [isLongWarping]);

  useEffect(() => {
    if (isTransitMode) {
       descentPhaseRef.current = 0;
       
       const netState = networkActions.getState();
       const isHost = netState ? netState.isHost : true;
       if (isHost) {
          if (netState && netState.broadcastEvent) {
             netState.broadcastEvent({ type: 'TRANSIT_MODE', state: true });
          }
          // Global Pull & Warp Start sequence
          const px = Math.floor(playerPosition.x);
          const pz = Math.floor(playerPosition.z);
          const warpPos = [px, 10000, pz];
          
          useStore.getState().setShipTransform('default', warpPos, [0,0,0]);
          if (netState && netState.broadcastEvent) {
             netState.broadcastEvent({ type: 'SHIP_TRANSFORM', position: warpPos, rotation: [0,0,0] });
          }
          
          // 500ms delay to allow clients to process the kinematic physics jump
          setTimeout(() => {
             // Teleport host safely via physics store
             const shipLocalOffset = [0, 15, -3]; // Helm offset
             const targetPos = [px + shipLocalOffset[0], 10000 + shipLocalOffset[1], pz + shipLocalOffset[2]];
             useStore.setState({ forceTeleportPos: targetPos });
             
             // Broadcast GLOBAL_PULL to guests
             if (netState && netState.broadcastEvent) {
                netState.broadcastEvent({ type: 'GLOBAL_PULL', targetPos });
             }
          }, 500);
       }
    } else {
       // Disengaged Transit Mode -> Start Descent!
       if (isLongWarping) {
           // EXPLOIT FIX: Aborting long warp destroys the ship!
           setLongWarping(false);
           EventBus.emit('audio', { sound: 'explosion', source: 'local' });
           useStore.getState().damagePlayer(50);
           useStore.setState({ isSeated: false }); // Unseat
           
           const px = Math.floor(playerPosition.x);
           const pz = Math.floor(playerPosition.z);
           const shipPos = [px, 200, pz];
           useStore.getState().setShipTransform('default', shipPos, [0,0,0]);
           
           const netState = networkActions.getState();
           if (netState && netState.broadcastEvent) {
              netState.broadcastEvent({ type: 'SHIP_TRANSFORM', position: shipPos, rotation: [0,0,0] });
           }
           setTimeout(() => {
              const targetPos = [shipPos[0], shipPos[1] + 15, shipPos[2] - 3];
              useStore.setState({ forceTeleportPos: targetPos });
              if (netState && netState.broadcastEvent) {
                 netState.broadcastEvent({ type: 'GLOBAL_PULL', targetPos });
              }
           }, 500);
           return;
       }

         if (descentPhaseRef.current === 0) {
             const t = shipTransforms.get('default');
             pxRef.current = t ? Math.floor(t.position.x) : 0;
             pzRef.current = t ? Math.floor(t.position.z) : 0;
             descentPhaseRef.current = 1; // Start holding/calculating ground
         }
       clearFires();
       const netState = networkActions.getState();
       if (netState && netState.isHost && netState.broadcastEvent) {
          netState.broadcastEvent({ type: 'TRANSIT_MODE', state: false });
       }
    }
  }, [isTransitMode, clearFires]);

  useFrame((state, delta) => {
    // Only process if in the sky OR descending
    if (!isTransitMode && descentPhaseRef.current === 0) return;

    // Only the Host manages the minigame logic and power drain
    const netState = networkActions.getState();
    const isHost = netState ? netState.isHost : true;

    if (isHost) {
        // 1. Drain Battery based on active fires (ONLY during Long Warp)
        if (isLongWarping) {
            const drainMultiplier = activeFires.length > 0 ? activeFires.length * 50 : 5;
            drainShipPower(drainMultiplier * delta);

            // If out of fuel, Emergency Drift
            if (useStore.getState().shipCorePower <= 0) {
              useStore.getState().toggleTransitMode();
              setLongWarping(false);
          EventBus.emit('audio', { sound: 'explosion', source: 'local' });
          
          useStore.getState().damagePlayer(50);
          useStore.setState({ isSeated: false }); // FIX: Unseat the player
          
          // Failure: Teleport ship back down immediately
          const px = Math.floor(playerPosition.x);
          const pz = Math.floor(playerPosition.z);
          const shipPos = [px, 200, pz];
          
          useStore.getState().setShipTransform('default', shipPos, [0,0,0]);
          if (netState && netState.broadcastEvent) {
             netState.broadcastEvent({ type: 'SHIP_TRANSFORM', position: shipPos, rotation: [0,0,0] });
          }
          setTimeout(() => {
             const targetPos = [shipPos[0], shipPos[1] + 15, shipPos[2] - 3];
             useStore.setState({ forceTeleportPos: targetPos });
             if (netState && netState.broadcastEvent) {
                netState.broadcastEvent({ type: 'GLOBAL_PULL', targetPos });
             }
          }, 500);
          return;
        }
    }

        // 2. Warp Timer Success
        if (isLongWarping && descentPhaseRef.current === 0) {
            warpTimerRef.current -= delta * 1000;
            if (warpTimerRef.current <= 0) {
                descentPhaseRef.current = 1; // Enter Holding Pattern
                setLongWarping(false);
                EventBus.emit('audio', { sound: 'level_up', source: 'local' });
                
                const currentDestination = useStore.getState().shipDestination;
                const newSeed = currentDestination ? currentDestination : Math.floor(Math.random() * 1000000000);
                sessionStorage.setItem('saveSlotId', newSeed);
                useStore.getState().setWorldSeed(newSeed);
                useStore.getState().setShipDestination(null);
                
                pxRef.current = Math.floor(playerPosition.x);
                pzRef.current = Math.floor(playerPosition.z);
                
                useStore.getState().softResetWorld().then(() => {
                    if (networkActions.getState().purgeChunkQueue) {
                        networkActions.getState().purgeChunkQueue();
                    }
                    if (netState && netState.broadcastEvent) {
                        netState.broadcastEvent({ type: 'WELCOME', worldSeed: newSeed });
                    }
                    
                    // Teleport ship to Holding Pattern (Y=800) bypassing kill plane
                    const shipPos = [pxRef.current, 800, pzRef.current];
                    useStore.getState().setShipTransform('default', shipPos, [0,0,0]);
                    
                    setTimeout(() => {
                        const targetPos = [pxRef.current, 815, pzRef.current - 3];
                        useStore.setState({ forceTeleportPos: targetPos, isSeated: true }); // Auto-seat
                        if (netState && netState.broadcastEvent) {
                            netState.broadcastEvent({ type: 'GLOBAL_PULL', targetPos });
                            netState.broadcastEvent({ type: 'SHIP_TRANSFORM', position: shipPos, rotation: [0,0,0] });
                        }
                    }, 100);
                });
                return;
            }
        } else if (descentPhaseRef.current === 1) {
            // Holding Pattern at Y=800, wait for chunk to load
            const cx = Math.floor(pxRef.current / 16);
            const cz = Math.floor(pzRef.current / 16);
            const chunkKey = `${cx},${cz}`;
            const chunks = useChunkStore.getState().chunks;
            const chunk = chunks ? chunks[chunkKey] : null;
            
            // Wait for both buffer and meshArrays to ensure chunk is completely ready
            if (chunk && chunk.buffer && chunk.meshArrays) {
                // Chunk is loaded, calculate safe surface Y!
                let surfaceY = 60; // Fallback
                for (let xOffset = -16; xOffset <= 16; xOffset += 4) {
                    for (let zOffset = -16; zOffset <= 16; zOffset += 4) {
                        const checkX = pxRef.current + xOffset;
                        const checkZ = pzRef.current + zOffset;
                        const safeSpot = useStore.getState().findSafeFlatSpawn
                          ? useStore.getState().findSafeFlatSpawn(checkX, checkZ)
                          : null;
                        if (safeSpot && safeSpot.y > surfaceY) {
                            surfaceY = safeSpot.y;
                        }
                    }
                }
                targetSurfaceYRef.current = surfaceY + 3; // Prevent Keel Clipping
                descentPhaseRef.current = 2; // Begin smooth descent
            }
        } else if (descentPhaseRef.current === 2) {
              // Smooth Descent
              const shipTransform = shipTransforms.get('default');
              if (shipTransform && shipTransform.position.y > targetSurfaceYRef.current) {
                  const descentSpeed = 30 * delta; // 30m/s descent
                  const nextY = Math.max(targetSurfaceYRef.current, shipTransform.position.y - descentSpeed);
                  const shipPos = [shipTransform.position.x, nextY, shipTransform.position.z];
                
                // ONLY local setShipTransform. networkActions.js 30Hz loop handles broadcasting
                useStore.getState().setShipTransform('default', shipPos, [0,0,0]);
            } else {
                // Landed!
                if (isTransitMode) useStore.getState().toggleTransitMode();
                descentPhaseRef.current = 0;
                useStore.setState({ isSeated: false }); // Unseat player
            }
        }

        // 3. Glitch Storms (Spawn Fires) - ONLY during Long Warp
        const now = performance.now();
        // Spawn faster as time goes on or just every 3 seconds
        if (isLongWarping && descentPhaseRef.current === 0 && now - lastGlitchRef.current > GLITCH_INTERVAL && activeFires.length < 15) {
          lastGlitchRef.current = now;
          
          const rx = Math.floor(Math.random() * SHIP_SIZE_X);
          const rz = Math.floor(Math.random() * SHIP_SIZE_Z);
          
          let spawnY = 15;
          let foundVoxel = false;
          const { shipBuffer } = useStore.getState();
          if (shipBuffer) {
              for (let y = SHIP_SIZE_Y - 1; y >= 0; y--) {
                  const idx = y * (SHIP_SIZE_X * SHIP_SIZE_Z) + rz * SHIP_SIZE_X + rx;
                  if ((shipBuffer[idx] & 0xff) !== 0) {
                      spawnY = y + 1; // spawn on top of highest solid voxel
                      foundVoxel = true;
                      break;
                  }
              }
          }
          
          if (!foundVoxel) return; // Abort if column is empty
          
          const fireId = `fire_${Date.now()}_${Math.random()}`;
          const pos = [rx, spawnY, rz];
          
          spawnFire(fireId, pos);
          EventBus.emit('audio', { sound: 'damage', source: 'local' });
          
          // Broadcast to guests
          if (netState && netState.broadcastEvent) {
             netState.broadcastEvent({ type: 'SPAWN_FIRE', id: fireId, pos });
          }
        }
    }
  });

  return null;
};

