# AGENT BRIEFING — TypeScript Migration

> **READ THIS ENTIRE FILE BEFORE DOING ANYTHING.**
> If you skip this file, you WILL break the codebase.

## What Is This Project?

Worldsearchyou is a **voxel game engine** (like Minecraft) running in the browser.
It uses React 19, Three.js, Zustand, Web Workers, and Vite 8.
It has ~107 source files and ~20,000 lines of JavaScript.
We are converting it from JavaScript to TypeScript, file by file.

## Where Are You In The Migration?

**STEP 1:** Read the file `docs/migration/MIGRATION_TRACKER.md`
It tells you the CURRENT STAGE and which files are DONE.

**STEP 2:** Read the Serena memory `migration/status`
Run: `read_memory` with topic `migration/status`
This gives you the latest status in terse format.

**STEP 3:** Read the implementation plan
The full 14-stage plan is in `docs/migration/MIGRATION_TRACKER.md` under "Stage Details".

## CRITICAL RULES — READ ALL OF THESE

### 🛑 RULE 1: ONE FILE AT A TIME
- Convert ONE .js file to .ts at a time
- Run `npm run typecheck` AFTER each file
- Run `npm run test:unit` AFTER each file
- COMMIT after each file with message: `chore(ts): migrate <filename>.js → .ts`
- If typecheck fails, FIX THE ERRORS before moving to the next file
- NEVER rename multiple files at once

### 🛑 RULE 2: NEVER CHANGE LOGIC DURING MIGRATION
- You are ONLY adding types and renaming files
- Do NOT fix bugs you find
- Do NOT refactor code you find
- Do NOT "improve" anything
- If you find a bug, write it in `docs/migration/DECISIONS.md` and move on
- The ONLY exception: if a type error reveals a genuine crash bug, fix the minimum needed

### 🛑 RULE 3: NEVER USE `any` WITHOUT A TODO COMMENT
- If you must use `any`, always add: `// TODO(ts-migration): Replace with proper type`
- Prefer `unknown` over `any` when possible
- NEVER use `any` just because you are lazy or confused

### 🛑 RULE 4: FOLLOW THE STAGE ORDER
- Stages MUST be done in order: 0 → 1 → 2 → 3 → ... → 14
- Within each stage, follow the listed file order
- DO NOT skip stages
- DO NOT jump ahead

### 🛑 RULE 5: UPDATE DOCUMENTATION AFTER EVERY STAGE
After completing a stage:
1. Update `docs/migration/MIGRATION_TRACKER.md` — mark stage complete, list files done
2. Update `docs/migration/STAGE_LOG.md` — add timestamp and notes
3. Update Serena memory `migration/status` — update current stage
4. Update Serena memory `migration/completed_files` — add migrated files

### 🛑 RULE 6: PRESERVE ALL EXISTING COMMENTS AND DOCSTRINGS
- Do NOT delete comments
- Do NOT rewrite comments
- Do NOT "clean up" comments
- Only ADD type annotations

### 🛑 RULE 7: READ AI_AGENT_WARNINGS.md BEFORE TOUCHING ANY ENGINE CODE
- File: `docs/core/AI_AGENT_WARNINGS.md`
- Contains 9 strict rules that WILL break the game if violated
- Most important: NEVER put high-volume geometry in React tree, NEVER run RLE on main thread

### 🛑 RULE 8: VERIFY THE GAME STILL WORKS
After finishing any stage, run:
```bash
npm run dev
```
Open the browser. The game MUST load. If it doesn't, you broke something. REVERT.

### 🛑 RULE 9: IMPORT TYPES CORRECTLY
When adding type imports, use:
```typescript
import type { BlockID, ChunkCoord } from '../types';
```
NOT:
```typescript
import { BlockID, ChunkCoord } from '../types';
```
The `type` keyword ensures types are erased at build time and don't create circular dependencies.

