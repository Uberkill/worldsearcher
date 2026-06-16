# Current State of the Codebase

## Completed Features

- **High-Performance Voxel Engine:**
  - 32-bit ECS Chunk Data format with minimal memory overhead (`chunkData.js`).
  - True Multi-threaded Procedural Generation and Naive/Greedy Meshing (`chunkWorkerPool.js`, `chunkWorker.js`).
  - Hardware-accelerated InstancedMesh extraction for Flora (Tall Grass, Flowers) bypassing greedy meshing for performance (`ChunkFlora.jsx`).

- **Native Imperative Pipeline & Off-Thread Logic:**
  - `ChunkRenderer.jsx` utilizes an imperative pipeline, natively pushing matrices to `<InstancedMesh>` buffers to completely bypass React's Virtual DOM reconciliation overhead.
  - Zero-copy data transfer pipelines via `dbWorker.js` completely offload heavy RLE compression and database reading from the main thread to eliminate stop-the-world garbage collection pauses.
  - **IndexedDB WAL Latency Optimization**: Removed duplicate concurrent database saves in `unloadChunk`, reducing write latency from **72ms to 5.9ms**.
  - **Thread-Local Static RLE Buffer**: Compresses chunks inside the Web Worker using a pre-allocated static Uint32Array, completely avoiding garbage collection overhead.
  - **Zero-Copy walCache Cloning**: Prevents ArrayBuffers from being silently detached and corrupted when traversing the `postMessage` boundary back to the main thread.
  - **Fast Native Decompression**: Uses native C++ `TypedArray.prototype.fill()` for RLE decoding instead of JavaScript loops.
  - **Rebuild Job Cancellation & Grace-Period Caching**: Pending meshing jobs are immediately cancelled when chunks are unloaded, and Pass 1 cache is safely retained during the 15-second grace period. This guarantees instant recovery when a player turns back and prevents "dead chunk" void holes.
  - **InstancedMesh VRAM GC/Dispose Pipeline**: Native garbage collection via explicit `.dispose()` queues prevent WebGL buffer leaks during chunk unloading.
  - Custom Static Analyzer (`scripts/check_architecture.js`) enforces zero-allocation loops via Git pre-commit hooks to permanently prevent performance regressions.

- **Rendering & Shaders:**
  - Dynamic Custom Texture Atlas generated on the fly via Canvas (`TextureAtlas.js`).
  - Highly advanced Voxel Lighting System packed into vertex attributes (Sunlight, Blocklight, and AO in a single 32-bit integer).
  - Custom WebGL `ShaderMaterial` injected into Three.js's physical pipeline (`ChunkMaterial.js`) to apply Voxel Lighting, Ambient Occlusion, and Debug Heatmaps.
  - **Zero-Render Weather Occlusion**: Uses a cyclical 512x512 Float32 `DataTexture` synchronized with WebWorker terrain heightmaps for O(1) shader-based roof collision.
  - **Angle-Based Dynamic Shadows**: Shadow map rendering is bound to explicit angular offsets (>0.5 deg) and player distance rather than arbitrary clock ticks, guaranteeing flat 1ms frame pacing.

- **Gameplay Mechanics:**
  - Complete physics integration with `@react-three/rapier` natively locked to a **30Hz Fixed Physics Tick** (`timeStep={1/30}`).
  - **Zero-Allocation Physics Loop**: Physics, Swarm Boids, Raycasting (`castRayShip`), and Grappling hooks strictly hoist variables (`THREE.Vector3`, `rapier.Ray`, `THREE.Euler`) to the module scope to eliminate V8 Garbage Collection stutters, even during 60fps local ship flight.
  - **Captain vs Passenger Seating**: Physical voxel ships support true multiplayer physics. The `ship_helm` block grants exclusive WASD driving authority via the Host (`shipHelmPlayerId`), while `ship_seat` blocks allow passengers to securely ride without glitching through the floor. Seating calculates precise Amanatides-Woo offsets per click.
  - **NaN Physics Contagion Protection**: Rigidbodies sanitize their own velocity buffers, and save slots automatically rescue players spawned in void/NaN bounds.
  - **Absolute Kill Planes**: Entities falling below `Y = -100` are instantly destroyed to prevent terminal velocity memory leaks.
  - Full player interactions: Block placing/breaking with distance raycasting (`BlockInteraction.jsx`).
  - Gravity-based falling physics for detached structures (`checkStructuralIntegrity`, `FallingStructure.jsx`).
  - Flowing Liquid System (Water, Lava) with cellular automata-based updates (`fluidSystem.js`).
  - Unified **Game Modes** (Survival, Creative, Hardcore) controlling damage, inventory limits, and death/respawning (`createPlayerSlice.js`).
  - **Grapple Gun** physics tethering and visual raycasting (`Tether.jsx`).
  - **Death System** featuring dropped item tombstones and a respawn overlay (`DeathScreen.jsx`, `Tombstones.jsx`).

