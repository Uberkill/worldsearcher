# Graph Report - .  (2026-06-10)

## Corpus Check
- 77 files · ~304,373 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 851 nodes · 1885 edges · 79 communities (60 shown, 19 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 37 edges (avg confidence: 0.92)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_networkActions State Slice|networkActions State Slice]]
- [[_COMMUNITY_blocks|blocks]]
- [[_COMMUNITY_db Utility|db Utility]]
- [[_COMMUNITY_SwarmManager Component|SwarmManager Component]]
- [[_COMMUNITY_useStore State Slice|useStore State Slice]]
- [[_COMMUNITY_Project Configuration & Dependencies|Project Configuration & Dependencies]]
- [[_COMMUNITY_Chunk Component|Chunk Component]]
- [[_COMMUNITY_chunkData Utility|chunkData Utility]]
- [[_COMMUNITY_combat|combat]]
- [[_COMMUNITY_Zustand World Action Helpers|Zustand World Action Helpers]]
- [[_COMMUNITY_useStore State Slice (useStore)|useStore State Slice (useStore)]]
- [[_COMMUNITY_GameEngine|GameEngine]]
- [[_COMMUNITY_lighting Utility|lighting Utility]]
- [[_COMMUNITY_Enemies Component|Enemies Component]]
- [[_COMMUNITY_Web Worker Thread Pool|Web Worker Thread Pool]]
- [[_COMMUNITY_useChunkStore State Slice|useChunkStore State Slice]]
- [[_COMMUNITY_GameAudioSystem|GameAudioSystem]]
- [[_COMMUNITY_ViewModel Component|ViewModel Component]]
- [[_COMMUNITY_Player Component|Player Component]]
- [[_COMMUNITY_structures Utility|structures Utility]]
- [[_COMMUNITY_biomes|biomes]]
- [[_COMMUNITY_Project Configuration & Dependencies (devDependencies)|Project Configuration & Dependencies (devDependencies)]]
- [[_COMMUNITY_Host-Authoritative Combat System|Host-Authoritative Combat System]]
- [[_COMMUNITY_MinHeap|MinHeap]]
- [[_COMMUNITY_Tether Component|Tether Component]]
- [[_COMMUNITY_Project Configuration & Dependencies (package)|Project Configuration & Dependencies (package)]]
- [[_COMMUNITY_BlockRegistry Registry System|BlockRegistry Registry System]]
- [[_COMMUNITY_Flares Component|Flares Component]]
- [[_COMMUNITY_IndexedDB Off-thread Database Worker|IndexedDB Off-thread Database Worker]]
- [[_COMMUNITY_Project Configuration & Dependencies (scripts)|Project Configuration & Dependencies (scripts)]]
- [[_COMMUNITY_ruins|ruins]]
- [[_COMMUNITY_shop|shop]]
- [[_COMMUNITY_fix_store_calls|fix_store_calls]]
- [[_COMMUNITY_AI Agent Performance Instructions|AI Agent Performance Instructions]]
- [[_COMMUNITY_Admin Command Execution Authority|Admin Command Execution Authority]]
- [[_COMMUNITY_crystal_spire|crystal_spire]]
- [[_COMMUNITY_meteor|meteor]]
- [[_COMMUNITY_tree_arch|tree_arch]]
- [[_COMMUNITY_tree_glass|tree_glass]]
- [[_COMMUNITY_tree_mushroom|tree_mushroom]]
- [[_COMMUNITY_tree_normal|tree_normal]]
- [[_COMMUNITY_tree_skinny|tree_skinny]]
- [[_COMMUNITY_tree_thick|tree_thick]]
- [[_COMMUNITY_generate_models|generate_models]]
- [[_COMMUNITY_IdempotentEventBus Utility|IdempotentEventBus Utility]]
- [[_COMMUNITY_Bullets Component|Bullets Component]]
- [[_COMMUNITY_Hotbar Component|Hotbar Component]]
- [[_COMMUNITY_Lasers Component|Lasers Component]]
- [[_COMMUNITY_check_architecture|check_architecture]]
- [[_COMMUNITY_ECSMaterialCache Utility|ECSMaterialCache Utility]]
- [[_COMMUNITY_Q Why does WorkerManager connect|Q: Why does WorkerManager connect]]
- [[_COMMUNITY_Q Why does GameAudioSystem connect|Q: Why does GameAudioSystem connect]]
- [[_COMMUNITY_AI Agent Performance Instructions (Material Sharing Anti-Pattern)|AI Agent Performance Instructions (Material Sharing Anti-Pattern)]]
- [[_COMMUNITY_AI Agent Performance Instructions (High-Performance Voxel Constraints)|AI Agent Performance Instructions (High-Performance Voxel Constraints)]]
- [[_COMMUNITY_restore|restore]]
- [[_COMMUNITY_husky.sh|husky.sh]]
- [[_COMMUNITY_AI Agent Core Safety Rules|AI Agent Core Safety Rules]]
- [[_COMMUNITY_Graphify Architectural Insights|Graphify Architectural Insights]]
- [[_COMMUNITY_Memory Optimization & Decoupling|Memory Optimization & Decoupling]]
- [[_COMMUNITY_Sci-Fi Visual Design System|Sci-Fi Visual Design System]]
- [[_COMMUNITY_AI Agent Performance Instructions (Diagnostics & SpectorModal)|AI Agent Performance Instructions (Diagnostics & SpectorModal)]]
- [[_COMMUNITY_AI Agent Performance Instructions (Host Supreme Authority Rule)|AI Agent Performance Instructions (Host Supreme Authority Rule)]]
- [[_COMMUNITY_AI Agent Core Safety Rules (Rule 1 Never Put High-Volume Geometry in React Tree)|AI Agent Core Safety Rules (Rule 1: Never Put High-Volume Geometry in React Tree)]]
- [[_COMMUNITY_Memory Optimization & Decoupling (Decoupling of the Monolithic God Object)|Memory Optimization & Decoupling (Decoupling of the Monolithic God Object)]]
- [[_COMMUNITY_Core Voxel Game Architecture|Core Voxel Game Architecture]]
- [[_COMMUNITY_Host-Authoritative Combat System (Entity management (SwarmManager))|Host-Authoritative Combat System (Entity management (SwarmManager))]]
- [[_COMMUNITY_Core Voxel Game Architecture (IndexedDB Chunk Persistence)|Core Voxel Game Architecture (IndexedDB Chunk Persistence)]]
- [[_COMMUNITY_Host-Authoritative Combat System (Grapple Gun Tethering)|Host-Authoritative Combat System (Grapple Gun Tethering)]]
- [[_COMMUNITY_Sci-Fi Visual Design System (Sci-Fi Voxel Visual Language)|Sci-Fi Visual Design System (Sci-Fi Voxel Visual Language)]]
- [[_COMMUNITY_Graphify Architectural Insights (Isolated Code Technical Debt)|Graphify Architectural Insights (Isolated Code Technical Debt)]]
- [[_COMMUNITY_Memory Optimization & Decoupling (Custom AABB Frustum Culling)|Memory Optimization & Decoupling (Custom AABB Frustum Culling)]]

