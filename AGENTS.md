# Developer & AI Agent Instructions (AGENTS.md)

This document contains the critical coding rules, styling guidelines, and framework constraints for working on the Minecraft Clone project. All AI agents and developers must strictly adhere to these standards.

## 1. Frameworks & Versions

- **React & DOM:** React 19 + ReactDOM 19 + Vite 8
- **3D Engine:** Three.js (^0.184.0), React Three Fiber (^9.6.1), React Three Drei (^10.7.7)
- **Physics:** React Three Rapier (^2.2.0)
- **State Management:** Zustand (^5.0.13)
- **Networking:** PeerJS (^1.5.5) for WebRTC P2P multiplayer
- **Styling:** TailwindCSS v4 + Framer Motion
- **Database:** IndexedDB via `idb-keyval` (^6.2.4)

## 2. Critical Coding Rules

### High-Performance Voxel Constraints

- **Zero Object Allocation Loop:** Never instantiate new Javascript objects or arrays inside the inner rendering loops or chunk generation loops. Always reuse existing typed arrays (`Float32Array`, `Uint32Array`).
- **32-Bit ECS Standard:** Do NOT create individual JS objects for blocks. All block data within a chunk is bit-packed into a single contiguous `Uint32Array(81920)`.
  - _Bit Layout:_ Texture ID (8-bit), Health (9-bit), Fluid Level (4-bit), isHidden (1-bit), Block Light (4-bit), Sunlight (4-bit). Use the existing bitwise helper functions in `chunkData.js`.
- **Heavy Computation:** All procedural generation (Simplex noise) and Greedy/Naive meshing MUST be offloaded to Web Workers (`chunkWorker.js`) to prevent blocking the main UI thread.

### Three.js Material Handling

- **Material Sharing Anti-Pattern:** NEVER share a `ShaderMaterial` instance between a standard `Mesh` and an `InstancedMesh`. Three.js relies on compilation macros (e.g., `#define INSTANCED`) which will be dropped if the material is shared, breaking all instanced rendering. Use `.clone()` or regenerate materials via factory functions (`createChunkMaterial`) when mixing mesh types.
- **Custom Shaders:** Do not use default lighting for terrain. We override `#include <lights_fragment_begin>` to inject custom packed Voxel Lighting and Ambient Occlusion (AO).

### State Management (Zustand)

- **Slice Architecture:** Keep state modular (World, Entities, Player, Network).
- **Avoid React Thrashing:** Do NOT store deeply nested objects that update 60fps in Zustand unless using highly granular selectors. Huge typed arrays (chunk buffers) must only trigger store updates when fully rebuilt.

## 3. Multiplayer Authority

- **Host Supreme Authority:** The Host (World Creator) executes all physical block breaking, entity AI, and terrain generation.
- **Guest Inputs:** Guests only send movement intents and interaction requests over WebRTC data channels. The Host validates these via Anti-Cheat protocols (e.g., checking velocity clamps) before executing them globally and broadcasting the delta state.

## 4. Styling Guidelines

- **TailwindCSS Only:** Use Tailwind utility classes for all 2D DOM elements (HUD, Menus, Inventory). Avoid inline styles and standard `.css` files unless defining core variables or `@tailwind` directives.
- **Animations:** Use `framer-motion` for complex UI transitions (modals, inventory interactions). Keep them performant and minimal to not distract from the 3D canvas.

## 5. System Diagnostics

- **Engine Dump Generation:** The game includes a diagnostic dump system (`SpectorModal.jsx`). If you need to debug rendering loops, worker queues, or WebGL memory leaks, you can access the engine dump state to analyze frame captures and performance metrics.
