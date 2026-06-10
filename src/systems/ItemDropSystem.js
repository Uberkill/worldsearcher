import { EventBus } from '../utils/EventBus';
import { useInventoryStore } from '../stores/inventorySlice';
import { useConnectionStore } from '../stores/connectionSlice';
import { getNetworkStore } from '../stores/storeLinker';
import { v4 as uuidV4 } from 'uuid';

export const initItemDropSystem = () => {
  // Keyed listener ensures HMR safety
  EventBus.on('EVENT_BLOCK_DESTROYED', 'item_drop_single', (payload) => {
    const { isHost } = useConnectionStore.getState();
    if (!isHost) return; // Guests do not spawn items locally (host authority)

    const { x, y, z, texName, chestItems, causedByGravity } = payload;
    if (causedByGravity) return;

    const newDrops = [];
    const netActions = getNetworkStore();

    // 1. Core Block Drop
    const dropKey = uuidV4();
    const dropPos = [
      x + 0.5 + (Math.random() - 0.5) * 0.4,
      y + 0.5 + (Math.random() - 0.5) * 0.4,
      z + 0.5 + (Math.random() - 0.5) * 0.4
    ];
    newDrops.push({ key: dropKey, pos: dropPos, texture: texName });

    // 2. Chest Content Drops
    if (texName === 'chest' && chestItems) {
      chestItems.forEach(item => {
        if (item) {
          newDrops.push({
            key: uuidV4(),
            pos: [x + 0.5 + Math.random() * 0.5, y + 0.5, z + 0.5 + Math.random() * 0.5],
            texture: item.texture,
            count: item.count
          });
        }
      });
      // Delete chest from state
      useInventoryStore.setState(prev => {
        const nextChests = { ...prev.chests };
        delete nextChests[`${x},${y},${z}`];
        return { chests: nextChests };
      });
    }

    // Apply state and broadcast spawns
    useInventoryStore.setState(prev => {
      let droppedItems = [...(prev.droppedItems || []), ...newDrops];
      if (droppedItems.length > 1000) droppedItems = droppedItems.slice(-1000);
      return { droppedItems };
    });

    if (netActions) {
      newDrops.forEach(drop => {
        netActions.getState().broadcastEvent({
          type: 'ENTITY_SPAWN_EVENT',
          entityType: 'droppedItem',
          ...drop
        });
      });
    }
  });

  // Bulk listener to optimize item stack consolidation
  EventBus.on('EVENT_BLOCKS_DESTROYED_BULK', 'item_drop_bulk', (payload) => {
    const { isHost } = useConnectionStore.getState();
    if (!isHost) return;

    const { blocks, causedByGravity } = payload;
    if (causedByGravity) return;

    const consolidatedDrops = new Map(); // texture -> count
    let dropCentroid = [0, 0, 0];

    blocks.forEach(b => {
      consolidatedDrops.set(b.texName, (consolidatedDrops.get(b.texName) || 0) + 1);
      dropCentroid[0] += b.x;
      dropCentroid[1] += b.y;
      dropCentroid[2] += b.z;
    });

    dropCentroid = dropCentroid.map(val => val / blocks.length);

    const newDrops = [];
    consolidatedDrops.forEach((count, texture) => {
      // Spawn items in stacks of max 64
      let remaining = count;
      while (remaining > 0) {
        const batch = Math.min(64, remaining);
        remaining -= batch;
        newDrops.push({
          key: uuidV4(),
          pos: [
            dropCentroid[0] + (Math.random() - 0.5) * 0.8,
            dropCentroid[1] + 0.5,
            dropCentroid[2] + (Math.random() - 0.5) * 0.8
          ],
          texture,
          count: batch
        });
      }
    });

    useInventoryStore.setState(prev => {
      let droppedItems = [...(prev.droppedItems || []), ...newDrops];
      if (droppedItems.length > 1000) droppedItems = droppedItems.slice(-1000);
      return { droppedItems };
    });

    const netActions = getNetworkStore();
    if (netActions) {
      newDrops.forEach(drop => {
        netActions.getState().broadcastEvent({
          type: 'ENTITY_SPAWN_EVENT',
          entityType: 'droppedItem',
          ...drop
        });
      });
    }
  });
};