## God Nodes (most connected - your core abstractions)
1. `useStore` - 78 edges
2. `color` - 24 edges
3. `health` - 24 edges
4. `isTransparent` - 24 edges
5. `lightLevel` - 24 edges
6. `isFlora` - 24 edges
7. `isPassable` - 24 edges
8. `isLiquid` - 24 edges
9. `useChunkStore` - 22 edges
10. `getIndex()` - 22 edges

## Surprising Connections (you probably didn't know these)
- `WorkerManager` --conceptually_related_to--> `Web Worker Data Transfer Constraints`  [INFERRED]
  src/utils/workerPool.js → architecture.md
- `High-Performance Voxel Constraints` --semantically_similar_to--> `32-Bit Voxel ECS Standard`  [INFERRED] [semantically similar]
  AGENTS.md → design_system.md
- `Material Sharing Anti-Pattern` --semantically_similar_to--> `Material Sharing Anti-Pattern Principle`  [INFERRED] [semantically similar]
  AGENTS.md → docs/design_system.md
- `Fixed Physics Tick` --semantically_similar_to--> `Snapshot Visual Interpolation`  [INFERRED] [semantically similar]
  COMBAT.md → README.md
- `Host-Authoritative Combat System` --conceptually_related_to--> `Multiplayer Authority`  [INFERRED]
  docs/COMBAT.md → AGENTS.md

