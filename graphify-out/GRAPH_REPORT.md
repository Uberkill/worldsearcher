# Graph Report - .  (2026-06-08)

## Corpus Check
- 2 files · ~300,491 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 755 nodes · 1759 edges · 65 communities (52 shown, 13 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 15 edges (avg confidence: 0.94)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_network Actions js|network Actions js]]
- [[_COMMUNITY_blocks json|blocks json]]
- [[_COMMUNITY_use Store|use Store]]
- [[_COMMUNITY_Swarm Manager jsx|Swarm Manager jsx]]
- [[_COMMUNITY_Chunk jsx|Chunk jsx]]
- [[_COMMUNITY_dependencies|dependencies]]
- [[_COMMUNITY_db js|db js]]
- [[_COMMUNITY_combat|combat]]
- [[_COMMUNITY_lighting js|lighting js]]
- [[_COMMUNITY_Game Engine jsx|Game Engine jsx]]
- [[_COMMUNITY_greedy Mesh js|greedy Mesh js]]
- [[_COMMUNITY_Registry js|Registry js]]
- [[_COMMUNITY_Game Audio System|Game Audio System]]
- [[_COMMUNITY_Player jsx|Player jsx]]
- [[_COMMUNITY_get Index|get Index]]
- [[_COMMUNITY_world Actions js|world Actions js]]
- [[_COMMUNITY_structures js|structures js]]
- [[_COMMUNITY_Worker Manager|Worker Manager]]
- [[_COMMUNITY_biomes json|biomes json]]
- [[_COMMUNITY_Enemies jsx|Enemies jsx]]
- [[_COMMUNITY_dev Dependencies|dev Dependencies]]
- [[_COMMUNITY_chunk Data js|chunk Data js]]
- [[_COMMUNITY_View Model jsx|View Model jsx]]
- [[_COMMUNITY_Flares jsx|Flares jsx]]
- [[_COMMUNITY_Tether jsx|Tether jsx]]
- [[_COMMUNITY_Min Heap|Min Heap]]
- [[_COMMUNITY_package json|package json]]
- [[_COMMUNITY_Block Registry js|Block Registry js]]
- [[_COMMUNITY_store Linker js|store Linker js]]
- [[_COMMUNITY_scripts|scripts]]
- [[_COMMUNITY_ruins json|ruins json]]
- [[_COMMUNITY_shop json|shop json]]
- [[_COMMUNITY_fix store calls js|fix store calls js]]
- [[_COMMUNITY_crystal spire json|crystal spire json]]
- [[_COMMUNITY_meteor json|meteor json]]
- [[_COMMUNITY_tree arch json|tree arch json]]
- [[_COMMUNITY_tree glass json|tree glass json]]
- [[_COMMUNITY_tree mushroom json|tree mushroom json]]
- [[_COMMUNITY_tree normal json|tree normal json]]
- [[_COMMUNITY_tree skinny json|tree skinny json]]
- [[_COMMUNITY_tree thick json|tree thick json]]
- [[_COMMUNITY_generate models js|generate models js]]
- [[_COMMUNITY_Idempotent Event Bus|Idempotent Event Bus]]
- [[_COMMUNITY_Bullets jsx|Bullets jsx]]
- [[_COMMUNITY_Lasers jsx|Lasers jsx]]
- [[_COMMUNITY_ECS Material Cache|ECS Material Cache]]
- [[_COMMUNITY_Q Why does Worker|Q Why does Worker]]
- [[_COMMUNITY_Q Why does Game|Q Why does Game]]
- [[_COMMUNITY_High Performance Voxel Constraints|High Performance Voxel Constraints]]
- [[_COMMUNITY_restore js|restore js]]
- [[_COMMUNITY_husky sh|husky sh]]
- [[_COMMUNITY_Glassmorphism UI|Glassmorphism UI]]
- [[_COMMUNITY_Decoupling of the Monolithic|Decoupling of the Monolithic]]
- [[_COMMUNITY_skills json|skills json]]
- [[_COMMUNITY_Material Sharing Anti Pattern|Material Sharing Anti Pattern]]
- [[_COMMUNITY_IndexedDB Chunk Schema|IndexedDB Chunk Schema]]
- [[_COMMUNITY_Entity management Swarm Manager|Entity management Swarm Manager]]

