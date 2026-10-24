# Multiplayer & Peer-to-Peer Networking Specification

This document details the multiplayer architecture, WebRTC transport protocols, binary packet schemas, chunk synchronization lifecycles, and telemetry tracking for World Searcher.

---

## 1. Network Topology & Peer-to-Peer Architecture

World Searcher employs a **Host-Authoritative Peer-to-Peer Mesh** using WebRTC Data Channels managed via PeerJS.

```
       +---------------------------------------------+
       |                 HOST CLIENT                 |
       |  - Authoritative simulation tick (30Hz)     |
       |  - World seed & Chunk storage               |
       |  - Entity arbitration & loot spawning       |
       |  - Peer-to-peer relay engine                |
       +----------------------+----------------------+
                              |
              +---------------+---------------+
              |                               |
       WebRTC Data Channels            WebRTC Data Channels
       (Reliable + Unreliable)         (Reliable + Unreliable)
              |                               |
              v                               v
    +-------------------+           +-------------------+
    |    GUEST PEER 1   |           |    GUEST PEER 2   |
    | - Client-side DDA |<--------->| - Client-side DDA |
    | - Prediction buffer           | - Prediction buffer
    +-------------------+           +-------------------+
             ^                                ^
             +--- Relayed via Host -----------+
```

### Roles and Authority
- **Host Client:** Owns world generation, terrain modifications, physics time steps, entity spawning, inventory persistence, and ship dynamics. The host room identifier follows the format `ws-game-[ROOM_CODE]`.
- **Guest Peers:** Connect via room code. Guests execute client-side predictive movement, render interpolated avatars from a snapshot buffer, and submit delta intents (`BLOCK_DELTA`, `REQUEST_HELM`, `SHIP_STEER_INTENT`) to the Host.
- **Peer Relay Engine:** Because clients connect in a star topology anchored at the Host, the Host actively forwards `PLAYER_MOVE` and `BLOCK_DELTA` packets to all other connected peers, excluding the sender, preventing guest blindness.

---

## 2. Dual-Channel WebRTC Transport Model

Every peer connection opens two independent WebRTC DataChannels:

| Channel Label | Reliability | Ordered | Primary Protocol / Packet Types | Justification |
| :--- | :--- | :--- | :--- | :--- |
| `movement` | Unreliable (`maxRetransmits: 0`) | False | Type 1 (`PLAYER_MOVE`) | Real-time 30Hz position/rotation streaming where stale updates must be dropped rather than head-of-line blocking. |
| `default` | Reliable (SCTP retransmitted) | True | `WELCOME`, `CHUNK_PRISTINE`, `WORLD_SYNC_RLE`, Type 2 (`BLOCK_DELTA`), `HELM_UPDATE`, Chat, Commands | Lossless state synchronization where missing packets corrupt terrain or game state. |

---

## 3. Binary Packet Protocol & Byte Layouts

Binary packets bypass JSON serialization overhead, transmitting raw memory buffers over the DataChannel.

### Packet Type 1: `PLAYER_MOVE` (63 Bytes)
Transmitted at 30Hz across the `movement` channel.

| Byte Offset | Field | Type | Description |
| :--- | :--- | :--- | :--- |
| `0` | `type` | `Uint8` | Fixed value: `1` |
| `1 - 36` | `playerId` | `Uint8[36]` | ASCII-encoded UUID/player identifier |
| `37 - 40` | `x` | `Float32` (LE) | Global X coordinate |
| `41 - 44` | `y` | `Float32` (LE) | Global Y coordinate |
| `45 - 48` | `z` | `Float32` (LE) | Global Z coordinate |
| `49 - 52` | `pitch` | `Float32` (LE) | Camera pitch in radians |
| `53 - 56` | `yaw` | `Float32` (LE) | Camera yaw in radians |
| `57 - 60` | `animState` | `Uint32` (LE) | Bitpacked animation / action state |
| `61 - 62` | `sequence` | `Uint16` (LE) | Monotonically incrementing packet sequence number |

```typescript
export interface PlayerMovePacket {
  type: 1;
  playerId: string;
  x: number;
  y: number;
  z: number;
  pitch: number;
  yaw: number;
  animState: number;
  sequence: number;
}
```

### Packet Type 2: `BLOCK_DELTA` (12 Bytes Header + `N * 4` Bytes Payload)
Transmitted across the `default` reliable channel whenever blocks are added or removed.

| Byte Offset | Field | Type | Description |
| :--- | :--- | :--- | :--- |
| `0` | `type` | `Uint8` | Fixed value: `2` |
| `1 - 3` | `padding` | `Uint8[3]` | Alignment padding |
| `4 - 7` | `chunkX` | `Int32` (LE) | Chunk grid X coordinate (`cx`) |
| `8 - 11` | `chunkZ` | `Int32` (LE) | Chunk grid Z coordinate (`cz`) |
| `12 + (i * 8)` | `blockIndex` | `Uint32` (LE) | 1D index within chunk buffer `(y - (-32)) * 256 + lz * 16 + lx` |
| `16 + (i * 8)` | `packedValue` | `Uint32` (LE) | 32-bit ECS packed block data (Texture, Health, Fluid, Occlusion) |

