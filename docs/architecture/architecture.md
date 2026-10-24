# Architecture Overview

For high-level performance and scene graph invariants, see [Architecture & Performance Guidelines](../ARCHITECTURE.md). For complete network protocols and packet bitlayouts, see [Multiplayer & Networking Specification](../systems/MULTIPLAYER.md).

---

## Technology Stack

World Searcher is built using a modern, high-performance web tech stack optimized for massive 3D voxel environments and real-time multiplayer networking.

- **Frontend Framework:** React 19 + Vite
- **3D Engine:** Three.js via React Three Fiber (R3F)
- **3D Utilities:** `@react-three/drei` (Controls, Textures, Helpers)
- **Physics Engine:** `@react-three/rapier` (Rust-based WASM Physics)
- **Post-Processing:** `@react-three/postprocessing` (SSAO, Bloom, Tonemapping)
- **State Management:** Zustand (Slice-based atomic architecture)
- **Multiplayer Networking:** PeerJS (WebRTC Data Channels for ultra-low latency P2P syncing)
- **Styling:** TailwindCSS 4 + Framer Motion (for UI overlays)
- **Persistence:** IndexedDB via `idb-keyval` (Client-side offline storage)
- **Testing & Verification:** Vitest (Unit/Engine simulation) + Playwright (Headless/Chrome multi-browser E2E)

---

## Hybrid Network Tick Architecture

World Searcher leverages a **Deterministic Server Tick Rate (30Hz)** combined with a high-frequency **144Hz Visual Interpolation Pipeline**. This decoupled architecture prevents physics race conditions and perfectly synchronizes the host and guest clients regardless of monitor refresh rates.

### The Physics Accumulator (`useBeforePhysicsStep`)
All game logic (player physics translation, WASD velocity assignments, hitscan combat raycasts, and swarm pathfinding) runs strictly inside a `30Hz` tick loop natively provided by setting `timeStep={1/30}` on the `@react-three/rapier` engine.
- **Death Spiral Prevention**: If a player backgrounds their browser, the JS `delta` time creates a massive backlog. The accumulator limits the catch-up to a maximum of 10 ticks per frame, dropping stale ticks to prevent the browser from crashing.

### Visual Interpolation (`useFrame`)
To maintain fluid visuals, the camera and local player meshes read high-frequency physics rigid bodies. Network guests and enemy swarms run as `kinematicPosition` rigid bodies. When network updates arrive, the 144Hz `useFrame` interpolates entity visuals based on a Snapshot Buffer, ensuring smooth movement "in the past" to hide network latency.

### Dual-Channel WebRTC Architecture
Multiplayer traffic splits across two channels:
- **Unreliable Channel (`label: 'movement'`):** High-frequency 30Hz binary `PLAYER_MOVE` packets (Type 1, 63 bytes) streamed without retransmission to eliminate head-of-line blocking.
- **Reliable Channel:** SCTP retransmitted channel for `WELCOME`, `BLOCK_DELTA` (Type 2), `CHUNK_PRISTINE`, `WORLD_SYNC_RLE`, and ship piloting events (`REQUEST_HELM`, `HELM_UPDATE`, `SHIP_TRANSFORM`).
- Full binary schemas and packet bitlayouts are documented in [Multiplayer Specification](../systems/MULTIPLAYER.md).

### Rendering Architecture (Zero-Cost DataTextures)
Instead of utilizing heavy 3D rendering passes for environmental occlusion (like stopping rain inside a house), the engine leverages 2D WebGL `DataTexture` arrays. A 512x512 Cyclical `Float32Array` tracks the highest opaque block per (X,Z) coordinate. This transfers the entire occlusion workload into an O(1) shader lookup, keeping GPU frame times <1ms.

---

## Core Folder Structure

