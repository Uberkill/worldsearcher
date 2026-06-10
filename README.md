# World Search - Custom Voxel Engine

A high-performance, deterministic custom voxel engine built natively for the browser. This project leverages WebGL, WebWorkers, and WebRTC to deliver a seamless, procedurally generated multiplayer experience.

## Technology Stack

Our custom architecture combines several open-source libraries into a bespoke pipeline:
- **Rendering:** React Three Fiber (Three.js wrapper)
- **Physics Engine:** `@react-three/rapier` (Rust-based WASM Physics)
- **Procedural Generation:** Custom WebWorker pool with Simplex Noise
- **State Management:** Zustand (modular, atomic state slicing)
- **Multiplayer Networking:** PeerJS (WebRTC Data Channels for serverless P2P syncing)
- **Offline Persistence:** IndexedDB via `idb-keyval` (Binary RLE Chunk Storage)

## Core Engine Features

### 1. Hybrid Server Tick Architecture (20Hz)
To guarantee determinism and prevent network desyncs between players on high vs low refresh rate monitors, all core game logic runs on a dedicated **20Hz Fixed Tick (Accumulator)**. 
- Pathfinding, Host-Authoritative Hitscans, and Player Physics are decoupled from the display refresh rate.
- **Death Spiral Limiter:** Missed ticks (e.g., when tabbing out of the browser) are dropped after a hard cap to prevent physics stalls or CPU lock-ups upon returning.

### 2. Snapshot Visual Interpolation
Even though the core engine simulates logic at 20 Ticks Per Second, visual rendering via `useFrame` runs at up to 144Hz. Network guest entities use **Snapshot Buffering** to seamlessly interpolate between ticks in the past, ensuring buttery-smooth visual framerates despite the slower underlying simulation.

### 3. Voxel Pipeline (Greedy Meshing)
Chunks are generated off the main thread in a WebWorker pool.
- Utilizes an ECS 32-bit integer packing format for ultra-low memory overhead.
- Geometry is extracted via Greedy Meshing, baking ambient occlusion and custom voxel block lighting directly into vertex attributes.

### 4. P2P Host-Authoritative Networking
Multiplayer is completely serverless. The browser acts as the Host server via WebRTC data channels, propagating chunk differences, managing enemy AI swarms, and validating combat raycasts against all connected guests.

## Getting Started

1. Install dependencies: `npm install`
2. Start the development server: `npm run dev`
3. Hit `F3` or `F12` in-game to view the live Engine Dump metrics (TPS, MSPT, Draw Calls).
