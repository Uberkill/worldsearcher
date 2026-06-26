// @ts-nocheck
/**
 * chunkRenderSignal.js
 *
 * Zero-overhead signal channel between worldActions.js and ChunkRenderer.jsx.
 *
 * Problem solved: ChunkRenderer.useFrame was iterating ALL chunks every frame
 * (O(n) at 400+ chunks = ~24,000 ref-checks/second) looking for dirty meshArrays.
 * At steady-state (nothing loading), this is pure wasted work.
 *
 * Solution: worldActions.mountNextMesh() marks exactly which chunk keys have
 * fresh meshArrays. ChunkRenderer drains only those keys instead of scanning all.
 *
 * Architecture notes:
 * - NOT in Zustand state (Sets don't serialize, no reactivity needed for this).
 * - Module-level singleton — shared across imports via ES module cache.
 * - No React state involved — ChunkRenderer reads it imperatively in useFrame.
 * - Thread-safe by JS single-threaded guarantee.
 */
export const pendingRenderKeys = new Set();
