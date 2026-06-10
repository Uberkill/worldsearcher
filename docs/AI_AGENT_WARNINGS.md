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
