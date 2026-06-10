# Design System & Coding Standards

## 1. Core Principles

- **Performance First:** This application runs thousands of block updates and rendering cycles per second. Heavy computational tasks MUST be offloaded to Web Workers or tightly constrained via bit-packing algorithms.
- **Zero Object Allocation Loop:** Within the inner rendering and chunk generation loops, never instantiate new objects or arrays. Reuse existing typed arrays (`Float32Array`, `Uint32Array`).
- **Data Locality:** Voxel terrain relies on ECS structure. Data is packed sequentially in memory to prevent L1/L2 cache misses during meshing.

## 2. Library Standards

- **Three.js / React Three Fiber:** Use declarative R3F where possible for UI-like scene structures (Players, Sky), but rely heavily on imperative `THREE.BufferGeometry` and typed arrays for chunk rendering to skip React reconciliation overhead on raw vertices.
- **State Management (Zustand):**
  - Group state by logical domain (World, Entities, Player, Network) into independent slices.
  - DO NOT store deeply nested objects that update frequently in Zustand unless using specific granular selectors. Large typed arrays (like chunk buffers) must only trigger store updates when fully populated to prevent cascading React renders.
- **CSS / UI:**
  - TailwindCSS v4 for all DOM elements.
  - Framer Motion for crossfades, modal popups, and hotbar selection animations.
  - Avoid inline styles. Rely entirely on utility classes.

## 3. The 32-Bit ECS Standard

All voxel data MUST strictly adhere to the 32-bit integer schema. Do NOT create individual JS objects for blocks.

```javascript
// ECS Data Standard
export const setBlock = (
  buffer,
  index,
  textureId,
  health,
  isHidden,
  level = 0,
  blockLight = 0,
  sunLight = 0
) => {
  const h = health === Infinity ? 511 : Math.min(Math.max(health, 0), 510);
  buffer[index] =
    (textureId & 0xff) |
    ((h & 0x1ff) << 8) |
    ((level & 0xf) << 17) |
    ((isHidden ? 1 : 0) << 21) |
    ((blockLight & 0xf) << 22) |
    ((sunLight & 0xf) << 26);
};
```

## 4. Materials and Shaders

- **Material Sharing Anti-Pattern:** Do NOT share a `ShaderMaterial` instance between a standard `Mesh` and an `InstancedMesh`. Three.js relies on compilation macros (e.g. `#define INSTANCED`). Sharing the material will cause the instancing macro to be dropped, resulting in severe rendering bugs. Always use `.clone()` or regenerate the material via factory functions when spanning different mesh types.
- **Custom Lighting Compilation:** Do NOT inject standard Three.js directional lights directly on terrain. We override `#include <lights_fragment_begin>` in `ChunkMaterial.js` to inject our own custom voxel ambient occlusion, sunlight, and blocklight, keeping performance high without relying on expensive cascaded shadow maps.

## 5. Multiplayer Architecture

- **Host Authority:** The Host (World Creator) is the absolute authority. All physical block breaking, entity AI routing, and generation happens natively on the Host and is serialized over WebRTC Data Channels.
- **Anti-Cheat Validation:** Guests send inputs (movement intent, block destruction requests). The Host validates these actions (e.g. checking velocity thresholds and physics raycasts) before modifying the global state and broadcasting the delta to peers.