## God Nodes (most connected - your core abstractions)
1. `useStore` - 77 edges
2. `color` - 24 edges
3. `health` - 24 edges
4. `isTransparent` - 24 edges
5. `lightLevel` - 24 edges
6. `isFlora` - 24 edges
7. `isPassable` - 24 edges
8. `isLiquid` - 24 edges
9. `getIndex()` - 22 edges
10. `texture` - 20 edges

## Surprising Connections (you probably didn't know these)
- `WorkerManager` --conceptually_related_to--> `Web Worker Data Transfer Constraints`  [INFERRED]
  src/utils/workerPool.js → architecture.md
- `High-Performance Voxel Constraints` --semantically_similar_to--> `32-Bit Voxel ECS Standard`  [INFERRED] [semantically similar]
  AGENTS.md → design_system.md
- `Fixed Physics Tick` --semantically_similar_to--> `Snapshot Visual Interpolation`  [INFERRED] [semantically similar]
  COMBAT.md → README.md
- `Design System Core Principles` --conceptually_related_to--> `High-Performance Voxel Constraints`  [INFERRED]
  design_system.md → AGENTS.md
- `Host-Authoritative Combat` --conceptually_related_to--> `Multiplayer Authority`  [INFERRED]
  COMBAT.md → AGENTS.md

## Import Cycles
- 3-file cycle: `src/audio/GameAudio.js -> src/stores/useStore.js -> src/stores/createPlayerSlice.js -> src/audio/GameAudio.js`

## Communities (65 total, 13 thin omitted)

### Community 0 - "network Actions js"
Cohesion: 0.06
Nodes (33): Multiplayer Authority, Fixed Physics Tick, Host-Authoritative Combat, Host Control Commands, Minimap(), texColors, BODY_GEO, BODY_MAT (+25 more)

### Community 1 - "blocks json"
Cohesion: 0.32
Nodes (41): alien_sand, bedrock, chest, cobblestone, crafting_table, crystal, dirt, texture (+33 more)

### Community 2 - "use Store"
Cohesion: 0.11
Nodes (9): FPV(), GhostBlock(), HealthBar(), TIPS, PostFX(), fluidInterval, useStore, InGameUI() (+1 more)

### Community 3 - "Swarm Manager jsx"
Cohesion: 0.07
Nodes (28): setGlobalAudioPool(), _aPivotDrop, _aPos, _aQ, baseGeo, baseMat, _color, _dir (+20 more)

### Community 4 - "Chunk jsx"
Cohesion: 0.10
Nodes (18): Chunk, getSolidMaterial(), getTransparentMaterial(), geometry, idx, norm, pos, uv (+10 more)

### Community 5 - "dependencies"
Cohesion: 0.06
Nodes (31): dependencies, @babel/core, @babel/generator, @babel/parser, @babel/traverse, framer-motion, html2canvas, idb-keyval (+23 more)

### Community 6 - "db js"
Cohesion: 0.12
Nodes (22): TitleScreen(), cancelLoadFromDB(), clearDB(), clearSlotDB(), compressRLE(), decompressRLE(), deleteChunkFromDB(), exportSlot() (+14 more)

### Community 7 - "combat"
Cohesion: 0.20
Nodes (23): areaOfEffect, cooldownMs, damage, range, raycastRadius, speed, flare, gauss_rifle (+15 more)

### Community 8 - "lighting js"
Cohesion: 0.17
Nodes (24): getGlobalBlockTex(), getSunlight(), setBlock(), setSunlight(), calculateFaceLighting(), checkQueue(), dirs, generateBlockLight() (+16 more)

