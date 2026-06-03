import { v4 as uuidV4 } from 'uuid';
import { getNetworkStore } from './storeLinker';

let pathfinderWorker = null;
if (typeof window !== 'undefined') {
  pathfinderWorker = new Worker(new URL('../workers/pathfinderWorker.js', import.meta.url), { type: 'module' });
}

export const createEntitySlice = (set, get) => {
  if (pathfinderWorker) {
    pathfinderWorker.onmessage = (e) => {
       const oldData = get().flowFieldData;
       if (oldData && oldData.vectorField && oldData.vectorField.buffer.byteLength > 0) {
          // Recycle the old buffer back to the worker immediately to prevent GC stutter
          pathfinderWorker.postMessage({ recycleBuffer: oldData.vectorField.buffer }, [oldData.vectorField.buffer]);
       }
       set({ flowFieldData: e.data });
    };
  }
  
  return {
  droppedItems: [],
  spawnLoot: (data) => set((prev) => {
     // data: { id, itemId, amount, position }
     const newItem = { key: data.id, itemId: data.itemId, count: data.amount, pos: data.position };
     return { droppedItems: [...prev.droppedItems, newItem] };
  }),
  despawnLoot: (id) => set((prev) => ({
     droppedItems: prev.droppedItems.filter(item => item.key !== id)
  })),
  updateLootAmount: (id, newCount) => set((prev) => ({
     droppedItems: prev.droppedItems.map(item => item.key === id ? { ...item, count: newCount } : item)
  })),
  tombstones: [],
  bullets: [],
  spawnQueue: [],
  damageQueue: [],
  directDamageQueue: [],
  damageEnemy: (id, amount) => set(prev => ({
      directDamageQueue: [...prev.directDamageQueue, { id, amount }]
  })),
  shiftDirectDamageQueue: (id) => set(prev => ({
      directDamageQueue: prev.directDamageQueue.filter(q => q.id !== id)
  })),
  hoverTarget: null,
  
  flowFieldData: null, // { vectorField, origin, radius, width, height, depth }
  lastFlowFieldUpdate: 0,
  
  requestFlowFieldUpdate: (playerPos, chunks) => {
     const now = Date.now();
     // Throttle to 500ms max, but also depends on caller distance check
     if (now - get().lastFlowFieldUpdate < 500) return;
     if (!pathfinderWorker) return;
     
     // Only send the buffer arrays to save cloning time
     const chunkBuffers = {};
     for (const [key, chunk] of Object.entries(chunks)) {
        if (chunk.buffer) chunkBuffers[key] = chunk.buffer;
     }
     
     pathfinderWorker.postMessage({
        origin: [playerPos[0], playerPos[1], playerPos[2]],
        radius: 32, // 65x65x65 grid = ~64 block diameter
        chunks: chunkBuffers
     });
     
     set({ lastFlowFieldUpdate: now });
  },

  setHoverTarget: (pos) => set({ hoverTarget: pos }),
  
  collectDroppedItem: (key, texture, count = 1) => {
    const inv = get().inventory;
    // Check if we can stack (less than 64) or find an empty slot
    const canFit = inv.some(slot => !slot || (slot.texture === texture && slot.count < 64));
    
    if (canFit) {
      const leftover = get().addInventoryItem(texture, count);
      if (leftover === 0) {
        set((prev) => ({ droppedItems: prev.droppedItems.filter(item => item.key !== key) }));
        const useNetworkStore = getNetworkStore();
        if (useNetworkStore) {
            useNetworkStore.getState().broadcastEvent({ type: 'ACTION_INTENT', action: 'REMOVE_ITEM', key });
        }
        return true;
      } else if (leftover < count) {
        // Update the dropped item with new leftover count
        set((prev) => ({
          droppedItems: prev.droppedItems.map(item => item.key === key ? { ...item, count: leftover } : item)
        }));
        const useNetworkStore = getNetworkStore();
        if (useNetworkStore) {
            useNetworkStore.getState().broadcastEvent({ type: 'ACTION_INTENT', action: 'UPDATE_ITEM_COUNT', key, count: leftover });
        }
        return true; // We picked up *some* of it
      }
    }
    return false;
  },
  
  // NEW: Added to fix memory leak for items that aren't picked up
  removeDroppedItem: (key) => {
    set((prev) => ({
      droppedItems: prev.droppedItems.filter(item => item.key !== key)
    }));
    const useNetworkStore = getNetworkStore();
    if (useNetworkStore) {
        useNetworkStore.getState().broadcastEvent({ type: 'ACTION_INTENT', action: 'REMOVE_ITEM', key });
    }
  },
  
  requestSpawn: (type, pos, level = 1) => set((prev) => ({ 
    spawnQueue: [...prev.spawnQueue, { id: uuidV4(), type, pos, level }] 
  })),
  shiftSpawnQueue: (id) => set((prev) => ({ 
    spawnQueue: prev.spawnQueue.filter(q => q.id !== id) 
  })),
  
  requestAreaDamage: (pos, radius, amount) => {
    const id = uuidV4();
    set((prev) => ({ 
      damageQueue: [...prev.damageQueue, { id, pos, radius, amount, timestamp: Date.now() }] 
    }));
    setTimeout(() => get().shiftDamageQueue(id), 500);
    
    const useNetworkStore = getNetworkStore();
    if (useNetworkStore) {
        useNetworkStore.getState().broadcastEvent({
            type: 'ACTION_INTENT',
            action: 'AREA_DAMAGE',
            pos, radius, amount
        });
    }
  },
  shiftDamageQueue: (id) => set((prev) => ({ 
    damageQueue: prev.damageQueue.filter(q => q.id !== id) 
  })),
  
  addBullet: (bullet) => {
    const key = uuidV4();
    set((prev) => ({ bullets: [...prev.bullets, { ...bullet, key, createdAt: Date.now() }] }));
    const useNetworkStore = getNetworkStore();
    if (useNetworkStore) {
        useNetworkStore.getState().broadcastEvent({
            type: 'ENTITY_SPAWN_EVENT',
            entityType: 'bullet',
            bullet: { ...bullet, key }
        });
    }
  },
  
  removeBullet: (key) => {
     set((prev) => ({ bullets: prev.bullets.filter(b => b.key !== key) }));
     const useNetworkStore = getNetworkStore();
     if (useNetworkStore) {
        useNetworkStore.getState().broadcastEvent({ type: 'ACTION_INTENT', action: 'REMOVE_BULLET', key });
     }
  },
  
  addTombstone: (tombstone) => {
    set((prev) => ({ tombstones: [...prev.tombstones, tombstone] }));
    const useNetworkStore = getNetworkStore();
    if (useNetworkStore) {
        useNetworkStore.getState().broadcastEvent({
            type: 'ENTITY_SPAWN_EVENT',
            entityType: 'tombstone',
            tombstone: tombstone
        });
    }
  },
  
  removeTombstone: (id) => {
    set((prev) => ({ tombstones: prev.tombstones.filter(t => t.id !== id) }));
    const useNetworkStore = getNetworkStore();
    if (useNetworkStore) {
       useNetworkStore.getState().broadcastEvent({ type: 'ACTION_INTENT', action: 'REMOVE_TOMBSTONE', key: id });
    }
  },
  };
};
