/**
 * BlockInteraction.jsx — Amanatides-Woo DDA raycaster for block picking.
 *
 * WHY DDA AND NOT MESH RAYCASTING:
 *   Greedy meshing merges many 1×1×1 blocks into one large triangle. If you
 *   use Three.js's built-in raycaster against those triangles (e.g. e.point +
 *   e.face.normal from onClick), you get the position on the giant merged quad
 *   — not the specific 1×1×1 block that was clicked.
 *
 *   The Amanatides-Woo DDA algorithm avoids this entirely. It fires a
 *   mathematical ray through the CPU block data grid (the same Map/object that
 *   the chunk renderer reads), stepping from block-boundary to block-boundary
 *   at O(distance) cost. The visual mesh is never touched.
 *
 * DDA COORDINATE SYSTEM:
 *   Our blocks use a standard convention: all block meshes occupy [bx, bx+1].
 *   Block at integer index (bx, by, bz) occupies the AABB:
 *     X: [bx, bx+1]   Y: [by, by+1]   Z: [bz, bz+1]
 *
 *   To find the block index from world coordinates, we simply floor them:
 *     ox = camera.x,  oy = camera.y,  oz = camera.z
 *   Then floor(ox) gives the block integer index bx.
 *
 * USAGE:
 *   Mount <BlockInteraction /> anywhere inside the R3F Canvas. It renders nothing.
 *   It drives setHoverTarget every frame and fires block actions on mousedown.
 */

