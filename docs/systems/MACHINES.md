# Machine & Item Physics Systems

This document describes the background simulation systems for automated crafting machines and authoritative item drop physics.

---

## 1. Machine Tick System (`MachineTickSystem.ts`)

The `MachineTickSystem` manages off-tick machine processing, energy consumption, and product crafting for player-placed voxel machines (such as smelters, processors, and charging stations).

### Architectural Invariants
- **Host Authoritative:** In multiplayer sessions, machine ticks execute exclusively on the Host. Results (items produced, fuel consumed) replicate to Guests via store updates.
- **Fixed Interval Execution:** Machine logic ticks at a fixed frequency (1-5 Hz depending on machine tier) decoupled from visual rendering to minimize main thread contention.
- **State Serialization:** Machine states (internal inventory, progress counters, power buffers) serialize into chunk block metadata and persist in IndexedDB.

---

## 2. Item Drop System (`ItemDropSystem.ts`)

The `ItemDropSystem` governs physics-based entity drops when voxels are mined, exploded, or dismantled.

### Key Behaviors
- **Drop Consolidation:** Adjacent drops of the same material automatically stack up to max stack sizes (64) to prevent entity count explosions and broad-phase physics lag.
- **Entity Caps:** Drop counts are strictly capped at 1000 items per world instance. When exceeded, the oldest uncollected drops are pruned.
- **Gravity Invariant:** Destruction caused by structural gravity collapse (`causedByGravity: true`) does not spawn item drops, preventing cascading mass duplication during cave-ins.
- **Host Spawning:** In multiplayer sessions, drops only spawn when `isHost === true`. Guests receive synchronized item entities via `ENTITY_STATE` packets.
