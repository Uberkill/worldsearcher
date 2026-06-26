interface CombatConfig {
  type: 'hitscan' | 'projectile';
  damage: number;
  cooldownMs: number;
  range?: number;
  speed?: number;
  raycastRadius?: number;
  areaOfEffect?: number;
}

export interface ItemDefinition {
  id: number;
  name: string;
  color: string;
  isTransparent: boolean;
  lightLevel: number;
  type: string;
  combat?: CombatConfig;
}

type ItemRegistryData = Record<string, ItemDefinition>;