import { useRef, useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import * as THREE from 'three';
import {
  BlockById,
  BlockKeyById,
  BlockIds,
} from '../registry/BlockRegistry';
import {
  getIndex,
  getTextureId,
  CHUNK_Y_MIN,
  CHUNK_Y_MAX,
} from '../utils/chunkData';
import { useStore } from '../stores/useStore';
import { SHIP_CENTER_X, SHIP_CENTER_Y, SHIP_CENTER_Z } from '../stores/createShipSlice';
import { useChunkStore } from '../stores/chunkSlice';
import { useFlareStore } from '../stores/flareSlice';
import { networkActions } from '../stores/networkActions';
import { playerPosition, shipTransforms } from '../globals';
import { EventBus } from '../utils/EventBus';
import { GlobalRegistry } from '../registry/Registry';
import { InteractionRegistry } from '../registry/InteractionRegistry';

const MAX_REACH = 8; // blocks

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _shipPos = new THREE.Vector3();
const _target = new THREE.Vector3();
const _shipMat = new THREE.Matrix4();
const _invShipMat = new THREE.Matrix4();
const _shipScale = new THREE.Vector3(1, 1, 1);
const _shipLocalOrigin = new THREE.Vector3();
const _shipLocalDir = new THREE.Vector3();

const SHIP_SIZE_X = 32, SHIP_SIZE_Y = 32, SHIP_SIZE_Z = 32;

const _worldPos = new THREE.Vector3();

// ── Generic Digital Differential Analysis (DDA) Voxel Traverser ──
function traverseDDA(origin, dir, maxDist, checkVoxel) {
  const dx = dir.x, dy = dir.y, dz = dir.z;
  const EPSILON = 1e-6;
  const ox = origin.x + dx * EPSILON;
  const oy = origin.y + dy * EPSILON;
  const oz = origin.z + dz * EPSILON;

  let ix = Math.floor(ox);
  let iy = Math.floor(oy);
  let iz = Math.floor(oz);

  const stepX = dx >= 0 ? 1 : -1;
  const stepY = dy >= 0 ? 1 : -1;
  const stepZ = dz >= 0 ? 1 : -1;

  const tDX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;

  let tmX = dx > 0 ? (ix + 1 - ox) * tDX : dx < 0 ? (ox - ix) * tDX : Infinity;
  let tmY = dy > 0 ? (iy + 1 - oy) * tDY : dy < 0 ? (oy - iy) * tDY : Infinity;
  let tmZ = dz > 0 ? (iz + 1 - oz) * tDZ : dz < 0 ? (oz - iz) * tDZ : Infinity;

  let face = [0, 0, 0];
  const maxSteps = Math.ceil(maxDist) * 3 + 10;

  for (let step = 0; step < maxSteps; step++) {
    const res = checkVoxel(ix, iy, iz, face);
    if (res !== null && res !== undefined) {
      return res;
    }

    if (tmX < tmY) {
      if (tmX < tmZ) {
        if (tmX > maxDist) return null;
        ix += stepX;
        tmX += tDX;
        face = [-stepX, 0, 0];
      } else {
        if (tmZ > maxDist) return null;
        iz += stepZ;
        tmZ += tDZ;
        face = [0, 0, -stepZ];
      }
    } else {
      if (tmY < tmZ) {
        if (tmY > maxDist) return null;
        iy += stepY;
        tmY += tDY;
        face = [0, -stepY, 0];
      } else {
        if (tmZ > maxDist) return null;
        iz += stepZ;
        tmZ += tDZ;
        face = [0, 0, -stepZ];
      }
    }
  }

  return null;
}

function castRayShip(origin, dir, maxDist, shipBuffer, shipTransform) {
  if (!shipBuffer || !shipTransform) return null;

  const px = shipTransform.actualPosition ? shipTransform.actualPosition.x : shipTransform.position.x;
  const py = shipTransform.actualPosition ? shipTransform.actualPosition.y : shipTransform.position.y;
  const pz = shipTransform.actualPosition ? shipTransform.actualPosition.z : shipTransform.position.z;
  
  if (shipTransform.actualQuaternion) {
      _quat.set(shipTransform.actualQuaternion.x, shipTransform.actualQuaternion.y, shipTransform.actualQuaternion.z, shipTransform.actualQuaternion.w);
  } else {
      const rx = shipTransform.rotation.x;
      const ry = shipTransform.rotation.y;
      const rz = shipTransform.rotation.z;
      _euler.set(rx, ry, rz, 'XYZ');
      _quat.setFromEuler(_euler);
  }
  
  _shipPos.set(px, py, pz);
  _shipMat.compose(_shipPos, _quat, _shipScale);
  _invShipMat.copy(_shipMat).invert();
  
  _shipLocalOrigin.copy(origin).applyMatrix4(_invShipMat);
  _target.copy(origin).add(dir).applyMatrix4(_invShipMat);
  _shipLocalDir.copy(_target).sub(_shipLocalOrigin).normalize();
  
  _shipLocalOrigin.x += SHIP_CENTER_X + 0.5;
  _shipLocalOrigin.y += SHIP_CENTER_Y + 0.5;
  _shipLocalOrigin.z += SHIP_CENTER_Z + 0.5;

  return traverseDDA(_shipLocalOrigin, _shipLocalDir, maxDist, (bx, by, bz, face) => {
    if (bx >= 0 && bx < SHIP_SIZE_X && by >= 0 && by < SHIP_SIZE_Y && bz >= 0 && bz < SHIP_SIZE_Z) {
      const bufferIdx = bx + (bz * SHIP_SIZE_X) + (by * SHIP_SIZE_X * SHIP_SIZE_Z);
      const val = shipBuffer[bufferIdx];
      if (val !== undefined && val !== 0) {
        const tex = val & 0xff; // getTextureId equivalent
        if (tex !== 0) {
          const blockDef = BlockById[tex];
          if (!blockDef?.isFlora && !blockDef?.isLiquid) {
            const block = { texture: BlockKeyById[tex], pos: [bx, by, bz], isShip: true, sx: bx, sy: by, sz: bz };
            _worldPos.set(bx - SHIP_CENTER_X, by - SHIP_CENTER_Y, bz - SHIP_CENTER_Z).applyMatrix4(_shipMat);
            const dist = origin.distanceTo(_worldPos);
            return { block, bx, by, bz, face, isShip: true, dist };
          }
        }
      }
    }
    return null;
  });
}

function castRayDDA(origin, dir, maxDist, chunks) {
  return traverseDDA(origin, dir, maxDist, (bx, by, bz, face) => {
    const cx = Math.floor(bx / 16);
    const cz = Math.floor(bz / 16);
    const chunk = chunks[`${cx},${cz}`];
    if (chunk) {
      const lx = ((bx % 16) + 16) % 16;
      const lz = ((bz % 16) + 16) % 16;
      const ly = by; // Y is already integer block index
      if (ly >= CHUNK_Y_MIN && ly <= CHUNK_Y_MAX) {
        if (!chunk.buffer) {
          console.error('FATAL: chunk.buffer is undefined!', chunk);
          return null;
        }
        const val = chunk.buffer[getIndex(lx, ly, lz)];
        if (val !== undefined && val !== 0) {
          const tex = getTextureId(val);
          if (tex !== 0) {
            const blockDef = BlockById[tex];
            if (!blockDef?.isFlora && !blockDef?.isLiquid) {
              const block = { texture: BlockKeyById[tex], pos: [bx, by, bz] };
              const dist = Math.hypot((bx + 0.5) - origin.x, (by + 0.5) - origin.y, (bz + 0.5) - origin.z);
              return { block, bx, by, bz, face, dist };
            }
          }
        }
      }
    }
    return null;
  });
}

// ── Component ─────────────────────────────────────────────────────────────────
const _dir = new THREE.Vector3();

export const BlockInteraction = () => {
  const { camera } = useThree();
  const { rapier, world } = useRapier();

  const setHoverTarget = useStore((state) => state.setHoverTarget);
  const damageBlock = useStore((state) => state.damageBlock);
  const addCube = useStore((state) => state.addCube);
  
  // Last DDA result — updated every frame, consumed by mousedown handler
  const hitRef = useRef(null);
  const prevTargetKey = useRef(null); // "bx,by,bz" string — avoids calling setHoverTarget 60×/s

  // ── Fire DDA ray every frame for hover highlight ──────────────────────────
  useFrame(() => {
    try {
      camera.getWorldDirection(_dir);
      const storeState = useStore.getState();
      const chunks = useChunkStore.getState().chunks;
      
      const hitShip = castRayShip(camera.position, _dir, MAX_REACH, storeState.shipBuffer, shipTransforms.get('default'));
      const hitWorld = castRayDDA(camera.position, _dir, MAX_REACH, chunks);
      
      let hit = null;
      if (hitShip && hitWorld) {
          hit = hitShip.dist < hitWorld.dist ? hitShip : hitWorld;
      } else {
          hit = hitShip || hitWorld;
      }
      
      hitRef.current = hit;
      
      // Only call setHoverTarget when the targeted block CHANGES — not every frame.
      const key = hit ? `${hit.bx},${hit.by},${hit.bz},${hit.isShip ? 'ship' : 'world'}` : null;
      if (key !== prevTargetKey.current) {
        prevTargetKey.current = key;
        setHoverTarget(hit ? [hit.bx, hit.by, hit.bz] : null, hit ? hit.block : null);
      }
    } catch (err) {
      if (!window.__ERR_REPORTED_FRAME) {
         window.__ERR_REPORTED_FRAME = true;
         networkActions.getState().addChatMessage('useFrame Error: ' + err.message, 'system', 'System');
      }
    }
  });

  // ── Mouse click handler ────────────────────────────────────────────────────
  useEffect(() => {
    const onMouseDown = (e) => {
      try {
        // Only act when the pointer is locked (game is focused, UI is closed)
        if (!document.pointerLockElement) return;

        const state = useStore.getState();
        if (state.isUIActive && state.isUIActive()) return;

        const origin = camera.position;
        const clickDir = new THREE.Vector3();
        camera.getWorldDirection(clickDir);
        const raycaster = new THREE.Raycaster(origin, clickDir);

        let hitFlareId = null;
        let hitFlareDist = Infinity;
        const flares = useFlareStore.getState().placedFlares || [];
        const currentTransform = shipTransforms.get('default');

        const clickEuler = new THREE.Euler();
        const clickQuat = new THREE.Quaternion();
        const clickShipPos = new THREE.Vector3();
        const clickShipMat = new THREE.Matrix4();
        const clickInvShipMat = new THREE.Matrix4();
        const clickShipScale = new THREE.Vector3(1, 1, 1);

        if (currentTransform) {
          clickEuler.set(currentTransform.rotation.x, currentTransform.rotation.y, currentTransform.rotation.z, 'XYZ');
          clickQuat.setFromEuler(clickEuler);
          clickShipPos.set(
              currentTransform.actualPosition ? currentTransform.actualPosition.x : currentTransform.position.x, 
              currentTransform.actualPosition ? currentTransform.actualPosition.y : currentTransform.position.y, 
              currentTransform.actualPosition ? currentTransform.actualPosition.z : currentTransform.position.z
          );
          clickShipMat.compose(clickShipPos, clickQuat, clickShipScale);
        }

        // Check if we hit a flare (Left click only)
        if (e.button === 0) {
            for (const flare of flares) {
               let worldPos;
               if (flare.isShip && currentTransform) {
                   const localVec = new THREE.Vector3(flare.pos[0] - (SHIP_CENTER_X + 0.5), flare.pos[1] - (SHIP_CENTER_Y + 0.5), flare.pos[2] - (SHIP_CENTER_Z + 0.5));
                   localVec.applyMatrix4(clickShipMat);
                   worldPos = localVec;
               } else {
                   worldPos = new THREE.Vector3(flare.pos[0], flare.pos[1], flare.pos[2]);
               }
               
               const distToRay = raycaster.ray.distanceSqToPoint(worldPos);
               if (distToRay < 0.36) { 
                   const actualDist = origin.distanceTo(worldPos);
                   const toPoint = worldPos.clone().sub(origin);
                   if (toPoint.dot(clickDir) > 0 && actualDist < MAX_REACH && actualDist < hitFlareDist) {
                       hitFlareDist = actualDist;
                       hitFlareId = flare.id;
                   }
               }
            }
        }

        const hit = hitRef.current;
        const blockDist = hit ? origin.distanceTo(new THREE.Vector3(hit.bx + 0.5, hit.by + 0.5, hit.bz + 0.5)) : Infinity;

        // Flare was hit before any block
        if (hitFlareId && hitFlareDist < blockDist) {
            useFlareStore.getState().removeFlare(hitFlareId);
            EventBus.emit('audio', { sound: 'break', source: 'local' });
            return;
        }

        if (!hit) return;
        const { block, bx, by, bz, face } = hit;
        const [nx, ny, nz] = face;

      // Handle Waypoint placement on Middle Mouse Click
      if (e.button === 1) {
        const { broadcastWaypoint } = networkActions.getState();
        broadcastWaypoint(
          bx + 0.5 + nx * 0.5,
          by + 0.5 + ny * 0.5,
          bz + 0.5 + nz * 0.5
        );
        return;
      }

      if (state.isUIActive && state.isUIActive()) return;

      const applyShipVoxelChange = (x, y, z, val) => {
          state.setShipVoxel(x, y, z, val);
          const netState = networkActions.getState();
          const evt = { type: 'SHIP_VOXEL_UPDATE', x, y, z, val };
          if (netState.isHost) {
              netState.broadcastEvent(evt);
          } else {
              netState.connections[0]?.send(evt);
          }
      };
      
      const activeTexture = state.texture;

      // Handle Right Click for Interactive Blocks via InteractionRegistry
      if (e.button === 2) {
         const blockKey = BlockKeyById[block.id] || block.texture;
         
         // Priority Action: If holding a repair tool, bypass interaction and heal the ship
         if (activeTexture === 'repair_tool' || activeTexture === 'nanite_welder') {
            if (hit.isShip) {
                state.healShip(50);
                try { EventBus.emit('audio', { sound: 'ui_click', source: 'local' }); } catch(err){}
            }
            return;
         }
         
         if (InteractionRegistry[blockKey]) {
            const context = {
               state,
               netState: networkActions.getState(),
               useStore,
               EventBus,
               bx, by, bz,
               hit,
               block
            };
            InteractionRegistry[blockKey](context);
            return; // Interaction successfully handled
         }

         const isShipProtected = hit.isShip && !state.isBuildMode && state.gameMode?.toLowerCase() !== 'creative';

         if (activeTexture === 'pickaxe' || activeTexture === 'sword' || activeTexture === 'gun' || activeTexture === 'grapple' || activeTexture === 'gauss_rifle') {
            return; // Do nothing on right click with weapons/tools
         } else if (activeTexture === 'flare') {
            // Place flare on the surface of the clicked face
            const placeX = bx + nx;
            const placeY = by + ny;
            const placeZ = bz + nz;
            
            if (hit.isShip && (placeX < 0 || placeX >= 32 || placeY < 0 || placeY >= 32 || placeZ < 0 || placeZ >= 32)) {
                 return; // Don't place flare out of bounds on the ship
            }
            
            state.placeFlare(
              [bx + 0.5 + nx * 0.5, by + 0.5 + ny * 0.5, bz + 0.5 + nz * 0.5],
              [nx, ny, nz],
              `${hit.isShip ? 'ship_' : ''}${placeX},${placeY},${placeZ}`,
              hit.isShip
            );
            EventBus.emit('audio', { sound: 'place', source: 'local' });
            state.consumeActiveItem();
         } else if (activeTexture === 'lantern' || activeTexture === 'flashlight') {
            // Carried items - no block placement
         } else {
            if (!activeTexture) return; // Prevent empty hand from placing dirt!

            const registryItem = GlobalRegistry[activeTexture];
            if (registryItem && registryItem.type === 'tool') return;

            if (isShipProtected && BlockIds[activeTexture] && blockKey !== 'tnt') {
                // Trying to place a block outside of build mode
                EventBus.emit('audio', { sound: 'click', source: 'local' });
                return;
            }

            // Building block selected - place it adjacent to the hit face.
            const px = bx + nx;
            const py = by + ny;
            const pz = bz + nz;

            // Prevent placing block inside the player's physical hitbox
            let isBlocked = false;
            const pPos = [playerPosition.x, playerPosition.y, playerPosition.z]; 
            
            if (hit.isShip) {
                const currentTransform = shipTransforms.get('default');
                if (currentTransform) {
                    clickShipPos.set(
                        currentTransform.actualPosition ? currentTransform.actualPosition.x : currentTransform.position.x, 
                        currentTransform.actualPosition ? currentTransform.actualPosition.y : currentTransform.position.y, 
                        currentTransform.actualPosition ? currentTransform.actualPosition.z : currentTransform.position.z
                    );
                    const rx = currentTransform.actualRotation ? currentTransform.actualRotation.x : currentTransform.rotation.x;
                    const ry = currentTransform.actualRotation ? currentTransform.actualRotation.y : currentTransform.rotation.y;
                    const rz = currentTransform.actualRotation ? currentTransform.actualRotation.z : currentTransform.rotation.z;
                    clickEuler.set(rx, ry, rz, 'XYZ');
                    clickQuat.setFromEuler(clickEuler);
                    clickShipMat.compose(clickShipPos, clickQuat, clickShipScale);
                    clickInvShipMat.copy(clickShipMat).invert();
                    
                    const pLocal = new THREE.Vector3(pPos[0], pPos[1], pPos[2]).applyMatrix4(clickInvShipMat);
                    const pLocalGridX = pLocal.x + SHIP_CENTER_X + 0.5;
                    const pLocalGridY = pLocal.y + SHIP_CENTER_Y + 0.5;
                    const pLocalGridZ = pLocal.z + SHIP_CENTER_Z + 0.5;
                    
                    isBlocked = (pLocalGridX + 0.4 > px && pLocalGridX - 0.4 < px + 1 && pLocalGridY + 0.8 > py && pLocalGridY - 0.8 < py + 1 && pLocalGridZ + 0.4 > pz && pLocalGridZ - 0.4 < pz + 1);
                }
            } else {
                isBlocked = (pPos[0] + 0.4 > px && pPos[0] - 0.4 < px + 1 && pPos[1] + 0.8 > py && pPos[1] - 0.8 < py + 1 && pPos[2] + 0.4 > pz && pPos[2] - 0.4 < pz + 1);
            }

            if (isBlocked) {
              return; // Blocked!
            }

            if (hit.isShip) {
                 if (px < 0 || px >= 32 || py < 0 || py >= 32 || pz < 0 || pz >= 32) return; // Prevent out of bounds
                 
                 const inv = state.inventory;
                 const activeSlot = state.activeSlot;
                 const item = inv[activeSlot];
                 const isCreative = state.gameMode?.toLowerCase() === 'creative';
                 const hasItem = isCreative || (item && item.texture === activeTexture && item.count > 0);
                 if (hasItem) {
                     const newTexId = BlockIds[activeTexture];
                     if (newTexId) {
                         applyShipVoxelChange(px, py, pz, (100 << 8) | newTexId);
                         EventBus.emit('audio', { sound: 'place', source: 'local' });
                         if (!isCreative) state.consumeActiveItem();
                     }
                 }
            } else {
                if (addCube(px, py, pz)) {
                  EventBus.emit('audio', { sound: 'place', source: 'local' });
                }
            }
         }
         return; // Don't process further right-clicks
      }

      // Only process left-click for building/breaking
      if (e.button !== 0) return;

      const blockKey = block.texture;

      const isShipProtected = hit.isShip && !state.isBuildMode && state.gameMode?.toLowerCase() !== 'creative';

      // TNT always explodes, regardless of tool
      if (blockKey === 'tnt') {
        if (hit.isShip) {
           if (isShipProtected) state.damageShip(500);
           else applyShipVoxelChange(bx, by, bz, 0);
        } else {
           state.triggerExplosion(bx, by, bz);
        }
        EventBus.emit('audio', { sound: 'explosion', source: 'local' });
        return;
      }

      if (state.gameMode?.toLowerCase() === 'creative') {
        if (hit.isShip) {
           applyShipVoxelChange(bx, by, bz, 0);
        } else {
           state.removeCube(bx, by, bz);
        }
        EventBus.emit('audio', { sound: 'break', source: 'local' });
        return;
      }

      if (e.altKey || activeTexture === 'pickaxe') {
        // Force-break (alt key) or pickaxe - high damage
        if (hit.isShip) {
           if (isShipProtected) state.damageShip(100);
           else applyShipVoxelChange(bx, by, bz, 0);
        } else {
           damageBlock(bx, by, bz, 500);
        }
        EventBus.emit('audio', { sound: 'break', source: 'local' });
        if (blockKey === 'log') {
          useStore.getState().unlockAchievement('getting_wood', 'Getting Wood', 'Punch a tree until it breaks', 'dY');
        }
      } else if (activeTexture === 'sword') {
        // Melee tool - moderate damage
        if (hit.isShip) {
           if (isShipProtected) state.damageShip(35);
           else applyShipVoxelChange(bx, by, bz, 0);
        } else {
           damageBlock(bx, by, bz, 200);
        }
        EventBus.emit('audio', { sound: 'break', source: 'local' });
      } else {
        // Bare hands or holding non-tools - low damage
        if (hit.isShip) {
           if (isShipProtected) state.damageShip(20);
           else applyShipVoxelChange(bx, by, bz, 0);
        } else {
           damageBlock(bx, by, bz, 100);
        }
        EventBus.emit('audio', { sound: 'break', source: 'local' });
        if (blockKey === 'log') {
          useStore.getState().unlockAchievement('getting_wood', 'Getting Wood', 'Punch a tree until it breaks', 'dY');
        }
      }
      } catch (err) {
         networkActions.getState().addChatMessage('onMouseDown Error: ' + err.message, 'system', 'System');
      }
    };

    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, [damageBlock, addCube, camera]);

  return null; // purely logical — renders nothing
};
