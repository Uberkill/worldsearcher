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

import { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { BlockRegistry, BlockById, BlockKeyById } from '../registry/BlockRegistry';
import { getIndex, getTextureId, CHUNK_Y_MIN, CHUNK_Y_MAX } from '../utils/chunkData';
import { useStore } from '../stores/useStore';
import { useNetworkStore } from '../stores/useNetworkStore';
import { playerPosition } from '../globals';
import { sfxManager } from '../utils/SFXManager';

const MAX_REACH = 8; // blocks

// ── Amanatides-Woo Fast Voxel Traversal ──────────────────────────────────────
/**
 * @param {THREE.Vector3} origin   — ray start (camera world position)
 * @param {THREE.Vector3} dir      — unit direction vector
 * @param {number}        maxDist  — maximum distance in blocks
 * @param {Object}        chunks   — Zustand chunks map (chunkKey → {blocks})
 * @returns {{ block, bx, by, bz, face:[nx,ny,nz] } | null}
 *   block = the block data object that was hit
 *   bx/by/bz = block-centre world coords
 *   face = outward face normal of the hit face (the face the ray entered from)
 */
function castRayDDA(origin, dir, maxDist, chunks) {
  // ── Transform to DDA space ────────────────────────────────────────────────
  // No shifts needed. Block (ix,iy,iz) occupies [ix, ix+1].
  const ox = origin.x;
  const oy = origin.y;
  const oz = origin.z;
  const dx = dir.x, dy = dir.y, dz = dir.z;

  // Starting block index
  let ix = Math.floor(ox);
  let iy = Math.floor(oy);
  let iz = Math.floor(oz);

  // Step direction (±1 per axis)
  const stepX = dx >= 0 ? 1 : -1;
  const stepY = dy >= 0 ? 1 : -1;
  const stepZ = dz >= 0 ? 1 : -1;

  // tDelta: ray length to cross one full block in each axis
  const tDX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;

  // tMax: initial distance to the next boundary in each axis
  let tmX = dx > 0 ? (ix + 1 - ox) * tDX : dx < 0 ? (ox - ix) * tDX : Infinity;
  let tmY = dy > 0 ? (iy + 1 - oy) * tDY : dy < 0 ? (oy - iy) * tDY : Infinity;
  let tmZ = dz > 0 ? (iz + 1 - oz) * tDZ : dz < 0 ? (oz - iz) * tDZ : Infinity;

  // The face normal we entered the CURRENT block through (outward from the block)
  // Starts as "no face" — the camera's starting block is checked first.
  let face = [0, 0, 0];

  // Maximum iterations guard (prevents infinite loop; maxDist+3 is more than enough)
  const maxSteps = Math.ceil(maxDist) * 3 + 10;

  for (let step = 0; step < maxSteps; step++) {
    // ── Look up block at current DDA cell ───────────────────────────────────
    const bx = ix;           // block centre X  (integer)
    const by = iy;           // block centre Y  (integer)
    const bz = iz;           // block centre Z  (integer)

    const cx = Math.floor(bx / 16);
    const cz = Math.floor(bz / 16);
    const chunk = chunks[`${cx},${cz}`];
    if (chunk) {
      const lx = (bx % 16 + 16) % 16;
      const lz = (bz % 16 + 16) % 16;
      const ly = by; // Y is already integer block index
      if (ly >= CHUNK_Y_MIN && ly <= CHUNK_Y_MAX) {
        if (!chunk.buffer) {
           console.error("FATAL: chunk.buffer is undefined!", chunk);
           return null;
        }
        const val = chunk.buffer[getIndex(lx, ly, lz)];
        if (val !== undefined && val !== 0) {
          const tex = getTextureId(val);
          if (tex !== 0) {
            const blockDef = BlockById[tex];
            // Skip flora (invisible crossed-quads) and liquids — they are not
            // solid interactable blocks. The ray continues through them so the
            // player can click on the solid ground/block underneath.
            if (!blockDef?.isFlora && !blockDef?.isLiquid) {
              const block = { texture: BlockKeyById[tex], pos: [bx, by, bz] };
              return { block, bx, by, bz, face };
            }
          }
        }
      }
    }
    if (tmX < tmY) {
      if (tmX < tmZ) {
        if (tmX > maxDist) return null;
        ix += stepX; tmX += tDX;
        face = [-stepX, 0, 0];
      } else {
        if (tmZ > maxDist) return null;
        iz += stepZ; tmZ += tDZ;
        face = [0, 0, -stepZ];
      }
    } else {
      if (tmY < tmZ) {
        if (tmY > maxDist) return null;
        iy += stepY; tmY += tDY;
        face = [0, -stepY, 0];
      } else {
        if (tmZ > maxDist) return null;
        iz += stepZ; tmZ += tDZ;
        face = [0, 0, -stepZ];
      }
    }
  }

  return null;
}

// ── Component ─────────────────────────────────────────────────────────────────
const _dir = new THREE.Vector3();

export const BlockInteraction = () => {
  const { camera } = useThree();

  const setHoverTarget = useStore(state => state.setHoverTarget);
  const damageBlock    = useStore(state => state.damageBlock);
  const addCube        = useStore(state => state.addCube);

  // Last DDA result — updated every frame, consumed by mousedown handler
  const hitRef         = useRef(null);
  const prevTargetKey  = useRef(null); // "bx,by,bz" string — avoids calling setHoverTarget 60×/s

  // ── Fire DDA ray every frame for hover highlight ──────────────────────────
  useFrame(() => {
    camera.getWorldDirection(_dir);
    const chunks = useStore.getState().chunks;
    const hit = castRayDDA(camera.position, _dir, MAX_REACH, chunks);
    hitRef.current = hit;

    // Only call setHoverTarget when the targeted block CHANGES — not every frame.
    // Without this guard, GhostBlock re-renders at 60 fps even when stationary,
    // because Zustand notifies all subscribers on every setState call.
    const key = hit ? `${hit.bx},${hit.by},${hit.bz}` : null;
    if (key !== prevTargetKey.current) {
      prevTargetKey.current = key;
      setHoverTarget(hit ? [hit.bx, hit.by, hit.bz] : null);
    }
  });

  // ── Mouse click handler ────────────────────────────────────────────────────
  useEffect(() => {
    const onMouseDown = (e) => {
      // Only act when the pointer is locked (game is focused, UI is closed)
      if (!document.pointerLockElement) return;
      
      const hit = hitRef.current;
      if (!hit) return;
      const { block, bx, by, bz, face } = hit;
      const [nx, ny, nz] = face;

      // Handle Waypoint placement on Middle Mouse Click
      if (e.button === 1) {
         const { broadcastWaypoint } = useNetworkStore.getState();
         broadcastWaypoint(bx + 0.5 + nx * 0.5, by + 0.5 + ny * 0.5, bz + 0.5 + nz * 0.5);
         return;
      }
      
      // Only process left-click for building/breaking
      if (e.button !== 0) return;
      
      const state = useStore.getState();
      const activeTexture = state.texture;

      // TNT always explodes, regardless of tool
      if (block.texture === 'tnt') {
        state.triggerExplosion(bx, by, bz);
        sfxManager.play('explosion');
        return;
      }

      if (e.altKey || activeTexture === 'pickaxe') {
        // Force-break (alt key) or pickaxe → high damage
        damageBlock(bx, by, bz, 100);
        sfxManager.play('break');
        if (block.texture === 'log') {
          useStore.getState().unlockAchievement('getting_wood', 'Getting Wood', 'Punch a tree until it breaks', '🪵');
        }
      } else if (activeTexture === 'sword') {
        // Melee tool → moderate damage
        damageBlock(bx, by, bz, 35);
        sfxManager.play('break');
      } else if (activeTexture === 'gun') {
        // Gun fires bullet via Player.jsx, do NOT melee the block
      } else if (activeTexture === 'flare') {
        // Place flare on the surface of the clicked face
        const placeX = bx + nx;
        const placeY = by + ny;
        const placeZ = bz + nz;
        if (state.placeFlare(
          [bx + 0.5 + nx * 0.5, by + 0.5 + ny * 0.5, bz + 0.5 + nz * 0.5],
          [nx, ny, nz],
          `${placeX},${placeY},${placeZ}`
        )) {
            // Note: placeFlare logic might need returning a boolean similar to addCube
        }
        if (addCube(placeX, placeY, placeZ)) {
          sfxManager.play('place');
        }
      } else if (activeTexture === 'lantern' || activeTexture === 'flashlight') {
        // Carried items — no block interaction
      } else {
        if (!activeTexture) return; // Prevent empty hand from placing dirt!
        
        // Building block selected — place it adjacent to the hit face.
        const px = bx + nx;
        const py = by + ny;
        const pz = bz + nz;

        // Prevent placing block inside the player's physical hitbox
        const blockY = py; // py is now a pure integer
        const pPos = [playerPosition.x, playerPosition.y, playerPosition.z]; // [x, y, z] center of player capsule
        const intersects = (
          pPos[0] + 0.4 > px - 0.5 && pPos[0] - 0.4 < px + 0.5 &&
          pPos[1] + 0.8 > blockY - 0.5 && pPos[1] - 0.8 < blockY + 0.5 &&
          pPos[2] + 0.4 > pz - 0.5 && pPos[2] - 0.4 < pz + 0.5
        );

        if (intersects) {
          return; // Blocked!
        }

        if (addCube(px, py, pz)) {
          sfxManager.play('place');
        }
      }
    };

    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, [damageBlock, addCube]);

  return null; // purely logical — renders nothing
};
