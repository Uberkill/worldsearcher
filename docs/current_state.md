# Current State of the Codebase

## Completed Features

- **High-Performance Voxel Engine:**
  - 32-bit ECS Chunk Data format with minimal memory overhead (`chunkData.js`).
  - True Multi-threaded Procedural Generation and Naive/Greedy Meshing (`chunkWorkerPool.js`, `chunkWorker.js`).
  - Hardware-accelerated InstancedMesh extraction for Flora (Tall Grass, Flowers) bypassing greedy meshing for performance (`ChunkFlora.jsx`).

- **Native Imperative Pipeline & Off-Thread Logic:**
  - `ChunkRenderer.jsx` utilizes an imperative pipeline, natively pushing matrices to `<InstancedMesh>` buffers to completely bypass React's Virtual DOM reconciliation overhead.
  - Zero-copy data transfer pipelines via `dbWorker.js` completely offload heavy RLE compression and database reading from the main thread to eliminate stop-the-world garbage collection pauses.
  - Custom Static Analyzer (`scripts/check_architecture.js`) enforces zero-allocation loops via Git pre-commit hooks to permanently prevent performance regressions.

- **Rendering & Shaders:**
  - Dynamic Custom Texture Atlas generated on the fly via Canvas (`TextureAtlas.js`).
  - Highly advanced Voxel Lighting System packed into vertex attributes (Sunlight, Blocklight, and AO in a single 32-bit integer).
  - Custom WebGL `ShaderMaterial` injected into Three.js's physical pipeline (`ChunkMaterial.js`) to apply Voxel Lighting, Ambient Occlusion, and Debug Heatmaps.

- **Gameplay Mechanics:**
  - Complete physics integration with `@react-three/rapier` natively locked to a **30Hz Fixed Physics Tick** (`timeStep={1/30}`).
  - **Zero-Allocation Physics Loop**: Physics, Swarm Boids, and Grappling hooks strictly hoist variables (`THREE.Vector3`, `rapier.Ray`) to the module scope to eliminate V8 Garbage Collection stutters.
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
  - **Host-Authoritative Combat**: Hitscan AoE sweeps for melee weapons and synced physical `RigidBody` projectiles (`HostCombat.jsx`).
  - **Host Commands**: Full `/time`, `/kick`, `/give`, `/tp` logic evaluated locally by the host and broadcast to guests.

- **Diagnostics & Debugging:**
  - The live `F3` `DebugOverlay.jsx` menu actively tracks Logic TPS (Ticks Per Second) and MSPT (Milliseconds Per Tick) alongside WebGL draw calls.
  - The `SpectorModal.jsx` Engine Dump tool can export raw `.txt` or `.json` telemetry covering draw calls, WebGL stats, and worker queue health.

## Broken / Pending Features

- **Serialization & Persistence:**
  - Currently, chunks are perfectly serialized and heavily compressed via RLE into IndexedDB. However, player position, inventory, and hotbar state serialization logic requires final verification across page reloads.
- **Lighting Propagation Edge Cases:**
  - Voxel light propagation across chunk boundaries relies on tightly synchronized worker thread responses. Edge cases during rapid block placement/breaking on chunk borders can occasionally result in brief asynchronous light flickering.
- **Game UI / Menus:**
  - The UI (TailwindCSS overlays) lacks advanced user settings, server browsers, and intricate crafting grids, remaining largely foundational.

- **Graphify Analysis - Disconnected Nodes:**
  - Graphify's architectural analysis identified **271 isolated nodes** (functions/modules with ≤ 1 connection). This indicates a significant amount of "dark code", unused boilerplate (e.g., standard npm package files), or undocumented modules that should be audited.

## Immediate Next Steps

1. **Verify Player State Persistence:** Ensure inventory, health, and location correctly persist in `idb-keyval` when closing and reopening the game.
2. **Flesh out Crafting / Recipes:** Connect the existing recipe configuration to an interactive DOM crafting grid.
