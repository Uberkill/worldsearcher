# Migration Decisions (terse)

1. Incremental bottom-up, NOT big-bang
2. Split worldActions.js (3189 lines) BEFORE typing
3. Fix GameAudio circular dep BEFORE typing
4. Full .ts everywhere (not JSDoc)
5. strict:false now → strict:true at Stage 13
6. Use `import type` for all type-only imports
7. Branded types for IDs (BlockID, ChunkX)
8. Discriminated unions for worker/network messages
9. One file at a time, commit after each
10. NO logic changes during migration

Full rationale: `docs/migration/DECISIONS.md`