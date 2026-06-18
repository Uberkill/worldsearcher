# Worldsearch Core
This is the root memory for the `worldsearch` codebase (a custom high-performance voxel engine).
See other memories for specific details:
- `mem:tech_stack` - Language, framework, and tooling context.
- `mem:conventions` - CRITICAL architecture invariants and warnings (performance, rendering, and physics rules).
- `mem:suggested_commands` - Project execution commands.
- `mem:task_completion` - Verification checklist.

The application relies on `useStore` (Zustand) as the core state manager, and uses 3D noise generation decoupled from surface bounds. Avoid breaking "God Nodes" like `useStore` and `getIndex()`. Beware of circular dependencies between Audio and Player slices.