### Community 9 - "Game Engine jsx"
Cohesion: 0.16
Nodes (11): DeathScreen(), Enemies(), _dir, Lantern(), GameEngine(), LiquidOverlay(), useConnectionStore, initItemDropSystem() (+3 more)

### Community 10 - "greedy Mesh js"
Cohesion: 0.10
Nodes (17): getIsHidden(), buildGreedyArrays(), floraMatricesBuffer, floraPackedBuffer, NEIGHBORS, pIdxBuffer, pPosBuffer, sColorBuffer (+9 more)

### Community 11 - "Registry js"
Cohesion: 0.18
Nodes (10): _color, DroppedItems(), _dummy, ITEM_GEO, ITEM_MAT, getDef(), getRegistryColor(), getRegistryName() (+2 more)

### Community 13 - "Player jsx"
Cohesion: 0.14
Nodes (13): Hotbar(), _camPos, CollisionLayers, _direction, _frontVector, Player(), _rayDir, _rayOrigin (+5 more)

### Community 14 - "get Index"
Cohesion: 0.24
Nodes (9): castRayDDA(), _dir, Crosshair(), Cubes, projScreenMatrix, BlockKeyById, useChunkStore, getIndex() (+1 more)

### Community 15 - "world Actions js"
Cohesion: 0.13
Nodes (12): bufferRecycleQueue, cancelledChunks, flareLightMap, inFlightChunks, meshRebuildTimers, pass1Cache, processingNetworkDeltas, telemetryInterval (+4 more)

### Community 16 - "structures js"
Cohesion: 0.15
Nodes (14): spatialHash(), CrystalSpireStructure, hash(), MeteorStructure, mulberry32(), RuinsStructure, ShopStructure, spatialHash() (+6 more)

### Community 18 - "biomes json"
Cohesion: 0.51
Nodes (14): alien_desert, boss_arena, desert, forest, fauna, flora, roughness, subsurface (+6 more)

### Community 19 - "Enemies jsx"
Cohesion: 0.36
Nodes (9): getNoises(), BlockById, getBiomeAt(), getBiomeConfig(), getRegionStoryBeat(), spatialHash(), generateChunkPass1(), mulberry32() (+1 more)

### Community 20 - "dev Dependencies"
Cohesion: 0.14
Nodes (14): devDependencies, autoprefixer, eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, lint-staged (+6 more)

### Community 21 - "chunk Data js"
Cohesion: 0.22
Nodes (9): getGlobalBlockLevel(), getGlobalBlockLight(), getGlobalBlockVal(), getGlobalRawBlock(), getLevel(), setFluidLevel(), getFluidMaxSpread(), tickFluids() (+1 more)

### Community 22 - "View Model jsx"
Cohesion: 0.18
Nodes (10): CUBE_GEO, FallbackModels, getColor(), _targetEul, _targetPos, _targetQuat, TOOL_COLORS, TOOL_GEO (+2 more)

### Community 23 - "Flares jsx"
Cohesion: 0.22
Nodes (9): EMBER_GEO, EMBER_MAT, FLAME_GEO, FLAME_MAT, Flares(), STICK_GEO, STICK_MAT, newFlareLightMap (+1 more)

### Community 24 - "Tether jsx"
Cohesion: 0.18
Nodes (10): _camWorldPos, _dir, _dummy, _end, _midPoint, _right, Tether(), TETHER_GEO (+2 more)

### Community 26 - "package json"
Cohesion: 0.20
Nodes (9): name, private, type, version, author, description, keywords, license (+1 more)

### Community 27 - "Block Registry js"
Cohesion: 0.31
Nodes (6): tileY, BlockIds, FaceMappings, TextureIdByName, TextureRegistry, getBlockKey()

### Community 28 - "store Linker js"
Cohesion: 0.28
Nodes (4): main_quests, side_quests_pool, getNetworkStore(), setGameStore()

