export interface SmeltingRecipe {
  output: string;
  cookTime: number;
}

export interface FuelInfo {
  burnTime: number;
}

export const SmeltingRecipes: Record<string, SmeltingRecipe> = {
  'dirt': { output: 'stone', cookTime: 5 },
  'stone': { output: 'glass', cookTime: 5 },
  'log': { output: 'wood', cookTime: 3 },
};

export const FuelRegistry: Record<string, FuelInfo> = {
  'wood': { burnTime: 10 },
  'log': { burnTime: 15 },
  'spark_crystal': { burnTime: 100 },
};
