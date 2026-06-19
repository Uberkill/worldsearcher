# TypeScript Migration Tracker

> **Current Stage:** 0 — Migration Infrastructure
> **Status:** IN PROGRESS
> **Started:** 2026-06-19
> **Last Updated:** 2026-06-19
> **Migrated Files:** 0 / ~107

## Progress Overview

| Stage | Name | Status | Files Done | Risk |
|-------|------|--------|------------|------|
| 0 | Migration Infrastructure | 🔵 IN PROGRESS | — | 5% |
| 1 | Pre-Migration Refactoring | ⬜ NOT STARTED | — | 25% |
| 2 | Type Foundation | ⬜ NOT STARTED | — | 10% |
| 3 | Leaf Node Migration | ⬜ NOT STARTED | — | 15% |
| 4 | Data Layer & JSON Typing | ⬜ NOT STARTED | — | 10% |
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
- [ ] Create src/stores/useAudioStore.js (extract audio config from useStore)
- [ ] Update GameAudio.js to import from useAudioStore
- [ ] Update createPlayerSlice.js to remove audio config
- [ ] Verify no circular dep warnings

**1B — Split worldActions.js (3,189 lines → 5 modules):**
- [ ] Create src/stores/worldActions/ directory
- [ ] Move chunk operations → chunkOperations.js
- [ ] Move mesh mounting → meshMounting.js
- [ ] Move fluid simulation → fluidSimulation.js
- [ ] Move GC → garbageCollection.js
- [ ] Move strangler interceptors → stranglerInterceptors.js
- [ ] Create index.js barrel re-export
- [ ] Delete original worldActions.js
- [ ] All tests pass
- [ ] Bump canary tracker

### Stage 2 — Type Foundation
**Goal:** Create src/types/ with shared type definitions. No file renames.

**Files to create:**
- [ ] src/types/blocks.ts
- [ ] src/types/items.ts
- [ ] src/types/world.ts
- [ ] src/types/player.ts
- [ ] src/types/network.ts
- [ ] src/types/store.ts
- [ ] src/types/workers.ts
- [ ] src/types/entities.ts
- [ ] src/types/ship.ts
- [ ] src/types/index.ts

### Stage 3 — Leaf Node Migration
**Goal:** Convert simplest files first. No downstream dependencies.

**Files (in order):**
- [ ] src/globals.js → .ts
- [ ] src/worldSeed.js → .ts
- [ ] src/utils/ — all ~20 files → .ts
- [ ] src/registry/ — all 6 files → .ts

### Stage 4 — Data Layer
- [ ] Create typed loaders for blocks.json, items.json, biomes.json, loot.json
- [ ] Type prefab definitions

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
| — | — | — | Migration not yet started |
