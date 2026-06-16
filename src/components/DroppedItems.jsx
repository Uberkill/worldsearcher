import { useFrame } from '@react-three/fiber';
import { useStore } from '../stores/useStore';
import { useInventoryStore } from '../stores/inventorySlice';
import { useRef, useEffect, useMemo } from 'react';
import { playerPosition } from '../globals';
import { BlockRegistry } from '../registry/BlockRegistry';
import * as THREE from 'three';
import {
  InstancedRigidBodies,
  useRapier,
} from '@react-three/rapier';
import { networkActions } from '../stores/networkActions';

const MAX_DROPS = 256; // Optimized pool size for performance
const ITEM_GEO = new THREE.BoxGeometry(1, 1, 1);
const ITEM_MAT = new THREE.MeshLambertMaterial({ color: '#ffffff' }); // Color gets overridden by instanceColor
const _dummy = new THREE.Object3D();
const _color = new THREE.Color();

export const DroppedItems = () => {
  const droppedItems = useInventoryStore((state) => state.droppedItems);
  const { rapier, world } = useRapier();

  const physicsRef = useRef();
  const meshRef = useRef();

  const activeKeys = useRef(new Map()); // Map<itemKey, poolIndex>
  const freeIndices = useRef(
    Array.from({ length: MAX_DROPS }).map((_, i) => i)
  );
  const tweening = useRef(new Map()); // key -> { startTime, startPos }

  // Initialize pool geometry off-screen
  const instances = useMemo(
    () =>
      Array.from({ length: MAX_DROPS }).map((_, i) => ({
        key: i,
        position: [0, -100 - i * 2, 0],
        rotation: [0, 0, 0],
      })),
    []
  );

  useEffect(() => {
    // 1. Free despawned/collected items
    const currentKeys = new Set(droppedItems.map((d) => d.key));
    for (const [key, index] of activeKeys.current.entries()) {
      if (!currentKeys.has(key)) {
        activeKeys.current.delete(key);
        tweening.current.delete(key);
        freeIndices.current.push(index);

        // Bury dead physics body
        const rb =
          typeof physicsRef.current?.at === 'function'
            ? physicsRef.current.at(index)
            : physicsRef.current?.[index];
        if (rb) {
          rb.setTranslation({ x: 0, y: -100 - index * 2, z: 0 }, true);
        }

        // Hide visual mesh
        _dummy.position.set(0, -100 - index * 2, 0);
        _dummy.updateMatrix();
        if (meshRef.current) {
          meshRef.current.setMatrixAt(index, _dummy.matrix);
          meshRef.current.instanceMatrix.needsUpdate = true;
        }
      }
    }

    // 2. Spawn new items
    droppedItems.forEach((item) => {
      if (!activeKeys.current.has(item.key)) {
        const index = freeIndices.current.shift();
        if (index === undefined) return; // Pool full!

        activeKeys.current.set(item.key, index);

        const rb =
          typeof physicsRef.current?.at === 'function'
            ? physicsRef.current.at(index)
            : physicsRef.current?.[index];
        if (rb) {
          const rayOrigin = new THREE.Vector3(
            item.pos[0],
            item.pos[1],
            item.pos[2]
          );
          const rayDir = new THREE.Vector3(0, -1, 0);
          const hit = world.castRay(
            new rapier.Ray(rayOrigin, rayDir),
            100,
            false
          );

          if (hit) {
            rb.setTranslation(
              {
                x: item.pos[0],
                y: item.pos[1] - (hit.toi ?? hit.timeOfImpact) + 0.25,
                z: item.pos[2],
              },
              true
            );
          } else {
            rb.setTranslation(
              { x: item.pos[0], y: item.pos[1], z: item.pos[2] },
              true
            );
          }
        }
      }
    });
  }, [droppedItems, rapier, world]);

  const rejectCooldowns = useRef(new Map());

  useEffect(() => {
    const onReject = (e) => {
      tweening.current.delete(e.detail);
      rejectCooldowns.current.set(e.detail, performance.now() + 2000); // 2 second cooldown before trying to loot again
    };
    window.addEventListener('LOOT_REJECTED', onReject);
    return () => window.removeEventListener('LOOT_REJECTED', onReject);
  }, []);

  useFrame(({ clock, camera }) => {
    if (!physicsRef.current || !meshRef.current) return;
    const time = clock.elapsedTime;
    const state = useStore.getState();
    const inventoryState = useInventoryStore.getState();
    const netState = networkActions.getState();
    const currentItems = inventoryState.droppedItems || [];
    const renderDistance = state.renderDistance || 8;
    const maxDistSq = renderDistance * renderDistance * 256;

    let needsUpdate = false;
    const toDespawn = [];

    for (const item of currentItems) {
      const idx = activeKeys.current.get(item.key);
      if (idx === undefined) continue;

      const rb =
        typeof physicsRef.current?.at === 'function'
          ? physicsRef.current.at(idx)
          : physicsRef.current?.[idx];
      if (!rb) continue;

      const trans = rb.translation();

      let renderPos = { x: trans.x, y: trans.y, z: trans.z };

      // Auto-collect logic (magnet radius = 3 blocks -> distSq < 9)
      const dx = playerPosition.x - trans.x;
      const dy = playerPosition.y - trans.y;
      const dz = playerPosition.z - trans.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      const cooldown = rejectCooldowns.current.get(item.key) || 0;
      const pickupCooldown = item.pickupCooldown || 0;

      if (
        distSq < 9 &&
        !tweening.current.has(item.key) &&
        performance.now() > cooldown &&
        Date.now() > pickupCooldown
      ) {
        tweening.current.set(item.key, {
          startTime: performance.now(),
          startPos: new THREE.Vector3(trans.x, trans.y, trans.z),
        });
        // Fire LOOT_INTENT
        const intent = { type: 'LOOT_INTENT', dropId: item.key };
        netState.broadcastEvent(intent);
        if (netState.isHost) {
          netState.handleNetworkData(intent, {
            metadata: { playerId: netState.playerId },
          });
        }
      }

      // Client-Side Tweening
      if (tweening.current.has(item.key)) {
        const tweenData = tweening.current.get(item.key);
        const elapsed = performance.now() - tweenData.startTime;
        if (elapsed < 150) {
          const alpha = elapsed / 150;
          // Lerp from startPos to Camera Position
          const camPos = camera.position;
          renderPos.x = THREE.MathUtils.lerp(
            tweenData.startPos.x,
            camPos.x,
            alpha
          );
          renderPos.y = THREE.MathUtils.lerp(
            tweenData.startPos.y,
            camPos.y - 0.5,
            alpha
          ); // Pull slightly below eye level
          renderPos.z = THREE.MathUtils.lerp(
            tweenData.startPos.z,
            camPos.z,
            alpha
          );
        } else {
          // Wait for DESPAWN_LOOT or LOOT_REJECTED (which will clear it)
          const camPos = camera.position;
          renderPos.x = camPos.x;
          renderPos.y = camPos.y - 0.5;
          renderPos.z = camPos.z;
        }
      }

      // Phase 4: Void Item Memory Fog deletion (distance-based instead of Y < -10)
      if (renderPos.y < -100 || (dx * dx + dz * dz > maxDistSq)) {
        toDespawn.push(item.key);
        continue;
      }

      // Visually float and spin the inner mesh while the physics body rests on the floor
      _dummy.position.set(
        renderPos.x,
        renderPos.y + Math.sin(time * 3 + idx) * 0.1,
        renderPos.z
      );
      _dummy.rotation.set(0, time * 2 + idx, 0);
      _dummy.scale.set(0.25, 0.25, 0.25);
      _dummy.updateMatrix();
      meshRef.current.setMatrixAt(idx, _dummy.matrix);

      // Update Instance Color
      const reg = BlockRegistry[item.texture];
      _color.set(reg?.color ?? '#ffffff');
      meshRef.current.setColorAt(idx, _color);

      needsUpdate = true;
    }

    if (needsUpdate) {
      meshRef.current.instanceMatrix.needsUpdate = true;
      if (meshRef.current.instanceColor) {
        meshRef.current.instanceColor.needsUpdate = true;
      }
    }

    if (toDespawn.length > 0 && state.batchDespawnLoot) {
      state.batchDespawnLoot(toDespawn);
    }
  });

  return (
    <group>
      <InstancedRigidBodies
        ref={physicsRef}
        instances={instances}
        type="dynamic"
        colliders="cuboid"
        lockRotations={true}
        collisionGroups={0x00080008}
      >
        {/* We use a tiny collider box, visually the mesh is scaled to 0.25 */}
        <instancedMesh
          ref={meshRef}
          args={[ITEM_GEO, ITEM_MAT, MAX_DROPS]}
          castShadow={false}
          frustumCulled={false}
        >
          {/* Provide an initial color buffer so Three.js creates the attribute array */}
          <instancedBufferAttribute
            attach="instanceColor"
            args={[new Float32Array(MAX_DROPS * 3).fill(1), 3]}
          />
        </instancedMesh>
      </InstancedRigidBodies>
    </group>
  );
};
