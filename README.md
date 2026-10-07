# World Search - Custom Voxel Engine

A high-performance custom voxel engine built natively for the browser using WebGL, Web Workers, Rapier physics, and WebRTC peer-to-peer multiplayer.

---

## Overview

World Search runs an interactive, deterministic voxel simulation directly within the browser, featuring procedural sky islands, drivable physics-based voxel vehicles, and real-time multiplayer terrain synchronization.

### Technical Highlights

- **Decoupled Three.js Rendering:** Bypasses React Virtual DOM reconciliation for high-volume mesh rendering (`ChunkRenderer.jsx`), maintaining steady 60 FPS frame rates under heavy terrain loads.
- **Multi-Threaded Chunk Processing:** CPU-intensive Run-Length Encoding (RLE) decompression and terrain generation run off the main thread inside Web Workers (`src/workers/dbWorker.js`).
- **Zero-Copy Memory Transfers:** Raw geometry arrays (`Uint32Array`, `Float32Array`) transfer across worker boundaries via Transferable Objects, eliminating structured cloning and garbage collection stutter.
- **Physics Engine Integration:** Decoupled visual meshes from Rapier WebAssembly physics colliders (`ChunkPhysics.jsx`), supporting collision detection without rendering bottlenecks.
- **Physical Voxel Vehicles:** Real-time drivable ships utilizing quaternion orientation math and 1D-to-3D stride coordinates.
- **Offline & Network Persistence:** Entity persistence layer built on IndexedDB tables synchronized across WebRTC channels.

---

## Documentation

Full architectural specifications and system guides are available in the [`docs/`](docs/INDEX.md) directory:

- **[Architecture & Performance Guidelines](docs/ARCHITECTURE.md)**: Deep-dive into geometry streaming, worker pipelines, and memory optimization.
- **[System Architecture](docs/architecture/architecture.md)**: Authoritative game tick loops and network packet structures.
- **[Vehicle Physics & Mechanics](docs/systems/shipdesign.md)**: Flight coordinate math, collision geometry, and seating systems.

---

## Getting Started

### Prerequisites
- Node.js v18 or higher
- npm v8 or higher

### Installation & Run
```bash
npm install
npm run dev
```

### Verification & Testing
```bash
npm run typecheck         # Verify TypeScript compilation
npm run test:unit         # Run engine unit tests
npm run test:godmode      # Run full architectural integration suite
```
