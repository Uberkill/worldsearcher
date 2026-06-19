# TS Migration Conventions

- Types live in `src/types/`, import via `import type { X } from '../types'`
- Use `import type` for type-only imports (prevents circular deps)
- Interfaces for object shapes: `interface PlayerState { ... }`
- Discriminated unions for messages: `type Packet = { type: 'A' } | { type: 'B' }`
- Branded types for IDs: `type BlockID = number & { __brand: 'BlockID' }`
- React props: `interface ComponentProps { ... }`
- Zustand: `create<SliceType>()(...)` with typed interfaces
- NO TypeScript `enum` — use `as const` objects
- NO `any` without `// TODO(ts-migration)` comment
- NO `// @ts-ignore` — use `// @ts-expect-error` with explanation
- Full details: `docs/migration/TYPE_CONVENTIONS.md`