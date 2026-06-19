---
type: "query"
date: "2026-06-18T17:15:20.759419+00:00"
question: "Why does useStore connect Community 9 to Community 0, Community 1, ... Community 62?"
contributor: "graphify"
source_nodes: ["useStore", "Monolithic useStore Decoupling"]
---

# Q: Why does useStore connect Community 9 to Community 0, Community 1, ... Community 62?

## Answer

The useStore node acts as a monolithic God Node in the architecture. Because it holds the entire game state (UI, world data, player status, physics state, network sync), it touches almost every React component and system. Our graph trace shows it directly referenced by rendering components (ChunkRenderer.jsx), UI overlays (InventoryOverlay.jsx), and core singletons (worldActions.js, workerPool.js). This creates massive cross-community coupling, meaning a state change in one domain forces re-evaluations across unrelated domains, which is why it bridges so many communities and is targeted for decoupling in MEMORY.md.

## Source Nodes

- useStore
- Monolithic useStore Decoupling