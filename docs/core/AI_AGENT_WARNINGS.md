# CRITICAL AI AGENT WARNINGS - READ BEFORE MODIFYING CODEBASE

**Dear AI Agent,**

If you are reading this, you are working on the **World Searcher** codebase. 
This game has a very specific architecture designed to maintain 60 FPS while handling massive amounts of voxel terrain data (chunks) and physics calculations. 

**IF YOU BREAK THESE RULES, YOU WILL DESTROY THE SYSTEM'S PERFORMANCE AND CAUSE UNPLAYABLE LAG AND STUTTERING.**

---

## 🛑 STRICT RULE 1: NEVER PUT HIGH-VOLUME GEOMETRY IN THE REACT TREE
You must **never** map massive arrays of high-frequency data into the React (`@react-three/fiber`) Virtual DOM. 

**What DESTROYED the game previously:**
An agent previously placed `<Chunk>` components in a `.map()` array inside `Cubes.jsx` so that React would orchestrate the rendering. 
When chunks were loaded or deleted from the array, the React Reconciler tried to diff hundreds of `InstancedMesh` and `BufferGeometry` nodes on the Main Thread. This caused **30ms+ frame drops** and froze the GPU.

**How it MUST be done:**
- We use a **Native Three.js Pipeline** (`ChunkRenderer.jsx`).
- The `ChunkRenderer` is a single React component that hooks into a `THREE.Group` via a `useFrame` loop.
- It imperatively reads from the Zustand `useChunkStore` and manually calls `group.add(mesh)`, `group.remove(mesh)`, and `geometry.dispose()`.
- **Do not tell React about the meshes.** 

## 🛑 STRICT RULE 2: OFF-THREAD ALL TERRAIN & RLE MATH
You must **never** perform heavy ArrayBuffer operations, database fetches, or Run-Length Encoding (RLE) decompression on the Main Thread.

**What DESTROYED the game previously:**
An agent previously wrote functions to decompress 50kb+ WebRTC network chunks directly in `networkActions.js` or `db.js`. JavaScript is single-threaded; iterating over massive binary chunks paused the entire browser, causing severe lockups whenever a player joined multiplayer or loaded terrain.

**How it MUST be done:**
- All heavy math and I/O is offloaded to Web Workers (`src/workers/dbWorker.js`).
- `src/utils/db.js` is merely a proxy that sends a `postMessage` to the Web Worker and returns a Promise. 
- You must wait for the Web Worker to reply. **Do not block the main thread.**

## 🛑 STRICT RULE 3: ZERO-COPY TRANSFERS ONLY
When passing raw geometry arrays (`Uint32Array`, `Float32Array`) between the Web Worker and the Main Thread, you **must** use Transferable Objects.

**What DESTROYED the game previously:**
Agents returned references or deeply nested arrays from Workers, causing the browser to synchronously clone 50MB of memory, triggering huge Garbage Collection (GC) spikes. Furthermore, they sometimes triggered `DETACHED_BUFFER` errors by passing the underlying `.buffer` of a TypedArray without correctly cloning it first if it needed to be preserved.

**How it MUST be done:**
- In `dbWorker.js`, explicitly define the arrays to be transferred in the second argument of `postMessage`: `self.postMessage(response, [array1.buffer, array2.buffer])`.
- If an array needs to be kept in the Worker *and* sent to the Main thread, you must explicitly copy it (`new Uint32Array(oldArray)`) and transfer the copy's buffer. 

## 🛑 STRICT RULE 4: REACT IS FOR HITBOXES, NATIVE IS FOR VISUALS
While visual geometry is handled natively (Rule 1), we **do** keep physics in React.

- `ChunkPhysics.jsx` mounts invisible TrimeshColliders into the `@react-three/rapier` engine.
- This is fine because Rapier handles its own C++ WebAssembly optimizations, and React is merely orchestrating the invisible physics wrappers. 
- Keep visual rendering decoupled from physics. 

---

**Summary:** 
- The Main Thread handles inputs and drawing the frame. 
- The React DOM handles UI and Physics Colliders.
- `ChunkRenderer.jsx` natively handles all terrain drawing.
- Web Workers handle all chunk data decompression and database fetching.

*If you understand these rules, you may proceed to build amazing features!*

## 🛑 STRICT RULE 5: THE CANARY TRACKER (CRITICAL)
Whenever you modify core engine logic, ECS states, or architectural patterns, you MUST manually increment the `version` inside `docs/canary_tracker.json`.
The CI/CD pipeline contains a test (`tests/ai-canary.test.js`) that will actively fail your changes if you break core deterministic keys or forget to update the tracker file. This serves as an AI Context Rot canary.

## 🛑 STRICT RULE 6: SHIP SYSTEMS & RAYCASTER MATH
The hybrid flight system's raycaster (`castRayShip`) and physics engine (`ShipPhysics.jsx`) are mathematically fused. **Never modify these without reading this warning:**

1. **Memory Array Strides:** 
   The ship uses a 1D `Uint32Array` mapped to 3D space. The mathematical stride MUST always be: `Y * 1024 + Z * 32 + X`. Do not accidentally swap `Y` and `Z` multipliers in the raycaster, or the raycaster will pass completely through the ship and read empty memory indices.
2. **Gimbal Lock in Raycasting:** 
   Never convert the ship's physical `Quaternion` into an `Euler` (Pitch/Yaw/Roll) for raycasting if the ship is capable of pitching or rolling. This introduces Gimbal Lock and causes the raycaster's rotational matrix to completely desynchronize from the visual mesh. The raycaster must read `.actualQuaternion` directly from the Rapier `RigidBody`.
3. **Stationary Vector Collapse (Lerping):**
   In `ShipPhysics.jsx`, the visual interpolation vector (`_pos`) pauses its lerp updates when the physics engine detects the ship has stopped moving (`distSq < 0.0001`). If you fail to clone the `RigidBody`'s resting `currentPos` into `_pos` during this sleep state, the `actualPosition` memory will collapse to its uninitialized default `[0, 0, 0]`. This will instantly blind the raycaster and hide all interactive blocks as soon as the ship parks.
