// @ts-nocheck
import { BlockRegistry } from './BlockRegistry';
import { ItemRegistry } from './ItemRegistry';
import { BlockDefinition } from '../types/blocks';
import { ItemDefinition } from '../types/items';

export const GlobalRegistry: Record<string, BlockDefinition | ItemDefinition> = {};

Object.keys(BlockRegistry).forEach(key => {
  GlobalRegistry[key] = BlockRegistry[key];
});

Object.keys(ItemRegistry).forEach(key => {
  if (GlobalRegistry[key]) {
    console.warn(`GlobalRegistry Error: Item key '${key}' overwrites an existing Block definition!`);
  }
  GlobalRegistry[key] = ItemRegistry[key];
});

