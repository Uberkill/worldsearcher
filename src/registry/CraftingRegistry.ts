// @ts-nocheck
export interface CraftingOutput {
  texture: string;
  count: number;
}

interface CraftingRecipe {
  shapeless?: boolean;
  shape?: (string | null)[][];
  input?: string[];
  output: CraftingOutput;
}

const CraftingRecipes: CraftingRecipe[] = [
  {
    shapeless: true,
    input: ['log'],
    output: { texture: 'wood', count: 4 },
  },
  {
    shapeless: true,
    input: ['wood', 'stone'],
    output: { texture: 'flare', count: 4 },
  },
  {
    shape: [
      ['wood', 'wood'],
      ['wood', 'wood'],
    ],
    output: { texture: 'crafting_table', count: 1 },
  },
  {
    shape: [
      ['sand', 'sand'],
      ['sand', 'sand'],
    ],
    output: { texture: 'glass', count: 1 },
  },
  {
    shape: [
      ['stone', 'stone'],
      ['stone', 'stone'],
    ],
    output: { texture: 'tnt', count: 1 },
  },
  {
    shape: [['wood'], ['wood'], ['stone']],
    output: { texture: 'sword', count: 1 },
  },
  {
    shape: [
      ['stone', 'stone', 'stone'],
      [null, 'wood', null],
      [null, 'wood', null],
    ],
    output: { texture: 'pickaxe', count: 1 },
  },
  {
    shapeless: true,
    input: ['spark_node', 'stone', 'stone'],
    output: { texture: 'void_canister', count: 1 },
  },
  {
    shape: [
      ['ship_hull', 'spark_node', 'ship_hull'],
      ['ship_hull', 'spark_node', 'ship_hull'],
    ],
    output: { texture: 'warp_drive_engine', count: 1 },
  },
  {
    shape: [
      ['crystal', 'spark_node', 'crystal'],
    ],
    output: { texture: 'warp_capacitor', count: 1 },
  },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const matchRecipe = (grid: any[]): CraftingOutput | null => {
  const is3x3 = grid.length === 9;
  const gridWidth = is3x3 ? 3 : 2;
  const gridHeight = is3x3 ? 3 : 2;

  const inputTextures = grid.map((slot) => (slot ? slot.texture : null));

  for (const recipe of CraftingRecipes) {
    if (recipe.shapeless) {
      const provided = inputTextures.filter(Boolean);
      const needed = [...recipe.input];
      if (needed.length !== provided.length) continue;

      let matched = true;
      for (const req of needed) {
        const idx = provided.indexOf(req);
        if (idx !== -1) provided.splice(idx, 1);
        else {
          matched = false;
          break;
        }
      }
      if (matched && provided.length === 0) return recipe.output;
    } else if (recipe.shape) {
      const rWidth = recipe.shape[0].length;
      const rHeight = recipe.shape.length;

      if (rWidth > gridWidth || rHeight > gridHeight) continue;

      let matched = false;
      for (let dx = 0; dx <= gridWidth - rWidth; dx++) {
        for (let dy = 0; dy <= gridHeight - rHeight; dy++) {
          if (
            checkShapeMatch(
              inputTextures,
              gridWidth,
              gridHeight,
              recipe.shape,
              dx,
              dy
            )
          ) {
            matched = true;
            break;
          }
        }
        if (matched) break;
      }
      if (matched) return recipe.output;
    }
  }
  return null;
};

function checkShapeMatch(inputTextures, gridWidth, gridHeight, shape, dx, dy) {
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const item = inputTextures[y * gridWidth + x];

      const inShapeX = x >= dx && x < dx + shape[0].length;
      const inShapeY = y >= dy && y < dy + shape.length;

      if (inShapeX && inShapeY) {
        const shapeItem = shape[y - dy][x - dx];
        if (shapeItem !== item) return false;
      } else {
        if (item !== null) return false; // Extra items outside shape ruin the match
      }
    }
  }
  return true;
}

