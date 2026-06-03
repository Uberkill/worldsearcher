import React, { useRef, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useRapier, RigidBody, BallCollider } from '@react-three/rapier';
import * as THREE from 'three';
import { useStore } from '../stores/useStore';
import { useNetworkStore } from '../stores/useNetworkStore';
import { GlobalRegistry } from '../registry/Registry';

// Generates unique IDs for projectiles
let projIdCounter = 0;

export function HostCombat() {
    const { world, rapier } = useRapier();
    const networkStore = useNetworkStore.getState();
    const isHost = useNetworkStore(state => state.isHost);
    const [projectiles, setProjectiles] = useState([]);
    
    // Projectile limits and tracking
    const maxProjectiles = 100;
    
    useFrame(() => {
        if (!isHost) return;
        // 1. Process pending attacks
        const pendingAttacks = networkStore.popPendingAttacks();
        
        for (const attack of pendingAttacks) {
            const { senderId, weaponId, dir, origin, timestamp } = attack;
            
            const weaponDef = GlobalRegistry[weaponId];
            const combatStats = weaponDef?.combat;
            if (!combatStats) continue;
            
            // Validate Cooldown
            const lastTime = networkStore.lastAttackTimestamps[senderId] || 0;
            if (timestamp - lastTime < combatStats.cooldownMs * 0.9) {
                // Too fast, ignore (0.9 to allow slight network variance)
                continue;
            }
            useNetworkStore.setState(prev => ({
                lastAttackTimestamps: {
                    ...prev.lastAttackTimestamps,
                    [senderId]: timestamp
                }
            }));
            
            const originVec = new THREE.Vector3(origin[0], origin[1], origin[2]);
            const dirVec = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
            
            // Hitscan Resolution
            // Hitscan Resolution
            if (combatStats.type === 'hitscan') {
                const range = combatStats.range || 5;
                // Advance the origin to escape the shooter's own capsule collider!
                const startPos = originVec.clone().addScaledVector(dirVec, 0.5);
                const hit = world.castRay(new rapier.Ray(startPos, dirVec), range, false);
                
                if (hit && hit.collider) {
                    const hitUserData = hit.collider.userData; 
                    
                    if (hitUserData?.type === 'enemy') {
                        networkStore.broadcastEvent({ 
                            type: 'TAKE_DAMAGE', 
                            targetType: 'enemy', 
                            targetId: hitUserData.id, 
                            amount: combatStats.damage 
                        });
                        useStore.getState().damageEnemy(hitUserData.id, combatStats.damage);
                    } else if (hitUserData?.type === 'player' && hitUserData.id !== senderId) {
                        // Prevent shooting yourself even if the raycast somehow hits you
                        networkStore.broadcastEvent({ 
                            type: 'TAKE_DAMAGE', 
                            targetType: 'player', 
                            targetId: hitUserData.id, 
                            amount: combatStats.damage 
                        });
                        if (hitUserData.id === networkStore.playerId) {
                            useStore.getState().damagePlayer(combatStats.damage);
                        }
                    }
                }
            }
            
            // Projectile Resolution
            else if (combatStats.type === 'projectile') {
                const projId = `proj_${++projIdCounter}`;
                
                // Advance the origin slightly so it doesn't collide with the player shooting it
                const startPos = originVec.clone().addScaledVector(dirVec, 1.0);
                const velocity = dirVec.clone().multiplyScalar(combatStats.speed || 40);
                
                const newProj = {
                    id: projId,
                    position: [startPos.x, startPos.y, startPos.z],
                    velocity: [velocity.x, velocity.y, velocity.z],
                    damage: combatStats.damage,
                    createdAt: performance.now()
                };
                
                setProjectiles(prev => {
                    const next = [...prev, newProj];
                    if (next.length > maxProjectiles) next.shift();
                    return next;
                });
                
                // Broadcast to network for clients to render deterministic tracers
                networkStore.broadcastEvent({
                    type: 'SPAWN_PROJECTILE',
                    id: projId,
                    origin: [startPos.x, startPos.y, startPos.z],
                    velocity: [velocity.x, velocity.y, velocity.z]
                });
                
                // Locally trigger visual spawn
                useStore.getState().spawnVisualProjectile({
                    id: projId,
                    origin: [startPos.x, startPos.y, startPos.z],
                    velocity: [velocity.x, velocity.y, velocity.z]
                });
            }
        }
        
        // 2. Cleanup old physical projectiles to save memory
        const now = performance.now();
        setProjectiles(prev => {
            const valid = prev.filter(p => now - p.createdAt < 5000); // 5 sec max lifetime
            if (valid.length !== prev.length) return valid;
            return prev;
        });
    });
    
    // Render the physical rigidbodies
    if (!isHost) return null;
    
    return (
        <group>
            {projectiles.map(proj => (
                <HostProjectile 
                    key={proj.id} 
                    proj={proj} 
                    onImpact={(impactPoint, hitUserData) => {
                        // Impact resolved
                        setProjectiles(prev => prev.filter(p => p.id !== proj.id));
                        
                        // Broadcast impact event
                        networkStore.broadcastEvent({
                            type: 'PROJECTILE_IMPACT',
                            id: proj.id,
                            point: impactPoint
                        });
                        
                        // Locally destroy visual
                        useStore.getState().destroyVisualProjectile(proj.id, impactPoint);
                        
                        // Apply Damage
                        if (hitUserData?.type === 'enemy') {
                            networkStore.broadcastEvent({ type: 'TAKE_DAMAGE', targetType: 'enemy', targetId: hitUserData.id, amount: proj.damage });
                            useStore.getState().damageEnemy(hitUserData.id, proj.damage);
                        } else if (hitUserData?.type === 'player') {
                            networkStore.broadcastEvent({ type: 'TAKE_DAMAGE', targetType: 'player', targetId: hitUserData.id, amount: proj.damage });
                            if (hitUserData.id === networkStore.playerId) {
                                useStore.getState().damagePlayer(proj.damage);
                            }
                        }
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
            rbRef.current.setLinvel({ x: proj.velocity[0], y: proj.velocity[1], z: proj.velocity[2] }, true);
        }
    }, [proj.velocity]);

    return (
        <RigidBody 
            ref={rbRef}
            position={proj.position}
            type="dynamic"
            gravityScale={0.1} // Slight gravity for arrows/bullets
            ccd={true} // Continuous Collision Detection to prevent tunneling
            onIntersectionEnter={(payload) => {
                const hitPos = rbRef.current ? rbRef.current.translation() : proj.position;
                onImpact([hitPos.x, hitPos.y, hitPos.z], payload.colliderObject?.userData);
            }}
        >
            <BallCollider args={[0.2]} sensor />
        </RigidBody>
    );
}
