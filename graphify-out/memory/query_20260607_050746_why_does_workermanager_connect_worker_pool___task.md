---
type: "query"
date: "2026-06-07T05:07:46.503466+00:00"
question: "Why does WorkerManager connect Worker Pool & Task Threading to Block & Texture Registry?"
contributor: "graphify"
source_nodes: ["WorkerManager", "BlockRegistry.js", "worldActions.js", "blocks.json", "workerPool.js"]
---

# Q: Why does WorkerManager connect Worker Pool & Task Threading to Block & Texture Registry?

## Answer

WorkerManager coordinates task dispatching to chunkWorker.js Web Workers for off-thread terrain generation, lighting calculations, and greedy meshing. To perform these computations, the worker tasks rely on voxel block characteristics (like transparency, solidity, flora types, and light emission). These properties are defined in blocks.json and exposed via BlockRegistry.js. The connection is bridged by worldActions.js (Zustand state store), which imports BlockRegistry to evaluate block changes on the main thread and imports workerPool.js to trigger async worker rebuilds when chunks load or blocks are updated.

## Source Nodes

- WorkerManager
- BlockRegistry.js
- worldActions.js
- blocks.json
- workerPool.js