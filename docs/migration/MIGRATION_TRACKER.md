# TypeScript Migration Tracker

> **Current Stage:** 1 — Pre-Migration Refactoring
> **Status:** IN PROGRESS
> **Started:** 2026-06-19
> **Last Updated:** 2026-06-19
> **Migrated Files:** 0 / ~107

## Progress Overview

| Stage | Name | Status | Files Done | Risk |
|-------|------|--------|------------|------|
| 0 | Migration Infrastructure | ✅ COMPLETE | — | 5% |
| 1 | Pre-Migration Refactoring | ✅ COMPLETE | 7 | 25% |
| 2 | Type Foundation | ✅ COMPLETE | 9 | 10% |
| 3 | Leaf Node Migration | ✅ COMPLETE | 8 | 15% |
| 4 | Data Layer & JSON Typing | ✅ COMPLETE | 7 | 10% |
| 5 | Worker Pipeline | ⬜ NOT STARTED | — | 35% |
| 6 | Core Engine | ⬜ NOT STARTED | — | 40% |
| 7 | State Management | ⬜ NOT STARTED | — | 45% |
| 8 | Networking | ⬜ NOT STARTED | — | 30% |
| 9 | Audio & Systems | ⬜ NOT STARTED | — | 15% |
| 10 | React Hooks | ⬜ NOT STARTED | — | 10% |
| 11 | React Components | ⬜ NOT STARTED | — | 25% |
| 12 | Tests | ⬜ NOT STARTED | — | 10% |
| 13 | Strictness & Config | ⬜ NOT STARTED | — | 30% |
| 14 | Final Verification | ⬜ NOT STARTED | — | 5% |

## Stage Details

### Stage 0 — Migration Infrastructure
**Goal:** Install TypeScript, create configs, create documentation. ZERO code changes.

**Checklist:**
- [ ] Install typescript, typescript-eslint, @types/three
- [ ] Create tsconfig.json (3-file structure)
- [ ] Create src/vite-env.d.ts
- [ ] Add "typecheck" script to package.json
- [ ] Update ESLint config for TypeScript
- [ ] Update lint-staged for .ts/.tsx globs
- [ ] Create docs/migration/ directory with all files
- [ ] Create Serena migration memories
- [ ] Verify: npm run dev still works
- [ ] Verify: npm run typecheck runs with 0 errors

### Stage 1 — Pre-Migration Refactoring
**Goal:** Fix circular dep + split worldActions.js. Pure JS refactors, no TS yet.

**1A — Fix Circular Dependency:**
- [x] Create src/stores/useAudioStore.js (extract audio config from useStore)
- [x] Update GameAudio.js to import from useAudioStore
- [x] Update createPlayerSlice.js to remove audio config
- [x] Verify no circular dep warnings

**1B — Split worldActions.js (3,189 lines → 5 modules):**
- [x] Create src/stores/worldActions/ directory
- [x] Move chunk operations → chunkOperations.js
- [x] Move mesh mounting → meshMounting.js
- [x] Move fluid simulation → fluidSimulation.js
- [x] Move GC → garbageCollection.js
- [x] Move strangler interceptors → stranglerInterceptors.js
- [x] Create index.js barrel re-export
- [x] Delete original worldActions.js
- [x] All tests pass
- [x] Bump canary tracker

### Stage 2 — Type Foundation
**Goal:** Create src/types/ with shared type definitions. No file renames.

**Files to create:**
- [x] src/types/blocks.ts
- [x] src/types/items.ts
- [x] src/types/world.ts
- [x] src/types/player.ts
- [x] src/types/network.ts
- [x] src/types/store.ts
- [x] src/types/workers.ts
- [x] src/types/entities.ts
- [x] src/types/ship.ts
- [x] src/types/index.ts

### Stage 3 — Leaf Node Migration
**Goal:** Convert simplest files first. No downstream dependencies.

**Files to convert (.js → .ts):**
- [x] src/globals.ts
- [x] src/worldSeed.ts
- [x] src/utils/EventBus.ts
- [x] src/utils/NetworkEventBus.ts
- [x] src/registry/Registry.ts
- [x] src/registry/ItemRegistry.ts
- [x] src/registry/BlockRegistry.ts
- [x] src/registry/CraftingRegistry.ts

### Stage 4 — Data Layer
- [x] Create typed loaders for blocks.json, items.json, biomes.json, loot.json
- [x] Migrate src/registry/InteractionRegistry.js
- [x] Migrate src/registry/SmeltingRegistry.js
- [x] Create typed loaders for quests.json, skills.json

### Stage 5 — Worker Pipeline
- [ ] Worker message discriminated unions
- [ ] src/workers/chunkWorker.js → .ts
- [ ] src/workers/dbWorker.js → .ts
- [ ] src/workers/pathfinderWorker.js → .ts
- [ ] src/workers/shipWorker.js → .ts
- [ ] src/utils/workerPool.js → .ts

### Stage 6 — Core Engine
- [ ] ECS bitpacking utils → .ts
- [ ] lighting.js → .ts
- [ ] greedyMesh.js → .ts
- [ ] chunkGenerator.js → .ts
- [ ] ChunkMaterial.js → .ts

