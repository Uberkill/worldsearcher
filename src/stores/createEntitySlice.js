import { v4 as uuidV4 } from 'uuid';
import { getNetworkStore } from './storeLinker';
import { useInventoryStore } from './inventorySlice';
import { useChunkStore } from './chunkSlice';

let pathfinderWorker = null;
if (typeof window !== 'undefined') {
  pathfinderWorker = new Worker(
    new URL('../workers/pathfinderWorker.js', import.meta.url),
    { type: 'module' }
  );
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (pathfinderWorker) {
      pathfinderWorker.terminate();
    }
  });
}

export const createEntitySlice = (set, get) => {
  if (pathfinderWorker) {
    pathfinderWorker.onmessage = (e) => {
      if (e.data.type === 'PATH_RESULT') {
        const { id, sequenceID, pathBuffer, length } = e.data;
        // Optional: We can recycle the old pathBuffer here if we want, but since they are small, GC handles it well.
        set(prev => ({
          resolvedPaths: { ...prev.resolvedPaths, [id]: { sequenceID, pathBuffer, length } }
        }));
      }
    };

    // Synchronize chunks already loaded at startup
    const initialChunks = useChunkStore.getState().chunks || {};
    for (const key in initialChunks) {
      if (initialChunks[key] && initialChunks[key].buffer) {
        pathfinderWorker.postMessage({
          type: 'UPDATE_CHUNK',
          chunkKey: key,
          buffer: initialChunks[key].buffer
        });
      }
    }

    // Subscribe to chunk store to sync additions, modifications, and removals
    let lastChunks = initialChunks;
    useChunkStore.subscribe((state) => {
      const currentChunks = state.chunks || {};
      if (currentChunks === lastChunks) return;

      for (const key in currentChunks) {
        const prev = lastChunks[key];
        const curr = currentChunks[key];
        if (!curr) continue;
        if (!prev || prev.buffer !== curr.buffer || prev.rebuildId !== curr.rebuildId) {
          if (curr.buffer) {
            pathfinderWorker.postMessage({
              type: 'UPDATE_CHUNK',
              chunkKey: key,
              buffer: curr.buffer
            });
          }
        }
      }

      for (const key in lastChunks) {
        if (!currentChunks[key]) {
          pathfinderWorker.postMessage({
            type: 'REMOVE_CHUNK',
            chunkKey: key
          });
        }
      }

      lastChunks = currentChunks;
    });
  }

  return {
    spawnLoot: (data) => {
      // data: { id, itemId, amount, position }
      const newItem = {
        key: data.id,
        texture: data.itemId,
        count: data.amount,
        pos: data.position,
        pickupCooldown: Date.now() + 1000,
      };
      useInventoryStore.setState((prev) => ({
        droppedItems: [...(prev.droppedItems || []), newItem],
      }));
    },
    despawnLoot: (id) => {
      useInventoryStore.setState((prev) => ({
        droppedItems: (prev.droppedItems || []).filter((item) => item.key !== id),
      }));
    },
    updateLootAmount: (id, newCount) => {
      useInventoryStore.setState((prev) => ({
        droppedItems: (prev.droppedItems || []).map((item) =>
          item.key === id ? { ...item, count: newCount } : item
        ),
      }));
    },
    bullets: [],
    spawnQueue: [],
    damageQueue: [],
    directDamageQueue: [],
    damageEnemy: (id, amount, type) =>
      set((prev) => ({
        directDamageQueue: [...prev.directDamageQueue, { id, amount, type }],
      })),
    shiftDirectDamageQueue: (id) =>
      set((prev) => ({
        directDamageQueue: prev.directDamageQueue.filter((q) => q.id !== id),
      })),
    hoverTarget: null,

    resolvedPaths: {}, // { [entityId]: { sequenceID, pathBuffer, length } }

    requestPath: (id, sequenceID, startPos, endPos) => {
      if (!pathfinderWorker) return;

      pathfinderWorker.postMessage({
        type: 'REQUEST_PATH',
        id,
        sequenceID,
        start: startPos,
        end: endPos,
      });
    },

    setHoverTarget: (pos) => set({ hoverTarget: pos }),

    collectDroppedItem: (key, texture, count = 1) => {
      const inv = get().inventory;
      // Check if we can stack (less than 64) or find an empty slot
      const canFit = inv.some(
        (slot) => !slot || (slot.texture === texture && slot.count < 64)
      );

      if (canFit) {
        const leftover = get().addInventoryItem(texture, count);
        if (leftover === 0) {
          useInventoryStore.setState((prev) => ({
            droppedItems: (prev.droppedItems || []).filter((item) => item.key !== key),
          }));
          const networkActions = getNetworkStore();
          if (networkActions) {
            networkActions
              .getState()
              .broadcastEvent({
                type: 'ACTION_INTENT',
                action: 'REMOVE_ITEM',
                key,
              });
          }
          return true;
        } else if (leftover < count) {
          // Update the dropped item with new leftover count
          useInventoryStore.setState((prev) => ({
            droppedItems: (prev.droppedItems || []).map((item) =>
              item.key === key ? { ...item, count: leftover } : item
            ),
          }));
          const networkActions = getNetworkStore();
          if (networkActions) {
            networkActions
              .getState()
              .broadcastEvent({
                type: 'ACTION_INTENT',
                action: 'UPDATE_ITEM_COUNT',
                key,
                count: leftover,
              });
          }
          return true; // We picked up *some* of it
        }
      }
      return false;
    },

    // NEW: Added to fix memory leak for items that aren't picked up
    removeDroppedItem: (key) => {
      useInventoryStore.setState((prev) => ({
        droppedItems: (prev.droppedItems || []).filter((item) => item.key !== key),
      }));
      const networkActions = getNetworkStore();
      if (networkActions) {
        networkActions
          .getState()
          .broadcastEvent({
            type: 'ACTION_INTENT',
            action: 'REMOVE_ITEM',
            key,
          });
      }
    },

    requestSpawn: (type, pos, level = 1) =>
      set((prev) => ({
        spawnQueue: [...prev.spawnQueue, { id: uuidV4(), type, pos, level }],
      })),
    shiftSpawnQueue: (id) =>
      set((prev) => ({
        spawnQueue: prev.spawnQueue.filter((q) => q.id !== id),
      })),

    requestAreaDamage: (pos, radius, amount, sourceId = null) => {
      const id = uuidV4();
      set((prev) => ({
        damageQueue: [
          ...prev.damageQueue,
          { id, pos, radius, amount, sourceId, timestamp: Date.now() },
        ],
      }));
      setTimeout(() => get().shiftDamageQueue(id), 500);

      const networkActions = getNetworkStore();
      if (networkActions) {
        networkActions.getState().broadcastEvent({
          type: 'ACTION_INTENT',
          action: 'AREA_DAMAGE',
          pos,
          radius,
          amount,
          sourceId,
        });
      }
    },
    shiftDamageQueue: (id) =>
      set((prev) => ({
        damageQueue: prev.damageQueue.filter((q) => q.id !== id),
      })),

    addBullet: (bullet) => {
      const key = uuidV4();
      set((prev) => ({
        bullets: [...prev.bullets, { ...bullet, key, createdAt: Date.now() }],
      }));
      const networkActions = getNetworkStore();
      if (networkActions) {
        networkActions.getState().broadcastEvent({
          type: 'ENTITY_SPAWN_EVENT',
          entityType: 'bullet',
          bullet: { ...bullet, key },
        });
      }
    },

    removeBullet: (key) => {
      set((prev) => ({ bullets: prev.bullets.filter((b) => b.key !== key) }));
      const networkActions = getNetworkStore();
      if (networkActions) {
        networkActions
          .getState()
          .broadcastEvent({
            type: 'ACTION_INTENT',
            action: 'REMOVE_BULLET',
            key,
          });
      }
    },

    addTombstone: (tombstone) => {
      useInventoryStore.setState((prev) => ({ tombstones: [...(prev.tombstones || []), tombstone] }));
      const networkActions = getNetworkStore();
      if (networkActions) {
        networkActions.getState().broadcastEvent({
          type: 'ENTITY_SPAWN_EVENT',
          entityType: 'tombstone',
          tombstone: tombstone,
        });
      }
    },

    removeTombstone: (id) => {
      useInventoryStore.setState((prev) => ({
        tombstones: (prev.tombstones || []).filter((t) => t.id !== id),
      }));
      const networkActions = getNetworkStore();
      if (networkActions) {
        networkActions
          .getState()
          .broadcastEvent({
            type: 'ACTION_INTENT',
            action: 'REMOVE_TOMBSTONE',
            key: id,
          });
      }
    },
  };
};