## Import Cycles
- 3-file cycle: `src/audio/GameAudio.js -> src/stores/useStore.js -> src/stores/createPlayerSlice.js -> src/audio/GameAudio.js`

## Hyperedges (group relationships)
- **Zero Allocation Guidelines** — docs_agents_zero_allocation, docs_design_system_zero_allocation_principle, docs_ai_agent_warnings_rule_3_zero_copy, docs_architecture_worker_rules [INFERRED 0.95]
- **Host Authority & Command Flow** — docs_combat_host_combat, docs_commands_admin_commands, docs_agents_host_authority, docs_design_system_host_authority_principle [INFERRED 0.85]
- **Off-thread Worker Architecture** — docs_ai_agent_warnings_rule_2_off_thread_math, docs_ai_agent_warnings_rule_3_zero_copy, docs_agents_off_thread_meshing, docs_architecture_worker_rules, memory_query_20260607_050746_why_does_workermanager_connect_worker_pool___task_query [INFERRED 0.95]

## Communities (79 total, 19 thin omitted)

### Community 0 - "networkActions State Slice"
Cohesion: 0.05
Nodes (42): Host Control Commands, _color, DroppedItems(), _dummy, ITEM_GEO, ITEM_MAT, BODY_GEO, BODY_MAT (+34 more)

### Community 1 - "blocks"
Cohesion: 0.32
Nodes (41): alien_sand, bedrock, chest, cobblestone, crafting_table, crystal, dirt, texture (+33 more)

### Community 2 - "db Utility"
Cohesion: 0.08
Nodes (26): initWorldSeed(), TitleScreen(), clearDB(), clearSlotDB(), compressRLE(), decompressRLE(), deleteChunkFromDB(), exportSlot() (+18 more)

### Community 3 - "SwarmManager Component"
Cohesion: 0.06
Nodes (32): setGlobalAudioPool(), _aPivotDrop, _aPos, _aQ, baseGeo, baseMat, _color, _dir (+24 more)

### Community 4 - "useStore State Slice"
Cohesion: 0.12
Nodes (7): getDef(), getRegistryColor(), getRegistryName(), GlobalRegistry, playerRotation, fluidInterval, QuestTracker()

### Community 5 - "Project Configuration & Dependencies"
Cohesion: 0.06
Nodes (31): dependencies, @babel/core, @babel/generator, @babel/parser, @babel/traverse, framer-motion, html2canvas, idb-keyval (+23 more)

### Community 6 - "Chunk Component"
Cohesion: 0.11
Nodes (20): Chunk, getSolidMaterial(), getTransparentMaterial(), geometry, idx, norm, pos, uv (+12 more)

### Community 7 - "chunkData Utility"
Cohesion: 0.10
Nodes (23): getGlobalBlockLevel(), getGlobalBlockLight(), getGlobalBlockVal(), getGlobalRawBlock(), getHealth(), getIsHidden(), getLevel(), setSunlight() (+15 more)

### Community 8 - "combat"
Cohesion: 0.20
Nodes (23): areaOfEffect, cooldownMs, damage, range, raycastRadius, speed, flare, gauss_rifle (+15 more)

### Community 9 - "Zustand World Action Helpers"
Cohesion: 0.09
Nodes (18): newFlareLightMap, useFlareStore, bufferRecycleQueue, cancelledChunks, dirtyChunkSet, flareLightMap, inFlightChunks, inFlightRebuildSet (+10 more)

### Community 10 - "useStore State Slice (useStore)"
Cohesion: 0.13
Nodes (12): DynamicSky(), MoonShaderMaterial, SunShaderMaterial, HealthBar(), TIPS, PostFX(), boxDims, depthMaterial (+4 more)

### Community 11 - "GameEngine"
Cohesion: 0.16
Nodes (13): DeathScreen(), Enemies(), _dir, Lantern(), FPV(), Minimap(), useConnectionStore, initItemDropSystem() (+5 more)

### Community 12 - "lighting Utility"
Cohesion: 0.18
Nodes (23): getGlobalBlockTex(), getSunlight(), setBlock(), calculateFaceLighting(), checkQueue(), dirs, generateBlockLight(), generateSunlight() (+15 more)

### Community 13 - "Enemies Component"
Cohesion: 0.23
Nodes (11): getNoises(), ServerTickMetrics, getSeed(), getBiomeAt(), getBiomeConfig(), getRegionStoryBeat(), spatialHash(), generateChunkPass1() (+3 more)

