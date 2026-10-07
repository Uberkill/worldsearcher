# Architecture Overview

## Technology Stack

The webglgame is built using a modern, high-performance web tech stack optimized for massive 3D voxel environments and real-time multiplayer networking.

- **Frontend Framework:** React 19 + Vite
- **3D Engine:** Three.js via React Three Fiber (R3F)
- **3D Utilities:** `@react-three/drei` (Controls, Textures, Helpers)
- **Physics Engine:** `@react-three/rapier` (Rust-based WASM Physics)
- **Post-Processing:** `@react-three/postprocessing` (SSAO, Bloom, Tonemapping)
- **State Management:** Zustand (Slice-based atomic architecture)
- **Multiplayer Networking:** PeerJS (WebRTC Data Channels for ultra-low latency P2P syncing)
- **Styling:** TailwindCSS 4 + Framer Motion (for UI overlays)
- **Persistence:** IndexedDB via `idb-keyval` (Client-side offline storage)

## Hybrid Network Tick Architecture

World Search leverages a **Deterministic Server Tick Rate (30Hz)** combined with a high-frequency **144Hz Visual Interpolation Pipeline**. This decoupled architecture prevents physics race conditions and perfectly synchronizes the host and guest clients regardless of monitor refresh rates.

### The Physics Accumulator (`useBeforePhysicsStep`)
All game logic (player physics translation, WASD velocity assignments, hitscan combat raycasts, and swarm pathfinding) runs strictly inside a `30Hz` tick loop natively provided by setting `timeStep={1/30}` on the `@react-three/rapier` engine.
- **Death Spiral Prevention**: If a player backgrounds their browser, the JS `delta` time creates a massive backlog. The accumulator limits the catch-up to a maximum of 10 ticks per frame, dropping stale ticks to prevent the browser from crashing.

### Visual Interpolation (`useFrame`)
To maintain fluid visuals, the camera and local player meshes read high-frequency physics rigid bodies. Network guests and enemy swarms run as `kinematicPosition` rigid bodies. When network updates arrive, the 144Hz `useFrame` interpolates the entity visuals based on a Snapshot Buffer, ensuring smooth movement "in the past" to hide network latency.

### Rendering Architecture (Zero-Cost DataTextures)
Instead of utilizing heavy 3D rendering passes for environmental occlusion (like stopping rain inside a house), the engine leverages 2D WebGL `DataTexture` arrays. A 512x512 Cyclical `Float32Array` tracks the highest opaque block per (X,Z) coordinate. This transfers the entire occlusion workload into an O(1) shader lookup, keeping GPU frame times <1ms.

## Core Folder Structure

```text
/src
├── components/         # React Components (UI and 3D Scene Elements)
│   ├── ui/             # 2D DOM Overlays (TitleScreen, Inventory, HUD, SpectorModal)
│   ├── Player.tsx      # Thin presentation wrapper around Player position
│   ├── ChunkRenderer.tsx # Native Three.js Imperative Render Pipeline (Bypasses React for extreme performance)
│   ├── ChunkPhysics.tsx  # Invisible physics colliders for chunk geometry
│   ├── Enemies.tsx     # Spawner and SwarmManager for entities
│   ├── HostCombat.tsx  # Host-authoritative hitscan & projectile logic
│   ├── Tombstones.tsx  # Death system dropped items
│   └── Tether.tsx      # Grapple Gun physics line
├── hooks/              # Custom React hooks containing decoupled systems
│   ├── usePlayerPhysics.ts # Decoupled fixed physics accumulator loop (30Hz)
│   ├── useWorldLighting.ts # Decoupled lighting updates for DynamicSky.tsx
│   ├── useDebugOverlayUpdate.ts # Decoupled debug stats updates (F3 menu)
│   └── useKeyboard.ts  # Zero-render keyboard input hook (Ref-based)
├── stores/             # Zustand State Management (Modular Slices)
│   ├── useStore.ts     # Main store aggregator
│   ├── useChunkStore.ts   # Chunk generation, meshing, and modification state
│   ├── usePlayerStore.ts  # Inventory, Health, Position, and Game Modes (Survival/Creative)
│   ├── networkActions.ts # Split main network action hooks
│   └── useNetworkStore.ts    # PeerJS WebRTC networking and Host Commands (/tp, /kick)
├── systems/            # Logic tick sub-systems
│   ├── network/        # Decoupled network system slices (Chat, Inventory, PlayerSync, etc.)
│   └── MachineTickSystem.ts # Crafting machine update loops
├── utils/              # Pure Functions, Math, and Web Workers
│   ├── chunkData.ts    # 32-bit ECS bitpacking logic (Memory optimization)
│   ├── chunkGenerator.ts # Procedural generation (Simplex Noise)
│   ├── greedyMesh.ts   # Custom Naive/Greedy meshing with embedded AO/Lighting
│   ├── workerPool.ts   # Web Worker management and queueing
│   ├── db.ts           # Async Proxy to the IndexedDB Web Worker
│   └── NetworkEventBus.ts # Event bus for handling decoupled network payloads
├── workers/            # Off-thread Web Workers (DO NOT BLOCK THE MAIN THREAD)
│   ├── chunkWorker.ts  # Heavy terrain generation and meshing
│   └── dbWorker.ts     # IndexedDB I/O and RLE Array Decompression
├── materials/          # Custom WebGL Shaders and Texture Atlas
│   ├── ChunkMaterial.ts # Custom ShaderMaterial for voxel lighting & AO
│   └── TextureAtlas.ts  # Canvas-based automatic texture atlas compiler
├── scripts/            # Build & CI/CD Scripts
│   └── check_architecture.ts # Custom AST Linter that enforces zero-allocation loops
└── registry/           # Game Data Configurations
    └── blocks.json     # Master block definition file (IDs, attributes, textures)
```

