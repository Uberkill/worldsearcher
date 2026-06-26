import { useEnvironmentStore } from '../environmentSlice';
import { useFlareStore } from '../flareSlice';
import { useChunkStore } from '../chunkSlice';
import { useInventoryStore } from '../inventorySlice';
import { chunkWorkerPool } from '../../utils/workerPool';
import { pendingRenderKeys } from '../../utils/chunkRenderSignal';
import { getCombinedState } from './stranglerInterceptors';
// mirrors isWorldReady — set below once store is live


import type { RootState } from '../../types/store';

export const createMeshMounting = (rawSet: any, rawGet: any) => {
  const set = rawSet;
  const get = rawGet;
  return {
mountNextMesh: (batchSize = 1) => {
  const chunkState = useChunkStore.getState();
  if (!chunkState.pendingMeshMounts || chunkState.pendingMeshMounts.length === 0) return;
  const actualBatchSize = Math.min(batchSize, chunkState.pendingMeshMounts.length);
  const batch = chunkState.pendingMeshMounts.slice(0, actualBatchSize);
  const nextChunks: Record<string, any> = {};
  const addedOverflow: string[] = [];
  const toRecycle: Record<string, any> = {};
  for (const nextMount of batch) {
    const existingChunk = useChunkStore.getState().chunks[nextMount.chunkKey];
    
    // Global Safety Net: If the queued mesh is older than the chunk's current state, discard it to prevent visual flicker!
    if (existingChunk && nextMount.rebuildId !== undefined && nextMount.rebuildId < (existingChunk.rebuildId || 0)) {
      if (nextMount.meshArrays) {
        for (const [key, group] of Object.entries(nextMount.meshArrays)) {
          if (!group._isCached) toRecycle[`${nextMount.chunkKey}_${key}_stale`] = group;
        }
      }
      continue;
    }

    if (!existingChunk) {
      if (nextMount.meshArrays) {
        for (const [key, group] of Object.entries(nextMount.meshArrays)) {
          if (!group._isCached) toRecycle[`${nextMount.chunkKey}_${key}`] = group;
        }
      }
      continue;
    } else {
      // Chunk exists! But if it's out of visual range, ChunkRenderer won't dispose it.
      // We must add the overwritten mesh arrays to the recycle queue!
      if (existingChunk.meshArrays) {
        const isVisual = useChunkStore.getState().overflowChunks.includes(nextMount.chunkKey);
        if (!isVisual || !existingChunk.meshArrays._isMounted) {
          for (const [key, group] of Object.entries(existingChunk.meshArrays)) {
            if (group && !group._isCached) toRecycle[`${nextMount.chunkKey}_${key}_old`] = group;
          }
        }
      }
    }
    const tightMeshArrays = nextMount.meshArrays || null;
    if (nextMount.meshArrays) {
      if (!addedOverflow.includes(nextMount.chunkKey)) {
        addedOverflow.push(nextMount.chunkKey);
      }
    }
    const existingChunkData = useChunkStore.getState().chunks[nextMount.chunkKey] || {};
    nextChunks[nextMount.chunkKey] = {
      ...existingChunkData,
      meshArrays: tightMeshArrays,
      physicsRebuildId: (existingChunkData.physicsRebuildId || 0) + 1
    };
    // Signal ChunkRenderer.useFrame: this chunk has fresh meshArrays
    pendingRenderKeys.add(nextMount.chunkKey);
  }
  const buffersToRecycle: ArrayBuffer[] = [];
  for (const group of Object.values(toRecycle)) {
    if (!group) continue;
    if (Array.isArray(group)) {
      for (const sub of group) {
        ['pos', 'norm', 'color', 'uv', 'packed', 'matrices', 'heightmap'].forEach(attr => {
          if (sub[attr] && sub[attr].buffer && sub[attr].buffer.byteLength > 0) {
            buffersToRecycle.push(sub[attr].buffer);
          }
        });
        if (sub.idx && sub.idx.buffer && sub.idx.buffer.byteLength > 0) {
          buffersToRecycle.push(sub.idx.buffer);
        }
      }
    } else {
      ['pos', 'norm', 'color', 'uv', 'packed', 'matrices', 'heightmap'].forEach(attr => {
        if (group[attr] && group[attr].buffer && group[attr].buffer.byteLength > 0) {
          buffersToRecycle.push(group[attr].buffer);
        }
      });
      if (group.idx && group.idx.buffer && group.idx.buffer.byteLength > 0) {
        buffersToRecycle.push(group.idx.buffer);
      }
    }
  }
  if (buffersToRecycle.length > 0) {
    get().queueBuffersForRecycling(buffersToRecycle);
  }
  (() => {
    const prev = getCombinedState(rawGet);
    const nextPending = prev.pendingMeshMounts.slice(actualBatchSize);
    const nextOverflow = [...prev.overflowChunks];
    for (const k of addedOverflow) {
      if (!nextOverflow.includes(k)) nextOverflow.push(k);
    }
    const __patch = ((prev: RootState) => ({
      pendingMeshMounts: nextPending,
      overflowChunks: nextOverflow,
      chunks: {
        ...prev.chunks,
        ...nextChunks
      }
    }))(prev);
    if (__patch.chunks !== undefined || __patch.pendingMeshMounts !== undefined || __patch.overflowChunks !== undefined || __patch.activePhysicsChunks !== undefined) {
      const cPatch = {};
      if (__patch.chunks !== undefined) cPatch.chunks = __patch.chunks;
      if (__patch.pendingMeshMounts !== undefined) cPatch.pendingMeshMounts = __patch.pendingMeshMounts;
      if (__patch.overflowChunks !== undefined) cPatch.overflowChunks = __patch.overflowChunks;
      if (__patch.activePhysicsChunks !== undefined) cPatch.activePhysicsChunks = __patch.activePhysicsChunks;
      useChunkStore.setState(cPatch);
    }
    if (__patch.debris !== undefined || __patch.fallingStructures !== undefined || __patch.chests !== undefined || __patch.droppedItems !== undefined || __patch.tombstones !== undefined) {
      const iPatch = {};
      if (__patch.debris !== undefined) iPatch.debris = __patch.debris;
      if (__patch.fallingStructures !== undefined) iPatch.fallingStructures = __patch.fallingStructures;
      if (__patch.chests !== undefined) iPatch.chests = __patch.chests;
      if (__patch.droppedItems !== undefined) iPatch.droppedItems = __patch.droppedItems;
      if (__patch.tombstones !== undefined) iPatch.tombstones = __patch.tombstones;
      useInventoryStore.setState(iPatch);
    }
    if (__patch.placedFlares !== undefined) useFlareStore.setState({
      placedFlares: __patch.placedFlares
    });
    if (__patch.worldTime !== undefined) {
      useEnvironmentStore.setState({
        worldTime: __patch.worldTime,
        currentDay: __patch.currentDay,
        isNightTime: __patch.isNightTime,
        isRaining: __patch.isRaining,
        skyColor: __patch.skyColor,
        fogDensity: (__patch as any).fogDensity
      });
    }
    if ((__patch as any).isResetting !== undefined || (__patch as any).batcherVersion !== undefined) {
      const rawPatch: any = {};
      if ((__patch as any).isResetting !== undefined) rawPatch.isResetting = (__patch as any).isResetting;
      if ((__patch as any).batcherVersion !== undefined) rawPatch.batcherVersion = (__patch as any).batcherVersion;
      rawSet(rawPatch);
    }
  })();
},
  };
};
