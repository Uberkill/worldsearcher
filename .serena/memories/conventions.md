# Codebase Conventions & Rules
- NEVER put high-volume geometry in the React Tree. Use Native Three.js pipeline (`ChunkRenderer.jsx`). React is ONLY for hitboxes.
- OFF-THREAD ALL TERRAIN & RLE MATH to Web Workers. Never block the main thread.
- ZERO-COPY TRANSFERS ONLY. Use Transferable Objects (`postMessage(..., [array.buffer])`) for passing geometry arrays to/from workers.
- Canary Tracker: Increment version in `docs/canary_tracker.json` when modifying core logic, ECS, or architecture.
- Ship Raycaster Math: Stride is `Y * 1024 + Z * 32 + X`. Do not use Euler conversions for Raycasting to avoid Gimbal Lock; read actualQuaternion.
- Always use `useRef` carefully. Do not modify or access `.current` directly during the render phase.