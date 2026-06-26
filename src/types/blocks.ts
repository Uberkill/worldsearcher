interface BlockTextures {
  top: string;
  side: string;
  bottom: string;
}

export interface BlockDefinition {
  id: number;
  name: string;
  color: string;
  health: number;
  isTransparent: boolean;
  lightLevel: number;
  isFlora: boolean;
  isPassable: boolean;
  isLiquid: boolean;
  opacity?: number;
  texture?: string;
  textures?: BlockTextures;
  damagePerTick?: number;
  isHidden?: boolean;
}

type BlockRegistryData = Record<string, BlockDefinition>;