### Stage 7 — State Management
**Migration order (smallest → largest):**
- [ ] Decoupled stores (useUIStore, useChatStore, etc.) → .ts
- [ ] Small slices (settings, achievements, quests) → .ts
- [ ] Large slices (entity, ship, player) → .ts
- [ ] worldActions/ sub-modules → .ts
- [ ] useStore.js → .ts
- [ ] EventBus.js → .ts

### Stage 8 — Networking
- [ ] stores/network/ → .ts (5 files)
- [ ] systems/network/ → .ts (7 files)

### Stage 9 — Audio & Systems
- [ ] audio/ → .ts (3 files)
- [ ] systems/ remaining → .ts

### Stage 10 — React Hooks
- [ ] hooks/ → .ts (4 files)

### Stage 11 — React Components
- [ ] 11A: Small UI components → .tsx
- [ ] 11B: Large UI (TitleScreen, InGameUI) → .tsx
- [ ] 11C: 3D scene components → .tsx
- [ ] 11D: Entry points (GameEngine, App, main) → .tsx
- [ ] Update index.html script src

### Stage 12 — Tests
- [ ] Vitest setup + unit tests → .ts
- [ ] Playwright config + e2e tests → .ts

### Stage 13 — Strictness & Config
- [ ] vite.config.js → .ts
- [ ] eslint.config.js → .ts
- [ ] Remove allowJs: true
- [ ] Enable strict: true → fix all errors
- [ ] Enable noUncheckedIndexedAccess
- [ ] Audit and eliminate remaining `any`

### Stage 14 — Final Verification
- [ ] Full test suite passes
- [ ] Production build succeeds
- [ ] Game plays correctly
- [ ] All docs updated
- [ ] Graphify updated
- [ ] Canary tracker bumped

## Completed Files Log

_(Updated as files are migrated)_

| File | Stage | Date | Notes |
|------|-------|------|-------|
| `src/stores/useAudioStore.js` | 1A | 2026-06-19 | Extracted from `useStore.js` to break cycle |
| `src/stores/worldActions/index.js` | 1B | 2026-06-19 | Re-export barrel file |
| `src/stores/worldActions/sharedState.js` | 1B | 2026-06-19 | Shared states across modules |
| `src/stores/worldActions/chunkOperations.js` | 1B | 2026-06-19 | Extracted from `worldActions.js` |
| `src/stores/worldActions/meshMounting.js` | 1B | 2026-06-19 | Extracted from `worldActions.js` |
| `src/stores/worldActions/fluidSimulation.js` | 1B | 2026-06-19 | Extracted from `worldActions.js` |
| `src/stores/worldActions/garbageCollection.js` | 1B | 2026-06-19 | Extracted from `worldActions.js` |
| `src/stores/worldActions/stranglerInterceptors.js` | 1B | 2026-06-19 | Extracted from `worldActions.js` |
| `src/types/blocks.ts` | 2 | 2026-06-19 | Type definitions for block registry |
| `src/types/items.ts` | 2 | 2026-06-19 | Type definitions for item registry |
| `src/types/world.ts` | 2 | 2026-06-19 | Type definitions for chunks/world |
| `src/types/player.ts` | 2 | 2026-06-19 | Type definitions for player state |
| `src/types/network.ts` | 2 | 2026-06-19 | Type definitions for network peers |
| `src/types/store.ts` | 2 | 2026-06-19 | Core RootState type |
| `src/types/workers.ts` | 2 | 2026-06-19 | Type definitions for worker messages |
| `src/types/entities.ts` | 2 | 2026-06-19 | Type definitions for entities |
| `src/types/ship.ts` | 2 | 2026-06-19 | Type definitions for ships |
| `src/types/index.ts` | 2 | 2026-06-19 | Central type export |
| `src/globals.ts` | 3 | 2026-06-19 | Renamed from .js, added TS types |
| `src/worldSeed.ts` | 3 | 2026-06-19 | Renamed from .js, added TS types |
| `src/utils/EventBus.ts` | 3 | 2026-06-19 | Renamed from .js, added TS types |
| `src/utils/NetworkEventBus.ts` | 3 | 2026-06-19 | Renamed from .js, added TS types |
| `src/registry/Registry.ts` | 3 | 2026-06-19 | Renamed from .js, added TS types |
| `src/registry/ItemRegistry.ts` | 3 | 2026-06-19 | Renamed from .js, added TS types |
| `src/registry/BlockRegistry.ts` | 3 | 2026-06-19 | Renamed from .js, added TS types |
| `src/registry/CraftingRegistry.ts` | 3 | 2026-06-19 | Renamed from .js, added TS types |
| `src/types/data.ts` | 4 | 2026-06-19 | Added types for all JSON data models |
| `src/utils/biomes.ts` | 4 | 2026-06-19 | Renamed from .js, added TS types |
| `src/registry/InteractionRegistry.ts` | 4 | 2026-06-19 | Renamed from .js, added TS types |
| `src/registry/SmeltingRegistry.ts` | 4 | 2026-06-19 | Renamed from .js, added TS types |
| `src/registry/QuestsRegistry.ts` | 4 | 2026-06-19 | Created typed wrapper for quests.json |
| `src/registry/SkillsRegistry.ts` | 4 | 2026-06-19 | Created typed wrapper for skills.json |
| `src/registry/LootRegistry.ts` | 4 | 2026-06-19 | Created typed wrapper for loot.json |
