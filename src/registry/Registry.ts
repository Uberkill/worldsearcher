import { BlockRegistry } from './BlockRegistry';
import { ItemRegistry } from './ItemRegistry';
import { BlockDefinition } from '../types/blocks';
import { ItemDefinition } from '../types/items';

export const GlobalRegistry: Record<string, BlockDefinition | ItemDefinition> = { ...BlockRegistry, ...ItemRegistry };