### 🛑 RULE 10: DO NOT MODIFY THESE FILES WITHOUT EXPLICIT USER PERMISSION
- `src/utils/greedyMesh.js` — performance-critical hot path
- `src/utils/lighting.js` — performance-critical hot path
- `src/workers/chunkWorker.js` — runs in Web Worker
- `src/stores/worldActions/` — recently split, fragile
- `index.html` — only change the script src when migrating main.jsx → main.tsx

## How To Migrate A Single File

Follow this EXACT sequence for every file:

```
STEP 1: Read the file
        → Use read_file or view_file to see current content

STEP 2: Check what imports it
        → Use find_referencing_symbols (Serena) or grep for the filename
        → Note all files that import from this file

STEP 3: Rename the file
        → Use: git mv src/path/file.js src/path/file.ts
        → For JSX files: git mv src/path/file.jsx src/path/file.tsx

STEP 4: Add type imports at the top
        → import type { ... } from '../types';

STEP 5: Add type annotations to exports
        → function parameters: (x: number, y: string)
        → function returns: (): ReturnType
        → constants: const NAME: Type = value

STEP 6: Run typecheck
        → npm run typecheck
        → If errors: fix them in THIS file only
        → If errors are in OTHER files: those files need updating too

STEP 7: Run tests
        → npm run test:unit

STEP 8: Commit
        → git add -A && git commit -m "chore(ts): migrate <filename>"
```

## How To Use Serena

Serena is an MCP tool server. You MUST activate the project first:

```
1. Call: activate_project with path "C:\Users\oob\.gemini\antigravity\scratch\Worldsearchyou"
2. Then use Serena tools normally
```

**Most useful Serena tools for migration:**

| Tool | When To Use |
|------|-------------|
| `find_referencing_symbols` | Before renaming a file — find all consumers |
| `get_diagnostics_for_file` | After renaming — check for TS errors |
| `replace_content` | Add type annotations to a file |
| `get_symbols_overview` | Understand what a file exports |
| `execute_shell_command` | Run npm commands |
| `read_memory` | Check migration status |
| `write_memory` / `edit_memory` | Update migration status |
| `search_for_pattern` | Find patterns across codebase |

## Error Recovery

### "Cannot find module" error after renaming
- Vite resolves .ts automatically. Check that you renamed correctly.
- If another file imports with explicit `.js` extension, update that import.

### "Type X is not assignable to type Y"
- Read the error carefully. It tells you exactly which types don't match.
- Check `src/types/` for the correct type definition.
- If the type doesn't exist yet, check if the current stage requires creating it.

### "npm run dev" shows blank page
- Check browser console (F12) for errors
- Most likely: a file import path is broken
- Run `git diff` to see what changed
- Run `git stash` to temporarily undo, verify game works, then `git stash pop`

### Everything is broken and you don't know why
- Run: `git log --oneline -10` to see recent commits
- Run: `git revert HEAD` to undo the last commit
- Start that file's migration over

## File Locations Reference

| What | Path |
|------|------|
| Project root | `C:\Users\oob\.gemini\antigravity\scratch\Worldsearchyou` |
| Source code | `src/` |
| Type definitions | `src/types/` |
| Zustand stores | `src/stores/` |
| Web Workers | `src/workers/` |
| Utilities | `src/utils/` |
| React components | `src/components/` |
| Hooks | `src/hooks/` |
| Tests | `tests/` and `e2e/` |
| Documentation | `docs/` |
| Migration docs | `docs/migration/` |
| AI warnings | `docs/core/AI_AGENT_WARNINGS.md` |
| Canary tracker | `docs/canary_tracker.json` |
| Serena memories | `.serena/memories/` |
| TypeScript config | `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json` |

## Type Convention Summary

See `docs/migration/TYPE_CONVENTIONS.md` for full details. Quick reference:

- Types live in `src/types/`
- Use `import type { }` for type-only imports
- Interfaces for object shapes: `interface PlayerState { ... }`
- Discriminated unions for messages: `type Packet = { type: 'A'; ... } | { type: 'B'; ... }`
- Branded types for IDs: `type BlockID = number & { __brand: 'BlockID' }`
- `React.FC<Props>` for functional components (or typed function signature)
- Zustand: `create<StoreType>()(...)` with typed slice interfaces
