# TypeScript Migration — Decision Log

> Every non-obvious decision is recorded here so future agents understand WHY, not just WHAT.

## Decision 1: Incremental Bottom-Up Migration (not Big-Bang)

**Date:** 2026-06-19
**Context:** Project has ~107 JS files, ~20K LOC, complex state management, multiplayer networking.
**Decision:** Migrate file-by-file, bottom-up (utilities → stores → components), keeping the build green at every commit.
**Rationale:** Big-bang would produce thousands of simultaneous TS errors. With a monolithic god store (`useStore`, 106 edges), it's impossible to type everything at once. Incremental lets us verify each file before moving on.
**Risk if reversed:** Thousands of simultaneous errors, impossible to debug. Build stays broken for days.

## Decision 2: Split worldActions.js BEFORE Typing

**Date:** 2026-06-19
**Context:** `worldActions.js` is 3,189 lines — the largest file, doing chunk CRUD, mesh mounting, fluid sim, GC, and strangler interceptors.
**Decision:** Split into 5 sub-modules as a pure JS refactor, then type each module independently.
**Rationale:** Typing a 3,189-line file is the #1 corruption risk. Splitting first means each sub-module is independently typeable and revertible.

## Decision 3: Fix Circular Dependency Before Migration

**Date:** 2026-06-19
**Context:** `GameAudio.js → useStore.js → createPlayerSlice.js → GameAudio.js` import cycle.
**Decision:** Extract audio config into `useAudioStore.js` to break the cycle.
**Rationale:** TypeScript's compiler will hard-error on this cycle. Fixing it in JS first is simpler and less risky.

## Decision 4: Full .ts Everywhere (Not JSDoc)

**Date:** 2026-06-19
**Context:** Could use JSDoc type annotations in .js files instead of renaming to .ts.
**Decision:** Full .ts conversion for all files.
**Rationale:** User wants pipeline sturdiness — knowing exactly WHY things fail. Full .ts gives stricter enforcement than JSDoc. Also aligns with ecosystem direction (React, Three.js, Zustand all ship TS-first).

## Decision 5: strict: true Enabled LAST (Stage 13)

**Date:** 2026-06-19
**Context:** `strict: true` enables 7 compiler flags that catch real bugs.
**Decision:** Start with `strict: false`, enable `strict: true` only after ALL files are .ts.
**Rationale:** Enabling strict on day 1 produces thousands of errors across 107 files. Unusable. Better to get everything compiling first, then tighten.

## Decision 6: Use `import type` for All Type-Only Imports

**Date:** 2026-06-19
**Context:** TypeScript allows importing types with `import { Type }` or `import type { Type }`.
**Decision:** Always use `import type { }` for type-only imports.
**Rationale:** Prevents types from creating runtime imports (which can trigger circular dependency issues). Also makes it explicit which imports are types vs values.

---

## Bugs Found During Migration

_(Record bugs found but NOT fixed during migration. Fix them AFTER migration is complete.)_

| Bug | Found In | Stage | Severity | Notes |
|-----|----------|-------|----------|-------|
| — | — | — | — | None found yet |
