import { BlockRegistry } from './BlockRegistry';
import { ItemRegistry } from './ItemRegistry';

export const GlobalRegistry = { ...BlockRegistry, ...ItemRegistry };

