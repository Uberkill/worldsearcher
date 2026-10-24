# Debug Diagnostics & Telemetry System (F3)

The engine features an advanced diagnostic and telemetry overlay (accessible via the `F3` key) designed to monitor real-time rendering metrics, memory consumption, WebGL state, and peer-to-peer network traffic without relying on external browser profilers.

---

## 1. Global Telemetry Architecture (`window.__DEBUG_STATS__`)

Telemetry is collected in a centralized singleton object attached to `window.__DEBUG_STATS__`. To prevent race conditions during early module imports, the singleton is defensively initialized using nullish coalescing in `src/utils/WebGLTracker.ts`, `src/globals.ts`, and `src/components/DebugOverlay.tsx`.

```typescript
export interface DebugStats {
  // Visual & CPU Load
  fps: number;
  cpuTime: number;
  gpuTime: number;
  
  // Low-level WebGL Metrics
  drawCalls: number;
  triangles: number;
  vertices: number;
  textureBinds: number;
  vboMemoryBytes: number;
  
  // World & Entity Counts
  totalChunks: number;
  chunksRendered: number;
  totalEntities: number;
  entitiesRendered: number;
  
  // Peer-to-Peer Network Telemetry
  bytesSent: number;
  bytesReceived: number;
  ping: number;
  packetStats: {
    sent: Record<string, number>;
    recv: Record<string, number>;
  };
  
  // Diagnostic Errors
  errorLog: Array<{ message: string; timestamp: number }>;
}
```

---

## 2. Diagnostic Panels

### 1. Performance Tracking
- **RAM Usage [Chrome]:** Tracks the live V8 Javascript Heap size via `performance.memory`. Falls back to `N/A` on Firefox/Safari. Exceeding 80% triggers a warning highlight.
- **TPS (Ticks Per Second):** The logical simulation rate of the engine (target: 30Hz server tick / 60Hz local).
- **MSPT (Milliseconds Per Tick):** CPU time required to calculate a single logic frame.
- **FPS (Visual):** Visual render framerate from Three.js.

### 2. Low-Level WebGL Profiler (`WebGLTracker.ts`)
Hooks directly into `WebGLRenderingContext` and `WebGL2RenderingContext` prototypes:
- **Draw Calls:** Incremented on `drawArrays` and `drawElements` (including instanced variants).
- **Triangles & Vertices:** Calculated per draw call based on draw modes (`TRIANGLES`, `TRIANGLE_STRIP`, `TRIANGLE_FAN`).
- **Texture Binds:** Incremented on `bindTexture`.
- **VBO Memory:** Tracks allocated GPU buffer byte sizes via `bufferData` and `deleteBuffer`.

### 3. Scene & Pipeline Telemetry
- **Active Physics:** Exact count of chunk grids currently mounted into the Rapier WebAssembly physics engine.
- **Active Fluids:** Length of the cellular automata fluid queue. Exceeding 500 triggers a warning; exceeding 2000 warns of potential CPU lag.
- **Pending Unloads:** Number of out-of-bounds chunks sitting in the 15-second grace period queue.
- **Mesh Mount Queue:** Web Worker payloads waiting to be converted into native Three.js `BufferGeometries` (capped at 1 per frame to prevent stutter).

### 4. Network Telemetry Subsystem
Monitors live WebRTC peer-to-peer data flow:
- **Bandwidth Counters (`bytesSent` / `bytesReceived`):** Accurately counts byte lengths from ArrayBuffers, Blobs, RLE strings, and JSON payloads across both reliable and unreliable channels.
- **Ping (RTT):** Millisecond latency calculated from `PING` and `PONG` packet roundtrips.
- **Packet Dictionaries (`packetStats`):** Real-time volume maps for both outbound and inbound traffic categorizing:
  - Binary Type 1 (`PLAYER_MOVE`)
  - Binary Type 2 (`BLOCK_DELTA`)
  - Binary Type 3 (`ENTITY_STATE`)
  - Control packets (`WELCOME`, `REQUEST_CHUNK`, `CHUNK_PRISTINE`, `WORLD_SYNC_RLE`)
  - Vehicle packets (`REQUEST_HELM`, `HELM_UPDATE`, `SHIP_STEER_INTENT`, `SHIP_TRANSFORM`)
  - Chat and system events (`CHAT_MESSAGE`, `PING`, `PONG`)
