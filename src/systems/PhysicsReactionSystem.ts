// @ts-nocheck
import { EventBus } from '../utils/EventBus';
import { useConnectionStore } from '../stores/connectionSlice';
import { useStore } from '../stores/useStore';
import { useInventoryStore } from '../stores/inventorySlice';
import { wakeFluidsAround } from '../utils/fluidSystem';
import { checkStructuralIntegrity } from '../utils/structuralPhysics';

export const initPhysicsReactionSystem = () => {
  EventBus.on('EVENT_BLOCK_DESTROYED', 'physics_reaction_single', (payload) => {
    const { isHost } = useConnectionStore.getState();
    if (!isHost) return; // Guests let host authoritative delta drive physics changes

    const { x, y, z, causedByGravity } = payload;

    // 1. Wake fluids immediately
    wakeFluidsAround(useStore.getState, useStore.setState, x, y, z);

    // 2. Structural checks (deferred to prevent blocking main render thread)
    if (!causedByGravity) {
      setTimeout(() => {
        const dirs = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
        for (const [dx, dy, dz] of dirs) {
          const cluster = checkStructuralIntegrity(useStore.getState, x + dx, y + dy, z + dz);
          if (cluster) {
            const structureId = `fall_${x + dx}_${y + dy}_${z + dz}_${Date.now()}`;
            
            useInventoryStore.setState(prev => ({
              fallingStructures: [...(prev.fallingStructures || []), { id: structureId, blocks: cluster }]
            }));
            
            // Remove fallen blocks in bulk
            useStore.getState().removeCubesBulk(cluster, true);
          }
        }
      }, 50);
    }
  });

  // Bulk physics checks
  EventBus.on('EVENT_BLOCKS_DESTROYED_BULK', 'physics_reaction_bulk', (payload) => {
    const { isHost } = useConnectionStore.getState();
    if (!isHost) return;

    const { blocks, causedByGravity } = payload;

    // Wake fluids around all broken blocks
    blocks.forEach(b => {
      wakeFluidsAround(useStore.getState, useStore.setState, b.x, b.y, b.z);
    });

    if (!causedByGravity) {
      setTimeout(() => {
        // Collect and dedup adjacent blocks to check structural support once
        const checkedSet = new Set();
        const dirs = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];

        blocks.forEach(b => {
          for (const [dx, dy, dz] of dirs) {
            const tx = b.x + dx;
            const ty = b.y + dy;
            const tz = b.z + dz;
            const key = `${tx},${ty},${tz}`;
            if (checkedSet.has(key)) continue;
            checkedSet.add(key);

            const cluster = checkStructuralIntegrity(useStore.getState, tx, ty, tz);
            if (cluster) {
              const structureId = `fall_${tx}_${ty}_${tz}_${Date.now()}`;
              useInventoryStore.setState(prev => ({
                fallingStructures: [...(prev.fallingStructures || []), { id: structureId, blocks: cluster }]
              }));
              useStore.getState().removeCubesBulk(cluster, true);
            }
          }
        });
      }, 50);
    }
  });
};

