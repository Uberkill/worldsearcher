# Architecture & Performance Guidelines

World Searcher is a voxel game engine engineered for high-throughput 60 FPS performance in modern web browsers, combining Three.js, React Three Fiber, Rapier physics, and multi-threaded Web Workers.

---

## 1. Scene Graph Architecture: Decoupled Geometry Pipeline

To maintain steady frame times, high-volume voxel chunk geometry must never be rendered as individual Virtual DOM elements within the React tree.

- **Native Three.js Pipeline (`ChunkRenderer.jsx`):** A dedicated render controller mounts directly into the Three.js scene graph via `useFrame`.
- **Imperative Lifecycle:** The renderer subscribes to state changes from `useChunkStore` and imperatively invokes `group.add(mesh)`, `group.remove(mesh)`, and `geometry.dispose()`.
- **Virtual DOM Overhead:** Keeping mesh nodes outside React reconciliation prevents costly tree diffing and garbage collection pauses during world streaming.

---

## 2. Worker Threading & Zero-Copy Transfers

All CPU-intensive terrain operations, Run-Length Encoding (RLE) decompression, and persistence queries run asynchronously in Web Workers.

- **Worker Proxy (`src/workers/dbWorker.js`):** Storage queries and chunk generation execute off the main thread.
- **Transferable Objects:** When exchanging raw buffer arrays (`Uint32Array`, `Float32Array`) between Web Workers and the main thread, memory buffers are passed via Transferable Objects (`postMessage(response, [array1.buffer, array2.buffer])`).
- **Memory Overhead:** Zero-copy transfers bypass structured cloning, eliminating memory duplication and avoiding V8 garbage collection spikes.

---

## 3. Physics vs. Visual Rendering Separation

Physics simulation and visual geometry follow distinct lifecycles:

- **Physics Colliders (`ChunkPhysics.jsx`):** Invisible Trimesh colliders mount directly into the `@react-three/rapier` physics simulation. Rapier executes natively via WebAssembly.
- **Visuals:** Mesh generation, LOD, and chunk visibility operate decoupled from physics bounds, allowing independent tuning of collision geometry and rendering fidelity.

---

## 4. Vehicle & Flight Coordinate Mathematics

The hybrid flight system maps 3D ship physics and hitboxes using strict coordinate rules:

1. **Memory Strides:** Ship voxel storage maps 1D typed arrays to local 3D coordinates using `Y * 1024 + Z * 32 + X`.
2. **Rotation Matrices:** Raycasting and trajectory calculations consume physical quaternions directly from the Rapier `RigidBody` rather than Euler representations, preventing Gimbal Lock during pitch and roll maneuvers.
3. **Resting Interpolation:** When a ship comes to rest, position vectors synchronize directly from rigid body resting states to maintain alignment.

---

## 5. State Management & Memory Safety

- **Zustand Slices:** World state, inventory, and player physics communicate across modular Zustand slices.
- **Frustum Culling:** Visibility queues stream meshes into view progressively per frame, maintaining a stable GPU memory footprint.
- **TypeScript Compliance:** Codebases enforce strict typing across interfaces in `src/types/` to prevent silent null references.