### Community 29 - "scripts"
Cohesion: 0.29
Nodes (7): scripts, build, dev, lint, prepare, preview, test

### Community 30 - "ruins json"
Cohesion: 0.29
Nodes (6): layers, name, palette, D, G, S

### Community 31 - "shop json"
Cohesion: 0.29
Nodes (6): layers, name, palette, F, L, W

### Community 32 - "fix store calls js"
Cohesion: 0.29
Nodes (6): content, filePath, fs, path, updated1, updated2

### Community 33 - "crystal spire json"
Cohesion: 0.33
Nodes (5): layers, name, palette, G, L

### Community 34 - "meteor json"
Cohesion: 0.33
Nodes (5): layers, name, palette, B, T

### Community 35 - "tree arch json"
Cohesion: 0.33
Nodes (5): layers, name, palette, F, L

### Community 36 - "tree glass json"
Cohesion: 0.33
Nodes (5): layers, name, palette, G, L

### Community 37 - "tree mushroom json"
Cohesion: 0.33
Nodes (5): layers, name, palette, F, L

### Community 38 - "tree normal json"
Cohesion: 0.33
Nodes (5): layers, name, palette, F, L

### Community 39 - "tree skinny json"
Cohesion: 0.33
Nodes (5): layers, name, palette, F, L

### Community 40 - "tree thick json"
Cohesion: 0.33
Nodes (5): layers, name, palette, F, L

### Community 41 - "generate models js"
Cohesion: 0.40
Nodes (3): exporter, exportGLTF(), main()

### Community 45 - "Bullets jsx"
Cohesion: 0.40
Nodes (4): BULLET_GEO, BULLET_MAT, Bullets(), _dummy

### Community 46 - "Lasers jsx"
Cohesion: 0.40
Nodes (4): _dummy, LASER_GEO, LASER_MAT, Lasers()

### Community 48 - "Q Why does Worker"
Cohesion: 0.50
Nodes (3): Answer, Q: Why does WorkerManager connect Worker Pool & Task Threading to Block & Texture Registry?, Source Nodes

### Community 49 - "Q Why does Game"
Cohesion: 0.50
Nodes (3): Answer, Q: Why does GameAudioSystem connect Game Audio Engine to Game Audio & Settings State?, Source Nodes

### Community 50 - "High Performance Voxel Constraints"
Cohesion: 1.00
Nodes (3): High-Performance Voxel Constraints, 32-Bit Voxel ECS Standard, Design System Core Principles

## Knowledge Gaps
- **271 isolated node(s):** `husky.sh script`, `name`, `private`, `version`, `type` (+266 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `useStore` connect `use Store` to `network Actions js`, `Swarm Manager jsx`, `Chunk jsx`, `db js`, `Game Engine jsx`, `Registry js`, `Game Audio System`, `Bullets jsx`, `get Index`, `Player jsx`, `Lasers jsx`, `world Actions js`, `Worker Manager`, `Enemies jsx`, `View Model jsx`, `Flares jsx`, `Tether jsx`, `store Linker js`?**
  _High betweenness centrality (0.137) - this node is a cross-community bridge._
- **Why does `GameAudioSystem` connect `Game Audio System` to `use Store`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `WorkerManager` connect `Worker Manager` to `use Store`, `world Actions js`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **What connects `husky.sh script`, `name`, `private` to the rest of the system?**
  _277 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `network Actions js` be split into smaller, more focused modules?**
  _Cohesion score 0.05669199298655757 - nodes in this community are weakly interconnected._
- **Should `use Store` be split into smaller, more focused modules?**
  _Cohesion score 0.1111111111111111 - nodes in this community are weakly interconnected._
- **Should `Swarm Manager jsx` be split into smaller, more focused modules?**
  _Cohesion score 0.07196969696969698 - nodes in this community are weakly interconnected._