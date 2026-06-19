# Completed Files (Migrated to .ts)

## Stage 2: Type Foundation
- src/types/blocks.ts
- src/types/items.ts
- src/types/world.ts
- src/types/player.ts
- src/types/network.ts
- src/types/store.ts
- src/types/workers.ts
- src/types/entities.ts
- src/types/ship.ts
- src/types/index.ts

## Stage 3: Leaf Node Migration
- src/globals.ts
- src/worldSeed.ts
- src/utils/EventBus.ts
- src/utils/NetworkEventBus.ts
- src/registry/Registry.ts
- src/registry/ItemRegistry.ts
- src/registry/BlockRegistry.ts
- src/registry/CraftingRegistry.ts

## Stage 4: Data Layer
- src/types/data.ts
- src/utils/biomes.ts
- src/registry/InteractionRegistry.ts
- src/registry/SmeltingRegistry.ts
- src/registry/QuestsRegistry.ts
- src/registry/SkillsRegistry.ts
- src/registry/LootRegistry.ts

*(Note: Stage 1 involved JS refactoring, so files weren't renamed to .ts yet, but `worldActions.js` was split and `useAudioStore.js` created)*