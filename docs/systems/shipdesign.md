# Sky Island & Ship System: Comprehensive Design Document

This document outlines the entire architectural shift and design progression of the game following the "Sky Island" update. It details the shift from infinite flat terrain to floating void islands, the introduction of the Warp Ship concept, the mechanical systems built for it, and the definitive roadmap for our upcoming "Hybrid Flight System" which transforms the ship into a fully drivable voxel vehicle.

---

## 1. The "Sky Island" Architecture Shift

Before this update, the world generation produced infinite rolling terrain starting from Y=0. This was completely overhauled to support a sky-based archipelago aesthetic with a deadly void below.

### Chunk Generation Changes (`chunkGenerator.js` & `structures.js`)
- **Removal of Flat Ground**: The legacy hardcoded ground floor base and bedrock kill planes were completely removed.
- **Pure 3D Noise Islands**: The world is now exclusively generated using 3D Simplex/Perlin noise applied uniformly across all Y-levels, producing pure layered floating islands without any continuous bottom landmass.
- **The Void**: Everything around and below the islands is an empty void. Falling off an island leads to an infinite fall (or a kill plane).
- **Multi-layered Structure Spawning**: The surface tracking was shifted from a single `highestSolidY` array to a multi-surface `getSurfaceHeightMap` that allows trees, flora, and ruins to naturally populate on *every* vertical layer of islands in a chunk.
- **Overhang Root Capping**: Trees and structures that overhang an island edge now cap their downward "root pillars" to 5 blocks, preventing them from violently shooting pillars through the void to reach islands far below.
- **Memory Fog**: A thick atmospheric memory fog was added below the islands to obscure the void and give a sense of bottomless depth.

---

## 2. The Hybrid Flight System (Current Architecture)

To allow players to explore the void, we built a massive architectural paradigm: **The Drivable Voxel Vehicle**. 
The Hybrid system allows players to physically fly the ship locally, while retaining the Warp sequence for distant travel.

> [!WARNING]
> **Ship Physics Anti-Patterns (Historical Failures - Do NOT attempt these):**
> - **Euler Angles:** Do NOT use Euler angles for stabilization. It causes fatal Gimbal Lock when ascending while facing backwards.
> - **Massive Invisible Colliders:** Do NOT attempt to add "Moment of Inertia" by adding massive invisible plates (e.g., 40x40 colliders) to stop the ship from tipping. This fatally chokes the Rapier broad-phase BVH tree and causes massive frame drops. We now use native `enabledRotations` instead.
> - **Garbage Collection Spam:** Do NOT instantiate math objects (`new Vector3()`, `new Quaternion()`) inside the 144Hz `useFrame` physics loop to calculate upright springs. It will spam the GC and cause severe stuttering.
> - **Sluggish Torque:** Do NOT use `applyTorqueImpulse` for steering. It is sluggish and non-deterministic because of mass/drag. Use `setAngvel` for instant, snappy steering.

### Local Flight & Seating Mechanics (Captain vs Passenger)
- **Physics Rewrite**: The ship is now a massive `<RigidBody type="dynamic">` in `ShipPhysics.jsx`. Every block placed on the ship dynamically adds a voxel collider to this master body.
  - **Native Stabilization**: We natively lock Pitch and Roll using `enabledRotations={[false, true, false]}`, completely eliminating Gimbal Lock, "Bronco Bucking", and Garbage Collection spam, while allowing deterministic yaw via `setAngvel` and organic momentum bouncing upon collisions.
- **The Seating System**: To fly the ship, players MUST sit down. We implemented a strict split:
  - **`ship_helm`**: The authoritative driver's seat. Interacting with it broadcasts a `REQUEST_HELM` network intent. The Host validates this and grants the player exclusive driving authority (`shipHelmPlayerId`). Only the Captain can steer the ship using WASD.
  - **`ship_seat`**: The "Passenger Seat". Players can sit here to securely travel with the ship, but they cannot steer.
- **Dynamic Seating Offsets**: Using Amanatides-Woo DDA raycasting, right-clicking any specific seat calculates a local `seatOffset`, physically snapping the player directly into the specific chair they clicked, correctly rotated relative to the ship's current rotation.

### Hardware Tracking & Physics Optimization
- **`O(1)` Hardware Sync**: Originally, counting Warp Engines and Capacitors required looping through all 32,768 ship blocks (`O(N)`) every time a block was placed, causing massive CPU cascading spikes. This was optimized. The `createShipSlice.js` store now incrementally tracks `shipHardwareCounts` at the exact moment a block is placed/broken, granting instant, zero-cost access to engine limits.
- **GC Memory Thrashing Elimination**: The `castRayShip` raycaster fires 60 times a second per player. To eliminate Garbage Collection stutters, all `THREE.js` vector, matrix, and quaternion objects inside physics loops were hoisted to file-scoped global constants, completely eliminating GC allocations during local flight.

### The Warp Drive (Story & Distant Islands)
- **Entering the Void**: When players are ready to cross oceans, they pull the Lunar Anchor. The ship instantly ascends from sea-level (`Y=60`) up to the "Warp Void" (`Y=10000`).
- **The Glitch Minigame**: The Host server calculates random Glitch Storm strikes and broadcasts them to all clients. Players must frantically use the `repair_tool` to patch the hull before the engine runs out of fuel.
- **Safe Arrival (Void Trap Fix)**: Upon a successful warp, the `TransitManager.jsx` places the ship in a holding pattern (Y=800) until the destination chunk explicitly mounts its `buffer` AND `meshArrays`. Only then does it calculate the terrain height, preventing players from being softlocked in the sky or clipping into unloaded bedrock.

### Polish & World Integration
- **Prebuilt Spawn**: The ship spawns naturally docked near the player's starting island.
- **Clickable Radar**: The Astrolabe canvas allows players to click on distant yellow blips to actively set the `shipDestination` before initiating a warp jump.

---
*This document serves as the master blueprint for the physical ship refactor.*

## 5. UI & Interaction Improvements (Phase 2)
As part of the shift towards a fully interactive physical ship, several core usability and rendering issues were addressed:
- **Precise Ship Raycasting**: The Digital Differential Analyzer (DDA) raycaster was updated to use sub-block floating point coordinates when intersecting with the ship's instanced meshes. This prevents the crosshair from snapping to an invisible global integer grid when aiming at a moving ship, allowing precise block interaction.
- **Dynamic Interaction Tooltips**: The central crosshair UI was overhauled to dynamically read the block type currently targeted by the player. Hovering over any interactive block (e.g.,  strolabe, ship_seat, charging_station, spark_node, lunar_anchor, crafting_table, chest) now displays a contextual tooltip such as [Right Click] Helm Seat.
- **Dismount Mechanic**: The helm seat interaction was smoothed out. Instead of requiring the player to look down at the physical seat block to dismount, a standard Shift (sprint) shortcut was added to instantly exit the seat.
- **UI Overlay Fixes**: The HeartCoreOverlay and LunarAnchorOverlay menus were previously unclickable due to the global game UI wrapper having pointer-events: none to allow world interactions. Explicit pointer-events-auto overrides and background click handlers were added to restore menu functionality.
- **Ship Rendering & Collision**: The ship is now fully textured with accurate hex color parsing mapped directly to the InstancedMesh matrix colors. The collision bounding box was also correctly offset [-0.5, -0.5, -0.5] to wrap the physical blocks precisely without invisible overhangs.
