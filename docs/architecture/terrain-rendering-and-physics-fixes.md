# Terrain Rendering and Physics Stability Fixes

This document serves as a historical record and architectural guide for the massive stability refactor applied to the Voxel Engine. These fixes specifically target the massive VRAM/memory leaks, face culling (rendering voids) issues, and terrain collision desynchronization.

## 1. Memory Leak & Garbage Collection Hardening
Previously, chunks would silently leak `ArrayBuffer` geometry data when players moved rapidly or broke blocks fast, eventually leading to Out-Of-Memory (OOM) crashes and frozen GPU states.

- **Centralized Recycling Hook (`worldActions.js`)**: Web Worker payloads carry decoupled `Float32Array` and `Uint32Array` geometry buffers (pos, norm, color, uv, idx) and meta-grids (heightmap). A global helper `recycleChunkDataInternal` was created to traverse and capture ALL arrays safely, funneling them into the `bufferRecycleQueue`.
- **Mid-Flight & Stale Cancellations**: Added strict boundary checks to ensure that if a chunk is mathematically superseded while its Worker is still generating it, the incoming stale payload is instantly discarded into the recycling queue rather than dropping into the void.
- **Unload/GC Parity**: The `unloadDistantChunks` and `tickGarbageCollection` intervals now correctly flush all buffers into the recycle queue before deleting the chunk from Zustand's `chunks` state.

## 2. Face Culling Glitches (Void Rendering)
Players experienced random chunk "faces" disappearing when looking around, caused by Three.js aggressively culling valid geometry.

- **BoundingBox Padding Removal (`ChunkRenderer.jsx`)**: The bounding box calculation included an artificial `+1` padding. This padding distorted the bounding sphere and caused the frustum culling matrix in `THREE.Mesh` to calculate incorrect intersections. Removing the `+1` padding restored perfect culling.

## 3. Light Overflow Boundary Bleed
Lighting updates (like placing a torch or breaking a wall to let sun in) on the edge of a chunk were failing to bleed into neighboring chunks, resulting in harsh black borders.

- **Unified Overflow Payloads (`chunkWorker.js`)**: Updated `generatePass2` to concatenate both `sunOverflow` and `blockOverflow` into a unified `lightOverflow` array.
- **Cross-Boundary Dispatch (`worldActions.js`)**: Built an imperative handler that parses the unified overflow queue, identifies the neighbor chunk coordinates, mutates their `buffer` directly, and flags them with `isModified: true` and a bumped `rebuildId` so their geometry rebuilds natively.

## 4. Physics Collision & Terrain Fall-Through Fixes
Players reported randomly falling through the ground, particularly into chunks that had just generated or had been modified (like jumping into a hole they just dug).

- **Dynamic Trimesh Re-Mounting (`ChunkPhysics.jsx`)**: `@react-three/rapier`'s `<TrimeshCollider>` component does **not** dynamically update its physical shape if its React `key` remains unchanged, even if the underlying vertices (`args`) change. The engine was using a deprecated `physicsRebuildId` that evaluated to `0`, locking the key to `"0-0"`. When a player broke a block, the new geometry arrived but the physics engine ignored it. We swapped the key to `chunkData.rebuildId`, correctly forcing React to remount and rebuild the physics BVH tree when the terrain changes.
- **Physics Loading Radius Expansion (`ChunkManager.jsx`)**: The active physics chunk grid was previously limited to a `5x5` radius around the player (`[-2, 2]`) and throttled to only update once every `10` frames (160ms). Fast-moving or falling players would quickly outrun this 32-block radius boundary, entering visually-loaded chunks that possessed no physical collision mesh yet, causing them to fall into the void. We expanded the physics radius to `7x7` (`[-3, 3]`) and reduced the throttle to `3` frames, providing a massive, highly-responsive solid cushion ahead of the player's velocity vector.

## 5. React Geometry Unmount Racing
Chunks would sometimes flash or leak if React unmounted the visual component before the Three.js geometry was explicitly disposed.

- **Reference Tracking (`ChunkRenderer.jsx`)**: Added an `isReused` reference parity check inside `disposeGeometries()`. Since multiple visual passes might temporarily share the same underlying geometry buffer before it finishes building, the engine now mathematically proves the buffer is no longer attached to any active React state before disposing of it.
- **`_isMounted` Flags**: Chunks in `worldActions.js` are now strictly flagged with `_isMounted = true` to prevent active meshes from being unmounted prematurely out from under React by the Garbage Collector.

## Warning to Future Agents
Always adhere strictly to these patterns when modifying the terrain engine. Never inject logic that detaches array buffers from the GC tracker, and always ensure `rebuildId` scales linearly with geometry modifications to keep Rapier physics synchronized.
