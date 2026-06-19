# Current System Capabilities

## 1. Engine & Rendering
- **32-Bit ECS Chunks:** All block data (Texture, Health, Light, AO) is bit-packed into a single `Uint32Array` buffer to eliminate object allocation.
- **Multi-Threaded Generation:** Procedural generation and greedy meshing run entirely in WebWorkers (`chunkWorkerPool.js`).
- **Imperative InstancedMesh Pipeline:** `ChunkRenderer.jsx` bypasses React's Virtual DOM to push matrices directly to WebGL buffers. Frustum culling visibility is managed natively inside `ChunkRenderer.jsx` by checking against `useChunkStore.getState().overflowChunks`.
- **Zero-Allocation Math Loops:** Critical render and physics loops hoist `THREE.Vector3` and `rapier.Ray` to module-scope variables to eliminate V8 Garbage Collection stuttering.

## 2. Physics & Vehicles (The Hybrid System)
- **Native 30Hz Fixed Tick:** `@react-three/rapier` natively locked to 30Hz (`timeStep={1/30}`).
- **Dynamic Voxel Ships:** Ships are massive `<RigidBody type="dynamic">` instances built dynamically from voxel blocks.
- **Native Stabilization:** Ship pitch and roll are mathematically locked at the C++ engine level using `enabledRotations={[false, true, false]}`. Ship steering utilizes purely deterministic `setAngvel`.
- **Authoritative Seating:** The `ship_helm` grants exclusive WASD authority. `ship_seat` blocks safely snap players using Amanatides-Woo DDA raycasting.

## 3. Networking & Persistence
- **Host-Authoritative Sync:** WebRTC (PeerJS) syncs physics and hitscans from Host to Guest at 30Hz, while clients visually interpolate movement at 144Hz in `useFrame`.
- **IndexedDB WAL Optimization:** World saving uses a pre-allocated static RLE compression buffer in `dbWorker.js` to eliminate GC pauses. Write latency is optimized to ~5ms.

---

> [!CAUTION]
> **Data Serialization Anti-Patterns (Historical Failures - Do NOT attempt these):**
> 
> - **IndexedDB Crashes:** Do NOT use `JSON.stringify` when saving chunks or blueprints to IndexedDB. It exceeds browser string memory limits. Save raw `Uint32Array` or `ArrayBuffer` payloads directly.
> - **WebRTC PeerJS Crashes:** Do NOT send massive strings over WebRTC data channels. You MUST serialize typed arrays using `Array.from()` to bypass memory bottlenecks.

---

## Pending Roadmap
1. **Purge IIFE Closures:** Refactor `worldActions.js` via an AST parser to purge the legacy `__patch` closures.
2. **VRAM Ghost Geometry Optimization:** `ChunkRenderer` currently allocates native Three.js geometry and uploads buffers to VRAM for *all* chunks, even those hidden by `overflowChunks`. The renderer must be updated to skip `buildGeometryNatively` entirely for `overflowChunks`.
3. **Double-Free Memory Corruption Fix Validation:** We proactively fixed a massive memory corruption bug where `worldActions.js` and `ChunkRenderer.jsx` were both queuing the exact same ArrayBuffers for Web Worker recycling. We must test to ensure memory leaks have been fully mitigated.
4. Refine multithreaded lighting synchronization to resolve edge-case cross-chunk flickers.
5. Expand E2E testing to cover multi-player collision and packet failure scenarios under simulated latency.
