# Documentation Index

Technical guides, architectural patterns, and subsystem specifications for World Searcher.

---

## Architecture & Core Design

- **[Architecture & Performance Guidelines](ARCHITECTURE.md)**: Scene graph separation, Web Worker threading, zero-copy buffer transfers, and memory constraints.
- **[System Architecture](architecture/architecture.md)**: Tick rates, authoritative server mechanics, and WebRTC network topologies.
- **[Design System & ECS Format](architecture/design_system.md)**: 32-bit ECS bitmasking rules and rendering data layout.
- **[Design Philosophy](architecture/design.md)**: Core aesthetic and gameplay goals.
- **[Terrain & Physics Fixes](architecture/terrain-rendering-and-physics-fixes.md)**: Deep-dive into physics collision generation and raycast safety.

---

## Engine Subsystems

- **[Ship & Vehicle Physics](systems/shipdesign.md)**: Voxel vehicle kinematics, quaternion math, and seating mechanics.
- **[Combat & Weapons](systems/COMBAT.md)**: Hitscan verification, enemy behavior, and damage calculation.
- **[Diagnostics & Performance](systems/DIAGNOSTICS.md)**: Frame profilers, memory dumps, and debug HUD.
- **[Game Modes](systems/GAME_MODES.md)**: Game rules and session configurations.
- **[Admin & Host Commands](systems/COMMANDS.md)**: In-engine developer commands and debugging utilities.
