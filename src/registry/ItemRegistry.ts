import itemsConfig from '../data/items.json';
import { ItemDefinition } from '../types/items';

export const ItemRegistry: Record<string, ItemDefinition> = itemsConfig as Record<string, ItemDefinition>;

export const ItemIds: Record<string, number> = {};
export const ItemById: Record<number, ItemDefinition> = {};
export const ItemKeyById: Record<number, string> = {};

Object.keys(ItemRegistry).forEach((key) => {
  const item = ItemRegistry[key];
  const id = item.id;
  ItemIds[key] = id;
  ItemById[id] = item;
  ItemKeyById[id] = key;
});