### Community 14 - "Web Worker Thread Pool"
Cohesion: 0.15
Nodes (5): Web Worker Data Transfer Constraints, chunkWorkerPool, injectWorkerDependencies(), POOL_SIZE, WorkerManager

### Community 15 - "useChunkStore State Slice"
Cohesion: 0.23
Nodes (10): castRayDDA(), _dir, Crosshair(), texColors, BlockById, BlockKeyById, playerPosition, useChunkStore (+2 more)

### Community 17 - "ViewModel Component"
Cohesion: 0.12
Nodes (11): GhostBlock(), CUBE_GEO, FallbackModels, getColor(), _targetEul, _targetPos, _targetQuat, TOOL_COLORS (+3 more)

### Community 18 - "Player Component"
Cohesion: 0.12
Nodes (15): _camPos, CollisionLayers, _direction, _frontVector, _grappleCamPos, _grappleFinalVel, _grapplePullDir, _grappleTarget (+7 more)

### Community 19 - "structures Utility"
Cohesion: 0.15
Nodes (14): spatialHash(), CrystalSpireStructure, hash(), MeteorStructure, mulberry32(), RuinsStructure, ShopStructure, spatialHash() (+6 more)

### Community 20 - "biomes"
Cohesion: 0.51
Nodes (14): alien_desert, boss_arena, desert, forest, fauna, flora, roughness, subsurface (+6 more)

### Community 21 - "Project Configuration & Dependencies (devDependencies)"
Cohesion: 0.14
Nodes (14): devDependencies, autoprefixer, eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, lint-staged (+6 more)

### Community 22 - "Host-Authoritative Combat System"
Cohesion: 0.17
Nodes (13): Multiplayer Authority, Fixed Physics Tick, Physics Accumulator & Tick, 144Hz Visual Interpolation, Hitscan and Melee Logic, Host-Authoritative Combat System, Projectile Physics & Syncing, Centralized Swarm Manager (+5 more)

### Community 24 - "Tether Component"
Cohesion: 0.18
Nodes (10): _camWorldPos, _dir, _dummy, _end, _midPoint, _right, Tether(), TETHER_GEO (+2 more)

### Community 25 - "Project Configuration & Dependencies (package)"
Cohesion: 0.20
Nodes (9): name, private, type, version, author, description, keywords, license (+1 more)

### Community 26 - "BlockRegistry Registry System"
Cohesion: 0.31
Nodes (6): tileY, BlockIds, FaceMappings, TextureIdByName, TextureRegistry, getBlockKey()

### Community 27 - "Flares Component"
Cohesion: 0.25
Nodes (7): EMBER_GEO, EMBER_MAT, FLAME_GEO, FLAME_MAT, Flares(), STICK_GEO, STICK_MAT

### Community 28 - "IndexedDB Off-thread Database Worker"
Cohesion: 0.32
Nodes (4): getIndex(), migrateLegacyChunk(), setBlock(), walCache

### Community 29 - "Project Configuration & Dependencies (scripts)"
Cohesion: 0.29
Nodes (7): scripts, build, dev, lint, prepare, preview, test

### Community 30 - "ruins"
Cohesion: 0.29
Nodes (6): layers, name, palette, D, G, S

### Community 31 - "shop"
Cohesion: 0.29
Nodes (6): layers, name, palette, F, L, W

### Community 32 - "fix_store_calls"
Cohesion: 0.29
Nodes (6): content, filePath, fs, path, updated1, updated2

### Community 34 - "AI Agent Performance Instructions"
Cohesion: 0.33
Nodes (6): 32-Bit ECS Block Packing, Off-Thread Chunk Meshing, Zero Object Allocation Loop Rule, 32-Bit ECS Standard Principle, Zero Object Allocation Loop Principle, Query: WorkerManager connection explanation

### Community 35 - "Admin Command Execution Authority"
Cohesion: 0.33
Nodes (6): Admin Commands Authority, Give Command, Kick Command, Time Set Command, Teleport Command, Game Modes System

### Community 36 - "crystal_spire"
Cohesion: 0.33
Nodes (5): layers, name, palette, G, L

### Community 37 - "meteor"
Cohesion: 0.33
Nodes (5): layers, name, palette, B, T

