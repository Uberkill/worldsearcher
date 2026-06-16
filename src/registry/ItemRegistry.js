import itemsConfig from '../data/items.json';

export const ItemRegistry = itemsConfig;

const ItemIds = {};
const ItemById = {};
const ItemKeyById = {};

Object.keys(ItemRegistry).forEach((key) => {
  const item = ItemRegistry[key];
  const id = item.id;
  ItemIds[key] = id;
  ItemById[id] = item;
  ItemKeyById[id] = key;
});