- **Entity & Ecosystem:**
  - Centralized Swarm Management controlling max active entity counts and pathfinding (`SwarmManager.jsx`).
  - Adaptive Terrain Scanning to spawn mobs accurately over procedural hills and deep valleys.

- **Multiplayer / Networking:**
  - **Server Tick Architecture**: Network logic natively ticks exactly in sync with the physics engine at 30Hz.
  - **Snapshot Visual Buffering**: Guest visual limbs and swarms are seamlessly interpolated in `useFrame` at 144Hz while physically updating at 30Hz.
  - PeerJS-based ultra-low latency WebRTC host/guest networking (`useNetworkStore.js`).
  - Bitmask-based Network Anti-Cheat (validates `PLAYER_MOVE` packets) preventing speed hacking while safely allowing un-clamped vertical falls, flying (creative mode), and grappling hooks.
  - **Host-Authoritative Combat & Steering**: Combat is handled via Hitscan AoE sweeps and synced physical `RigidBody` projectiles (`HostCombat.jsx`). Ship driving (`shipTransform`) is purely computed by the Host and broadcast at 30Hz to prevent positional rubberbanding.
  - **Host Commands**: Full `/time`, `/kick`, `/give`, `/tp` logic evaluated locally by the host and broadcast to guests.
  - **TransitManager Minigame / Warp Desync Fix**: Fully synchronized Host-Guest warp sequence with safe teleportation handling. Safe-Descent logic forces the ship to hover at `Y=800` during the descent phase until destination chunks broadcast that both their `buffer` and `meshArrays` are actively loaded, completely preventing the "Void Trap" softlock and bedrock clipping (`TransitManager.jsx`, `networkActions.js`).

- **Serialization & UI Features:**
  - **Player State Persistence**: Fully functional inventory, hotbar, health, and location persistence via `idb-keyval` for both Hosts and active Guests.
  - **Decoupled Entity Persistence**: Global objects like Chests, Machines, Tombstones, and Dropped Items are strictly decoupled from Chunks to prevent desynchronization, and safely persist to `IndexedDB` atomically.
  - **Crafting & Recipes**: Fully interactive `CraftingOverlay.jsx` grid successfully linked with backend recipe validation.
  - **Persistent Interactive Ships**: Physical voxel ships robustly support complex machines (Chests, Furnaces). Breaking ship containers correctly translates block coordinates to global physics locations via Matrix transformations for accurate item drops.

- **Diagnostics & Debugging:**
  - The live `F3` `DebugOverlay.jsx` menu actively tracks Logic TPS (Ticks Per Second) and MSPT (Milliseconds Per Tick) alongside WebGL draw calls.
  - The `SpectorModal.jsx` Engine Dump tool can export raw `.txt` or `.json` telemetry covering draw calls, WebGL stats, and worker queue health.

## Broken / Pending Features

- **Lighting Propagation Edge Cases:**
  - Voxel light propagation across chunk boundaries relies on tightly synchronized worker thread responses. Edge cases during rapid block placement/breaking on chunk borders can occasionally result in brief asynchronous light flickering.

- **"Dark Code" & Dependency Bloat:**
  - Static analysis (`knip`) identifies 5 completely unused files, 7 unused bloated dependencies (`puppeteer`, `@babel/*`, `html2canvas`), and over 34 unused module exports scattered throughout the `src/` directory.

## Immediate Next Steps

1. Purge all "Dark Code" and unused dependencies to massively shrink the bundle size and prevent AI agent hallucination.
2. Refactor Web Worker multithreading queues to prevent async cross-chunk lighting flickers during rapid block placements.
