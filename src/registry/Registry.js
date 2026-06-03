import { BlockRegistry } from './BlockRegistry';
import { ItemRegistry } from './ItemRegistry';

export const GlobalRegistry = { ...BlockRegistry, ...ItemRegistry };

export const getDef = (key) => GlobalRegistry[key];

export const getRegistryName = (key) => getDef(key)?.name || key;
export const getRegistryColor = (key) => getDef(key)?.color || '#ffffff';
