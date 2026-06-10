# Project Architecture & State Memory

## Core Architectural Decisions
- **Decoupling of the Monolithic God Object**: The monolithic `useStore` has been split into isolated, specialized Zustand stores (`useChunkStore`, `useInventoryStore`, `useFlareStore`, etc.) to minimize unnecessary component re-renders and improve memory management.
- **Strangler Fig Interceptors**: To avoid breaking the existing codebase immediately, `worldActions.js` uses proxy interceptors inside its `setState` logic. Updates like `patch.droppedItems` and `patch.chunks` are caught and forwarded to the newly decoupled stores.
- **Voxel Chunk Fast-Path**: The main React thread never computes voxel greedy meshes. Dedicated web workers (`chunkWorker.js`) crunch the block data into typed arrays. `Chunk.jsx` reads these typed arrays and rapidly builds `BufferGeometry` arrays.
- **Custom AABB Frustum Culling**: Because native Three.js spherical culling fails for tall (320 blocks) voxel chunks, native `frustumCulled` is explicitly disabled (`false`) on chunk meshes, and custom `Box3` intersection logic against a `globalFrustum` is evaluated in a `useFrame` hook.

## Recent Bug Fixes
- **The "Zombie State" Monolith**: Fixed massive data desyncs where `droppedItems` and `tombstones` existed simultaneously in both the legacy God Store and the new `inventorySlice`. The old arrays were entirely purged.
- **Silent Voxel Failures**: Fixed a massive cascading failure where all block interactions (placing blocks, breaking blocks, explosions, throwing flares) silently failed because `worldActions.js` was trying to read the newly-decoupled chunks via legacy `state.chunks` and `get().chunks` bindings.
- **Infinite Memory Leaks & Far-Away Chunks**: Fixed a bug where `unloadChunk` would silently fail due to `get().chunks` evaluating to undefined. Chunks would stay in memory forever, rendering to infinity and draining memory. Replaced with `useChunkStore.getState().chunks`.
- **Physics Engine Broken Reads**: Fixed `structuralPhysics.js` and `fluidSystem.js` failing to compute gravity and liquids because they were reading from the old decoupled state object.
- **Missing Environment Shadows**: Fixed a hardcoded `castShadow={false}` on `Chunk.jsx` and `ChunkFlora.jsx` meshes, dynamically connecting them back to the `shadowQuality` setting so terrain casts realistic shadows again.

## Current State of the Code
- The world engine is stable and runs smoothly. 
- Voxel generation, mesh building, and asynchronous lighting are correctly deferred to Web Workers and smoothly uploaded to the GPU via double buffering without stuttering.
- Block interactions, gravity simulations, and fluid updates accurately interact with the decoupled Chunk Store.
- Object cleanup successfully disposes Three.js buffer geometries before React unmounts them to prevent WebGL VRAM leaks.

## Immediate Next Steps
- **Complete Decoupling**: Identify and eliminate any remaining legacy `get()` and `set()` wrappers in `worldActions.js` that rely on Strangulation Proxy patches, transitioning them fully to direct slice calls.
- **Combat & Swarm Managers**: Verify that Enemy AI and Swarm managers are fully capable of reading terrain data from the decoupled `chunkStore` for pathfinding.
- **Worker Optimization**: Monitor worker thread pool scaling under extreme conditions (like massive consecutive explosive chain reactions) to ensure the message queue doesn't lock up.
