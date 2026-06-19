# World Search - Custom Voxel Engine

A high-performance, deterministic custom voxel engine built natively for the browser using WebGL, WebWorkers, and WebRTC.

## The Sky Island & Ship Expansion
World Search now features procedural floating islands set over a bottomless void. Players can construct, pilot, and maintain their own customizable physical voxel ships using the new Hybrid Flight System. Engage the Warp Drive to traverse the void to new dimensional coordinates while fending off Glitch Storms alongside your crew!

> [!WARNING]  
> **AI AGENTS:** Do not blindly load monolithic documentation files. You MUST read `docs/context_map.json` to determine which specific sub-document to load for your current task. 
> 
> You MUST also read `docs/core/AI_AGENT_WARNINGS.md` before making any code modifications. Failure to adhere to the Canary tracking rules will result in your changes being rejected by the test suite.

## Getting Started

1. Install dependencies: `npm install`
2. Start the development server: `npm run dev`
3. Run the engine test suite: `npm run test:unit`
4. Hit `F3` or `F12` in-game to view the live Engine Dump metrics (TPS, MSPT, Draw Calls).

## Recent Engine Updates (V3 - V5)
* **Decoupled Entity Persistence**: Global objects like Chests, Machines, Tombstones, and Dropped Items have been successfully decoupled from the chunking system. They now save properly to the `_world_entities` IndexedDB tables and synchronize reliably across the network.
* **Persistent Ship Containers**: Ships now robustly support interactive containers. You can place chests and furnaces on ships, load them with fuel and items, fly the ship, and they will persist accurately.
* **Item Drop Vector Math**: Breaking a ship container automatically triggers a global matrix transformation, projecting the local `x, y, z` ship coordinates into global world space to spawn physics-based item drops safely on the deck of your ship!
* **Engine Stability & Zero-Allocation GC (V6)**: The chunk loading pipeline has been upgraded with a Manhattan Distance Priority Queue, guaranteeing chunks directly beneath the player load first. Memory allocations are now perfectly flat thanks to an ArrayBuffer Recycling system that bypasses the native Garbage Collector to eliminate V8 "Stop-the-World" stuttering.
* **Safe Spawn Raycast Guard**: The loading sequence is now physically bound to the Rapier physics engine, dynamically projecting a raycast to ensure solid terrain generation before dropping the player into the world, effectively eliminating "void clipping" bugs.