## State & Dependency Architecture

Recent codebase modularization resolved key architectural bottlenecks:
- **The Core God Node (`useStore`)**: Previously, `useStore` was a massive monolithic God Node connected to 18 distinct communities. We have now **successfully decoupled** the store into 15+ isolated Zustand slices (e.g., `useChunkStore`, `usePlayerStore`, `useInventoryStore`). State sync is now handled through lightweight patch operations, eliminating the monolithic bottleneck.
- **Import Cycles**: The notorious `GameAudio.ts -> useStore.ts -> createPlayerSlice.ts` circular dependency has been fully mitigated through our modular slice migration.
- **Disconnected Tech Debt**: Unused isolated nodes were heavily pruned during the massive TypeScript migration.

## Database Schema (IndexedDB)

The application uses the browser's IndexedDB to save worlds persistently, utilizing `idb-keyval` for fast asynchronous key-value storage. To support multiple worlds, keys are prefixed by a `saveSlotId`.

### Storage Keys

- **Save Slots Prefix:** Managed via `sessionStorage.getItem('saveSlotId') || 'default'`
- **Chunks:** Stored as `[saveSlotId]_chunk_[cx],[cz]`
  - **Data Format:** To prevent massive memory usage, chunks are strictly stored as `Uint32Array(81920)` buffers.
  - **Compression:** Run-Length Encoding (RLE) is applied via `compressRLE()` before hitting the database, shrinking identical air/stone blocks drastically. The DB stores the RLE array.
  - **Legacy Migration:** Legacy object-based or packed-array chunk formats are dynamically migrated to the fast ECS `Uint32Array` format upon loading via `migrateLegacyChunk()`.
- **Player State:** (Pending explicit DB serialization in `PlayerSlice`)
- **World State:** The seed is determined dynamically or loaded via `worldSeed.ts`.

### Chunk Data Architecture (ECS Bitpacking)

A chunk is **16x320x16** blocks (81,920 total). Instead of allocating 81,920 JavaScript objects, each chunk is a single contiguous `Uint32Array(81920)`. Every 32-bit integer represents a block, packed as follows:

- **Bits 0-7 (8 bits):** Texture ID (0-255). `0 = Air`.
- **Bits 8-16 (9 bits):** Health (0-511). `511 = Indestructible`.
- **Bits 17-20 (4 bits):** Fluid Level (0-15).
- **Bit 21 (1 bit):** isHidden (Used for occlusion culling).
- **Bits 22-25 (4 bits):** Block Light (0-15).
- **Bits 26-29 (4 bits):** Sunlight (0-15).
- **Bits 30-31 (2 bits):** Unused.

## Web Worker Data Transfer Constraints (Critical Rules)

Our architecture relies heavily on Web Workers (`chunkWorker.ts`) to generate terrain and build geometry arrays off the main thread. When data is passed back and forth, standard JSON stringification is too slow, and `SharedArrayBuffer` is blocked by modern browser CORS constraints.

Therefore, we use the browser's native **Structured Clone Algorithm** combined with **Transferable Objects** (`ArrayBuffer`). This requires strict adherence to the following rules to prevent silent failures and memory crashes:

1. **Network Data Constraints (PeerJS):** WebRTC Data Channels (via PeerJS) will crash the connection if you attempt to send massive strings. You **MUST NOT** use `JSON.stringify` on massive arrays (like chunk diffs, RLE buffers, or ship buffers) before transmitting. Always use `Array.from()` to serialize typed arrays into native JavaScript arrays before network transmission to bypass string memory limits.
2. **Detached Buffers:** When an `ArrayBuffer` is transferred via `postMessage`, it becomes "detached" (neutered) in the originating thread. Its `.byteLength` becomes 0. You **must not** transfer a buffer if it is actively being cached or referenced by other chunk generations (e.g., neighbor boundary checks). In those cases, rely on the fast native structured clone instead of explicit transferring.
2. **Caching Transferred Buffers:** If a WebWorker maintains a cache (like `walCache`), it MUST explicitly `.slice(0)` or clone the `ArrayBuffer` *before* adding it to the `postMessage` transfer list. Otherwise, the cache will instantly become a 0-byte ghost trap, silently destroying any subsequent reads.
3. **Receiving TypedArrays on the Main Thread:** When catching data from a Web Worker (e.g., `meshArrays` in `useChunkStore.ts`), the main thread must safely copy it to avoid React rendering bugs during garbage collection.
3. **The `for...in` Trap (The Flora Bug):** If a payload contains a raw `TypedArray` (e.g., `meshArrays.__flora: Float32Array`), you **MUST NOT** use a `for...in` loop to deep-copy its contents. A `for...in` loop on a `TypedArray` iterates over numerical string indices (`"0"`, `"1"`...). Attempting to call `.slice()` on these raw numbers will throw exceptions.
4. **Never Swallow Exceptions Silently:** If a deep-clone loop uses a `try...catch` block, never leave the `catch` block empty. Silently swallowing errors can transform a 30,000-element `Float32Array` into an empty object `{}`, causing components checking for `.length` to silently fail (since `{}.length` is `undefined`, which breaks conditionals).

Always explicitly check for `.byteLength` or `instanceof Float32Array` before recursively deep-copying geometry payloads!
