# World Search - Custom Voxel Engine

A high-performance custom voxel engine built natively for the browser using WebGL, Web Workers, Rapier physics, and WebRTC peer-to-peer multiplayer.

---

## Overview

World Search runs an interactive, deterministic voxel simulation directly within the browser, featuring procedural sky islands, drivable physics-based voxel vehicles, and real-time multiplayer terrain synchronization.

### Technical Highlights

- **Decoupled Three.js Rendering:** Bypasses React Virtual DOM reconciliation for high-volume mesh rendering (`ChunkRenderer.tsx`), maintaining steady 60 FPS frame rates under heavy terrain loads.
- **Multi-Threaded Chunk Processing:** CPU-intensive Run-Length Encoding (RLE) decompression and terrain generation run off the main thread inside Web Workers (`src/workers/dbWorker.ts`).
- **Zero-Copy Memory Transfers:** Raw geometry arrays (`Uint32Array`, `Float32Array`) transfer across worker boundaries via Transferable Objects, eliminating structured cloning and garbage collection stutter.
- **Physics Engine Integration:** Decoupled visual meshes from Rapier WebAssembly physics colliders (`ChunkPhysics.tsx`), supporting collision detection without rendering bottlenecks.
- **Physical Voxel Vehicles:** Real-time drivable ships utilizing quaternion orientation math and 1D-to-3D stride coordinates.
- **WebRTC Peer-to-Peer Mesh:** Dual-channel transport model splitting unreliable 30Hz position streaming from reliable block delta and state updates.
- **Offline & Network Persistence:** Entity persistence layer built on IndexedDB tables synchronized across WebRTC channels.

---

## Documentation

Full architectural specifications and system guides are available in the [`docs/`](docs/INDEX.md) directory:

- **[Documentation Index](docs/INDEX.md)**: Master index of all technical subsystem specifications.
- **[Architecture & Performance Guidelines](docs/ARCHITECTURE.md)**: Deep-dive into geometry streaming, worker pipelines, and memory optimization.
- **[System Architecture](docs/architecture/architecture.md)**: High-level architectural overview, tick loops, and folder structure.
- **[Multiplayer & Networking](docs/systems/MULTIPLAYER.md)**: WebRTC mesh topology, dual-channel transport, binary packet bitlayouts, and peer relays.
- **[Vehicle Physics & Mechanics](docs/systems/shipdesign.md)**: Flight coordinate math, collision geometry, and seating systems.
- **[Machine & Item Physics](docs/systems/MACHINES.md)**: Off-tick crafting machines and authoritative item drop consolidation.
- **[Diagnostics & Telemetry](docs/systems/DIAGNOSTICS.md)**: WebGL profiler, memory trackers, and peer-to-peer network metrics.

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

---

## Verification & Testing

World Searcher maintains a comprehensive multi-tier test pyramid consisting of static typing, unit suites, engine integration tests, and multi-browser live end-to-end simulation.

| Command | Environment | Description |
| :--- | :--- | :--- |
| `npm run typecheck` | TypeScript (`tsc --noEmit`) | Validates 100% strict type safety across all components and stores. |
| `npm run test:unit` | Vitest (`jsdom`) | Runs all 19 unit test files (63/63 tests) covering ECS bitpacking, command parsing, item drops, and multiplayer sync. |
| `npm run test:engine` | Vitest (`jsdom`) | Runs engine-specific physics, memory, boundary, and logic tests. |
| `npm run test:godmode` | Vitest (`jsdom`) | Executes the full architectural integration suite and AST allocation checks. |
| `npm run test:e2e` | Playwright (`chromium`) | Runs all browser-based end-to-end tests against the Vite dev server. |

### Dedicated Playwright E2E Suites
```bash
# Full simulation: Room generation, WebRTC handshake, 30Hz move sync, voxel deltas, ship piloting, chat & telemetry
npx playwright test e2e/multiplayer_gameplay_scenarios.spec.ts

# Live dual-browser WebRTC connection, packet counting, and streaming verification
npx playwright test e2e/multiplayer_live.spec.ts

# WebGL chunk render performance and memory stability
npx playwright test e2e/chunk_memory.spec.ts

# Multi-slot IndexedDB world persistence and save isolation
npx playwright test e2e/persistence.spec.ts
```
