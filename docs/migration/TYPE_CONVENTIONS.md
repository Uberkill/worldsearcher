# TypeScript Migration — Type Conventions

> Follow these conventions EXACTLY. Do not invent new patterns.

## Where Types Live

All shared types go in `src/types/`. DO NOT define types inline in source files unless they are truly local to that file.

```
src/types/
├── blocks.ts       ← Block IDs, definitions, ECS bitfield
├── items.ts        ← Items, weapons, crafting
├── world.ts        ← Chunks, voxels, coordinates
├── player.ts       ← Player state, inventory, game modes
├── network.ts      ← Network packets (discriminated unions)
├── store.ts        ← Zustand slice interfaces
├── workers.ts      ← Worker message types (discriminated unions)
├── entities.ts     ← Enemies, swarms, projectiles
├── ship.ts         ← Ship state, physics
└── index.ts        ← Barrel re-export
```

## Import Pattern

ALWAYS use `import type` for type-only imports:

```typescript
// ✅ CORRECT
import type { BlockID, ChunkCoord } from '../types';
import type { PlayerSlice } from '../types/store';

// ❌ WRONG — creates runtime import
import { BlockID, ChunkCoord } from '../types';
```

If you need BOTH a value and a type from the same module:

```typescript
import { someFunction } from '../utils/helpers';
import type { SomeType } from '../utils/helpers';
```

## Naming Conventions

| Category | Pattern | Example |
|----------|---------|---------|
| Interfaces (object shapes) | PascalCase, descriptive noun | `PlayerState`, `ChunkData`, `InventorySlot` |
| Type aliases | PascalCase | `GameMode`, `BlockID` |
| Discriminated unions | PascalCase + literal `type` field | `NetworkPacket`, `WorkerMessage` |
| Branded types | PascalCase + `__brand` | `type BlockID = number & { __brand: 'BlockID' }` |
| Component props | `ComponentNameProps` | `TitleScreenProps`, `HealthBarProps` |
| Store slice interfaces | `SliceNameSlice` | `PlayerSlice`, `EntitySlice` |
| Enum-like constants | `as const` objects (NOT TypeScript `enum`) | `const GameModes = { ... } as const` |
| Function types | PascalCase + descriptive | `type OnBlockPlace = (coord: ChunkCoord, id: BlockID) => void` |
| Generic parameters | Single uppercase letter | `T`, `K`, `V` |

## Pattern: Discriminated Unions (for messages/packets)

Used for worker messages and network packets:

```typescript
// Worker messages
type WorkerMessage =
  | { type: 'GENERATE_CHUNK'; payload: ChunkGenerationJob }
  | { type: 'BUILD_MESH'; payload: MeshJob }
  | { type: 'COMPUTE_LIGHTING'; payload: LightingJob }

// Usage:
function handleMessage(msg: WorkerMessage) {
  switch (msg.type) {
    case 'GENERATE_CHUNK':
      // msg.payload is typed as ChunkGenerationJob here
      break;
    case 'BUILD_MESH':
      // msg.payload is typed as MeshJob here
      break;
  }
}
```

## Pattern: Branded Types (for IDs and constrained numbers)

Prevents accidentally passing a raw number where a specific ID is expected:

```typescript
type BlockID = number & { __brand: 'BlockID' };
type ChunkX = number & { __brand: 'ChunkX' };

// Creation helper:
function toBlockID(n: number): BlockID { return n as BlockID; }
```

## Pattern: Zustand Store Typing

```typescript
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { PlayerSlice } from '../types/store';

const usePlayerStore = create<PlayerSlice>()(
  subscribeWithSelector((set, get) => ({
    health: 100,
    takeDamage: (amount: number) => set((s) => ({ health: s.health - amount })),
  }))
);
```

## Pattern: React Component Props

```typescript
interface HealthBarProps {
  current: number;
  max: number;
  showLabel?: boolean;
}

export function HealthBar({ current, max, showLabel = true }: HealthBarProps) {
  // ...
}
```

## Pattern: Web Worker postMessage

```typescript
// In the worker file:
self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'GENERATE_CHUNK':
      const result = generateChunk(msg.payload);
      self.postMessage({ type: 'CHUNK_READY', payload: result } satisfies WorkerResult);
      break;
  }
};
```

## Anti-Patterns (NEVER DO)

| ❌ Don't | ✅ Do Instead |
|----------|---------------|
| `any` everywhere | `unknown` + type guards, or proper types |
| `as any` to silence errors | Fix the actual type mismatch |
| TypeScript `enum` | `as const` objects (zero runtime cost) |
| `// @ts-ignore` | Fix the type error or use `// @ts-expect-error` with explanation |
| Inline type definitions in large files | Put in `src/types/` and import |
| `Function` type | Specific function signature: `(x: number) => void` |
| `object` type | Specific interface: `{ key: string; value: number }` |
| `String`, `Number`, `Boolean` | Lowercase: `string`, `number`, `boolean` |