### Community 38 - "tree_arch"
Cohesion: 0.33
Nodes (5): layers, name, palette, F, L

### Community 39 - "tree_glass"
Cohesion: 0.33
Nodes (5): layers, name, palette, G, L

### Community 40 - "tree_mushroom"
Cohesion: 0.33
Nodes (5): layers, name, palette, F, L

### Community 41 - "tree_normal"
Cohesion: 0.33
Nodes (5): layers, name, palette, F, L

### Community 42 - "tree_skinny"
Cohesion: 0.33
Nodes (5): layers, name, palette, F, L

### Community 43 - "tree_thick"
Cohesion: 0.33
Nodes (5): layers, name, palette, F, L

### Community 44 - "generate_models"
Cohesion: 0.40
Nodes (3): exporter, exportGLTF(), main()

### Community 47 - "Bullets Component"
Cohesion: 0.40
Nodes (4): BULLET_GEO, BULLET_MAT, Bullets(), _dummy

### Community 49 - "Lasers Component"
Cohesion: 0.40
Nodes (4): _dummy, LASER_GEO, LASER_MAT, Lasers()

### Community 50 - "check_architecture"
Cohesion: 0.40
Nodes (3): __dirname, __filename, SRC_DIR

### Community 52 - "Q: Why does WorkerManager connect"
Cohesion: 0.50
Nodes (3): Answer, Q: Why does WorkerManager connect Worker Pool & Task Threading to Block & Texture Registry?, Source Nodes

### Community 53 - "Q: Why does GameAudioSystem connect"
Cohesion: 0.50
Nodes (3): Answer, Q: Why does GameAudioSystem connect Game Audio Engine to Game Audio & Settings State?, Source Nodes

### Community 54 - "AI Agent Performance Instructions (Material Sharing Anti-Pattern)"
Cohesion: 0.67
Nodes (3): Material Sharing Anti-Pattern, Material Sharing Anti-Pattern Principle, Coding Standards & ECS Principles

### Community 55 - "AI Agent Performance Instructions (High-Performance Voxel Constraints)"
Cohesion: 1.00
Nodes (3): High-Performance Voxel Constraints, 32-Bit Voxel ECS Standard, Design System Core Principles

### Community 58 - "AI Agent Core Safety Rules"
Cohesion: 0.67
Nodes (3): Rule 2: Off-Thread All Terrain & RLE Math, Rule 3: Zero-Copy Transferable Objects, Web Worker Structured Clone Rules

### Community 59 - "Graphify Architectural Insights"
Cohesion: 0.67
Nodes (3): Audio-Store-Player Import Cycle, God Nodes Bottlenecks, Query: GameAudioSystem connection explanation

### Community 60 - "Memory Optimization & Decoupling"
Cohesion: 0.67
Nodes (3): Zustand Decoupling Bug Fixes, Monolithic useStore Decoupling, Strangler Fig Interceptors

## Knowledge Gaps
- **315 isolated node(s):** `husky.sh script`, `name`, `private`, `version`, `type` (+310 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `useStore` connect `useStore State Slice (useStore)` to `networkActions State Slice`, `db Utility`, `SwarmManager Component`, `useStore State Slice`, `Chunk Component`, `GameEngine`, `Enemies Component`, `Web Worker Thread Pool`, `Bullets Component`, `GameAudioSystem`, `useChunkStore State Slice`, `ViewModel Component`, `Hotbar Component`, `Lasers Component`, `Player Component`, `Tether Component`, `Flares Component`?**
  _High betweenness centrality (0.119) - this node is a cross-community bridge._
- **Why does `GameAudioSystem` connect `GameAudioSystem` to `useStore State Slice (useStore)`, `useStore State Slice`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `WorkerManager` connect `Web Worker Thread Pool` to `useStore State Slice (useStore)`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **What connects `husky.sh script`, `name`, `private` to the rest of the system?**
  _334 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `networkActions State Slice` be split into smaller, more focused modules?**
  _Cohesion score 0.05144230769230769 - nodes in this community are weakly interconnected._
- **Should `db Utility` be split into smaller, more focused modules?**
  _Cohesion score 0.08048780487804878 - nodes in this community are weakly interconnected._
- **Should `SwarmManager Component` be split into smaller, more focused modules?**
  _Cohesion score 0.06306306306306306 - nodes in this community are weakly interconnected._