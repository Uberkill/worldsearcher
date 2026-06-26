// @ts-nocheck
import itemsConfig from '../data/items.json';
import { ItemDefinition } from '../types/items';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const validateItems = (config: Record<string, any>): Record<string, ItemDefinition> => {
  const result: Record<string, ItemDefinition> = {};
  for (const [key, val] of Object.entries(config)) {
    result[key] = {
      id: typeof val.id === 'number' ? val.id : 0,
      name: typeof val.name === 'string' ? val.name : key,
      color: typeof val.color === 'string' ? val.color : '#ffffff',
      isTransparent: !!val.isTransparent,
      lightLevel: typeof val.lightLevel === 'number' ? val.lightLevel : 0,
      type: typeof val.type === 'string' ? val.type : 'item',
      combat: val.combat ? {
        type: typeof val.combat.type === 'string' ? val.combat.type : 'hitscan',
        damage: typeof val.combat.damage === 'number' ? val.combat.damage : 0,
        cooldownMs: typeof val.combat.cooldownMs === 'number' ? val.combat.cooldownMs : 1000,
        range: typeof val.combat.range === 'number' ? val.combat.range : undefined,
        speed: typeof val.combat.speed === 'number' ? val.combat.speed : undefined,
        raycastRadius: typeof val.combat.raycastRadius === 'number' ? val.combat.raycastRadius : undefined,
        areaOfEffect: typeof val.combat.areaOfEffect === 'number' ? val.combat.areaOfEffect : undefined,
      } : undefined,
    };
  }
  return result;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ItemRegistry: Record<string, ItemDefinition> = validateItems(itemsConfig as Record<string, any>);