```text
├── e2e/                # Playwright Multi-Browser End-to-End Test Suites
│   ├── multiplayer_gameplay_scenarios.spec.ts # Full simulation (move, build, boat, chat, telemetry)
│   ├── multiplayer_live.spec.ts               # WebRTC connection & streaming verification
│   ├── chunk_memory.spec.ts                   # WebGL chunk render & memory load verification
│   └── persistence.spec.ts                    # Save slot & IndexedDB verification
├── tests/              # Vitest Unit & Engine Test Suites
│   ├── setup.ts        # Test environment polyfills (IndexedDB, WebRTC, Canvas)
│   ├── engine/         # Subsystem test suites (multiplayer-sync, physics, items, commands)
│   └── architecture-integrity.test.ts # Zero-allocation AST rules
├── src/
│   ├── components/     # React Components (UI and 3D Scene Elements)
│   │   ├── ui/         # 2D DOM Overlays (TitleScreen, Inventory, HUD, SpectorModal)
│   │   ├── Player.tsx  # Presentation wrapper around local player
│   │   ├── ChunkRenderer.tsx # Native Three.js Imperative Render Pipeline
│   │   ├── ChunkPhysics.tsx  # Invisible Rapier physics colliders for chunk geometry
│   │   ├── ShipPhysics.tsx   # Dynamic vehicle rigid body & voxel collider generation
│   │   ├── Enemies.tsx       # Spawner and SwarmManager for entities
│   │   └── Tombstones.tsx    # Death system dropped items
│   ├── hooks/          # Custom React hooks containing decoupled systems
│   │   ├── usePlayerPhysics.ts      # Decoupled fixed physics accumulator loop (30Hz)
│   │   ├── useWorldLighting.ts      # Decoupled lighting updates for DynamicSky.tsx
│   │   └── useDebugOverlayUpdate.ts # Decoupled debug stats updates (F3 menu)
│   ├── stores/         # Zustand State Management (Modular Slices)
│   │   ├── useStore.ts              # Main store aggregator
│   │   ├── chunkSlice.ts            # Chunk generation, meshing, and modification state
│   │   ├── connectionSlice.ts       # WebRTC connection status and peer list
│   │   ├── chatSlice.ts             # In-game chat and notification store
│   │   ├── networkActions.ts        # Primary network dispatch interface
│   │   └── network/                 # Modular network sub-actions
│   │       ├── packetParser.ts      # Binary packet deserializer & peer relay engine
│   │       ├── connectionActions.ts # Host/join lifecycle, watchdog, and telemetry interception
│   │       ├── broadcastActions.ts  # Delta batching and binary buffer transmission
│   │       ├── chunkActions.ts      # Lazy chunk requesting and procedural fallback
│   │       └── chatActions.ts       # Broadcast and system message dispatch
│   ├── systems/        # Logic tick sub-systems
│   │   ├── network/             # Decoupled event bus listeners (Chat, Ship, WorldSync, Inventory)
│   │   ├── MachineTickSystem.ts # Off-tick crafting machine update loop
│   │   └── ItemDropSystem.ts    # Authoritative voxel item drop physics and consolidation
│   ├── utils/          # Pure Functions, Math, and Web Workers
│   │   ├── chunkData.ts       # 32-bit ECS bitpacking logic (Memory optimization)
│   │   ├── chunkGenerator.ts  # Procedural generation (Simplex Noise)
│   │   ├── workerPool.ts      # Web Worker management and queueing
│   │   ├── WebGLTracker.ts    # Low-level WebGL call hooking and telemetry
│   │   ├── db.ts              # Async Proxy to the IndexedDB Web Worker
│   │   └── NetworkEventBus.ts # Event bus for decoupled network payloads
│   ├── workers/        # Off-thread Web Workers
│   │   ├── chunkWorker.ts     # Heavy terrain generation and meshing
│   │   └── dbWorker.ts        # IndexedDB I/O and RLE Array Decompression
│   ├── globals.ts      # Global memory singletons (playerPosition, shipTransforms, __DEBUG_STATS__)
│   └── registry/       # Master block definition registry
```

---

## State & Dependency Architecture

Codebase modularization resolved key architectural bottlenecks:
- **The Core God Node (`useStore`)**: Monolithic dependencies are decoupled into isolated Zustand slices (`chunkSlice`, `inventorySlice`, `playerSlice`, `shipSlice`, `connectionSlice`). State synchronization uses lightweight patch operations.
- **Import Cycles**: Circular dependencies between audio, store, and player slices are eliminated via `storeLinker.ts` abstractions.
- **Peer Relay Engine**: The host acts as an active relay for `PLAYER_MOVE` and `BLOCK_DELTA` packets, forwarding guest updates across the peer mesh without requiring a centralized dedicated server.

---

## Database Schema (IndexedDB)

The application uses the browser's IndexedDB to save worlds persistently, utilizing `idb-keyval` for fast asynchronous key-value storage. Keys are prefixed by `saveSlotId`.

### Storage Keys
- **Save Slots Prefix:** Managed via `sessionStorage.getItem('saveSlotId') || 'default'`. In multiplayer guest mode, this is isolated to `multiplayer_guest`.
- **Chunks:** Stored as `[saveSlotId]_chunk_[cx],[cz]`.
  - **Data Format:** Strictly stored as `Uint32Array(81920)` buffers.
  - **Compression:** Run-Length Encoding (RLE) is applied via `compressRLE()` before persistence.
- **Ship Persistence:** Stored as `[saveSlotId]_ship` containing packed ship voxel data.
- **Guest Profiles:** Stored as `[saveSlotId]_guest_[playerId]` allowing players to resume inventory and coordinates when rejoining a host.