```typescript
export interface BlockDeltaPacket {
  type: 2;
  chunkX: number;
  chunkZ: number;
  deltas: Uint32Array; // Pairs of [Index, PackedValue]
}
```

### Packet Type 3: `ENTITY_STATE`
Transmitted across the `default` reliable channel for mob, swarm, and dropped item state synchronization.

---

## 4. Chunk Streaming & Handshake Lifecycle

```
Guest                                                 Host
  |                                                     |
  |--- peer.connect(hostId) --------------------------->|
  |<-- DataChannel Open Event ------------------------->|
  |                                                     |
  |    (Host fetches IDB guest profile)                 |
  |<-- WELCOME { worldSeed, guestState, shipData } -----|
  |                                                     |
  |-- REQUEST_CHUNK { chunkKey: "0,0" } --------------->|
  |                                                     |
  |    (If modified)                                    |
  |<-- WORLD_SYNC_RLE { chunkKey, rle } ----------------|
  |    (If unmodified procedural)                       |
  |<-- CHUNK_PRISTINE { chunkKey } ---------------------|
```

### Handshake Resilience
- The Host sends a `WELCOME` payload containing `worldSeed`, `guestState` (inventory and last safe coordinates from previous sessions), and active `shipData`.
- Fallbacks (`data.hostId || 'host'`, `data.hostName || 'Host'`) guarantee the guest transitions from `connecting` to `connected` without triggering ghost room timeouts.

### Chunk Request Queue & Draining
- Guests request chunks via `REQUEST_CHUNK`.
- To prevent network saturation, chunk requests are capped at `MAX_CONCURRENT_CHUNK_REQUESTS = 4`.
- If a chunk fails or exceeds retries, the engine issues `CHUNK_PRISTINE`, instructing the guest to generate the chunk locally via procedural 3D Simplex noise and safely drains the in-flight queue.

---

## 5. Physical Vehicle & Boat Synchronization

Vehicles are dynamic rigid bodies (`isShipActive: true`) with physical voxel colliders.

### Piloting State Machine
1. **Boarding / Request Helm:**
   - Guest interacts with the helm block and dispatches `REQUEST_HELM`.
   - Host arbitrates helm access: if unpiloted, sets `shipHelmPlayerId = guestId` and broadcasts `HELM_UPDATE`.
   - Guest receives `HELM_UPDATE`, setting `isSeated = true` and enabling local WASD flight input.
2. **Steer Intent Streaming:**
   - The seated pilot broadcasts `SHIP_STEER_INTENT` (`forward`, `backward`, `turnLeft`, `turnRight`, `ascend`, `descend`).
   - Host Rapier physics step reads intents from `shipSteerIntents[playerId]` and applies angular velocity via `setAngvel`.
3. **Authoritative Transform Streaming:**
   - Host broadcasts `SHIP_TRANSFORM` at 30Hz containing position and rotation vectors.
   - Resting-frame fallback (`window.__forceShipBroadcast = true`) ensures spawn positions and docked states broadcast immediately even before velocity calculations begin.
4. **Dismounting / Release Helm:**
   - Pilot triggers dismount (Shift or release action) dispatching `RELEASE_HELM`.
   - Host clears helm ownership and broadcasts `HELM_UPDATE` with `playerId: null`.

---

## 6. Global Telemetry Subsystem (`window.__DEBUG_STATS__`)

Telemetry is tracked synchronously across WebGL and network layers:

```typescript
interface DebugStats {
  fps: number;
  cpuTime: number;
  gpuTime: number;
  drawCalls: number;
  triangles: number;
  vertices: number;
  textureBinds: number;
  vboMemoryBytes: number;
  totalChunks: number;
  chunksRendered: number;
  totalEntities: number;
  entitiesRendered: number;
  bytesSent: number;
  bytesReceived: number;
  ping: number;
  packetStats: {
    sent: Record<string, number>;
    recv: Record<string, number>;
  };
  errorLog: Array<{ message: string; timestamp: number }>;
}
```

### Telemetry Attachment Rules
- `attachSendTelemetry(conn)` intercepts `conn.send` for both reliable and unreliable channels, recording bytes sent and incrementing `packetStats.sent[type]`.
- `trackReceiveTelemetry(data)` intercepts `conn.on('data')`, recording payload sizes and incrementing `packetStats.recv[type]`.
- `window.__DEBUG_STATS__` defaults are defensively initialized in `src/utils/WebGLTracker.ts`, `src/globals.ts`, and `src/components/DebugOverlay.tsx` using nullish coalescing operators to prevent `NaN` arithmetic.
