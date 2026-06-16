# Debug Diagnostics System (F3)

The engine features an advanced diagnostic overlay (accessible via the `F3` key) designed to monitor real-time performance, memory consumption, and engine telemetry without relying on external browser profilers. The diagnostic menu is split into localized sections.

## 1. Performance Tracking
The performance tab monitors the core hardware and framework load:
* **RAM Usage [Chrome]**: Utilizes the V8 `performance.memory` API to track the Live Javascript Heap size in megabytes.
  * *Fallback*: If the client is using Firefox or Safari (where the API is blocked for security), the stat gracefully falls back to `N/A`.
  * *Thresholds*: If the RAM usage exceeds 80% of the allocated browser limit, the text color changes to red.
* **TPS (Ticks Per Second)**: The logical simulation rate of the engine (target: 60).
* **MSPT (Milliseconds Per Tick)**: The CPU time required to calculate a single logic frame.
* **FPS (Visual)**: The visual render framerate from Three.js.

## 2. Scene Telemetry
The scene tab monitors the "invisible load" placed on the engine by systems that run in the background or off-thread.
* **Active Physics**: Tracks the exact number of 5x5 chunk grids currently mounted into the Rapier physics engine.
* **Active Fluids**: Tracks the length of the cellular automata fluid queue.
  * *Thresholds*: Exceeding 500 active fluid blocks triggers a yellow warning. Exceeding 2000 active fluid blocks triggers a red warning (imminent CPU lag spike).
* **Pending Unloads**: Tracks the number of out-of-bounds chunks currently sitting in the Engine GC's 15-second grace period queue.

## 3. Network & Pipeline Tracking
* **Net Requests**: Tracks live WebRTC data requests.
* **Mesh Mount Queue**: Tracks Web Worker payloads that have returned to the main thread and are waiting to be converted into native Three.js `BufferGeometries`. The queue mounts 1 chunk per frame to prevent loading stutters.
* **Processing Deltas**: Tracks incoming block modifications that need to be asynchronously written to the local IndexedDB Write-Ahead Log.
