# Worldsearch Core
This is the root memory for the `worldsearch` codebase (a custom high-performance voxel engine).
See other memories for specific details:
- `mem:migration/status` - ACTIVE TypeScript migration. Read this FIRST if you are continuing migration work.
- `mem:migration/conventions` - TypeScript type conventions for the migration.
- `mem:migration/completed_files` - Which files have been migrated so far.
- `mem:migration/decisions` - Key migration decisions and rationale.
- `mem:tech_stack` - Language, framework, and tooling context.
- `mem:conventions` - CRITICAL architecture invariants and warnings (performance, rendering, and physics rules).
- `mem:suggested_commands` - Project execution commands.
- `mem:task_completion` - Verification checklist.

The application relies on `useStore` (Zustand) as the core state manager, and uses 3D noise generation decoupled from surface bounds. Avoid breaking "God Nodes" like `useStore` and `getIndex()`. Beware of circular dependencies between Audio and Player slices.