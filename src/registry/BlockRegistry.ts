// @ts-nocheck
import blocksConfig from '../data/blocks.json';
import { BlockDefinition } from '../types/blocks';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const validateBlocks = (config: Record<string, any>): Record<string, BlockDefinition> => {
  const result: Record<string, BlockDefinition> = {};
  for (const [key, val] of Object.entries(config)) {
    result[key] = {
      id: typeof val.id === 'number' ? val.id : 0,
      name: typeof val.name === 'string' ? val.name : key,
      color: typeof val.color === 'string' ? val.color : '#ffffff',
      health: typeof val.health === 'number' ? val.health : 100,
      isTransparent: !!val.isTransparent,
      lightLevel: typeof val.lightLevel === 'number' ? val.lightLevel : 0,
      isFlora: !!val.isFlora,
      isPassable: !!val.isPassable,
      isLiquid: !!val.isLiquid,
      opacity: typeof val.opacity === 'number' ? val.opacity : undefined,
      texture: typeof val.texture === 'string' ? val.texture : undefined,
      textures: val.textures,
      damagePerTick: typeof val.damagePerTick === 'number' ? val.damagePerTick : undefined,
      isHidden: typeof val.isHidden === 'boolean' ? val.isHidden : undefined,
    };
  }
  return result;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const BlockRegistry: Record<string, BlockDefinition> = validateBlocks(blocksConfig as Record<string, any>);

export const BlockIds: Record<string, number> = {};
export const BlockById: Record<number, BlockDefinition> = {};
export const BlockKeyById: Record<number, string> = {};

Object.keys(BlockRegistry).forEach((key) => {
  const block = BlockRegistry[key];
  const id = block.id; // Explicit ID loaded from JSON to prevent world corruption
  if (id === undefined || id === null || typeof id !== 'number' || !Number.isInteger(id)) {
    throw new Error(`BlockRegistry Error: Block '${key}' is missing a valid integer 'id' in blocks.json!`);
  }
  if (id < 0 || id > 255) {
    throw new Error(`BlockRegistry Error: Block '${key}' ID ${id} is out of bounds (0-255). It will not fit in the Uint8Array buffers!`);
  }
  BlockIds[key] = id;
  BlockById[id] = block;
  BlockKeyById[id] = key;
});

// --- Texture Atlas Mapping ---
export const TextureRegistry: string[] = [];
const TextureIdByName: Record<string, number> = {};

const registerTexture = (filename?: string): number => {
  if (!filename) return 0;
  if (TextureIdByName[filename] !== undefined) {
    return TextureIdByName[filename];
  }
  const id = TextureRegistry.length;
  TextureRegistry.push(filename);
  TextureIdByName[filename] = id;
  return id;
};

// 0 is reserved for air, so we use empty/fallback for ID 0
registerTexture('fallback');

interface FaceMapping {
  top: number;
  bottom: number;
  side: number;
}

const FaceMappings: Array<FaceMapping | null> = new Array(256)
  .fill(null)
  .map(() => ({ top: 0, bottom: 0, side: 0 }));

Object.keys(BlockRegistry).forEach((key) => {
  const id = BlockIds[key];
  const conf = blocksConfig[key];
  if (conf) {
    if (conf.texture) {
      const tex = registerTexture(conf.texture);
      FaceMappings[id] = { top: tex, bottom: tex, side: tex };
    } else if (conf.textures) {
      FaceMappings[id] = {
        top: registerTexture(conf.textures.top),
        bottom: registerTexture(conf.textures.bottom),
        side: registerTexture(conf.textures.side),
      };
    } else {
      const fallbackColor = conf.color || '#ffffff';
      const tex = registerTexture(`color:${fallbackColor}`);
      FaceMappings[id] = { top: tex, bottom: tex, side: tex };
    }
  }
});

// --- Binary Lookups for Worker Optimization ---
const SolidLookup = new Uint8Array(256);
const FluidLookup = new Uint8Array(256);
const TextureLookup = new Uint16Array(256 * 3);
const FloraLookup = new Uint8Array(256);
const TransparentLookup = new Uint8Array(256);

Object.keys(BlockRegistry).forEach((key) => {
  const id = BlockIds[key];
  const conf = blocksConfig[key];
  if (conf) {
    SolidLookup[id] = conf.isTransparent ? 0 : 1;
    FluidLookup[id] = conf.isLiquid ? 1 : 0;
    FloraLookup[id] = conf.isFlora ? 1 : 0;
    TransparentLookup[id] = conf.isTransparent ? 1 : 0;
    
    if (FaceMappings[id]) {
      TextureLookup[id * 3 + 0] = FaceMappings[id].top;
      TextureLookup[id * 3 + 1] = FaceMappings[id].bottom;
      TextureLookup[id * 3 + 2] = FaceMappings[id].side;
    } else {
      TextureLookup[id * 3 + 0] = id;
      TextureLookup[id * 3 + 1] = id;
      TextureLookup[id * 3 + 2] = id;
    }
  }
});

SolidLookup[0] = 0; // Air is transparent
FluidLookup[0] = 0; // Air is not liquid
FloraLookup[0] = 0; // Air is not flora
TransparentLookup[0] = 1; // Air is transparent

export const getBinaryRegistries = () => ({
  solidBuffer: SolidLookup.buffer,
  fluidBuffer: FluidLookup.buffer,
  textureBuffer: TextureLookup.buffer,
  floraBuffer: FloraLookup.buffer,
  transparentBuffer: TransparentLookup.buffer
});

