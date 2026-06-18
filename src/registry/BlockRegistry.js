import blocksConfig from '../data/blocks.json';

export const BlockRegistry = blocksConfig;

export const BlockIds = {};
export const BlockById = {};
export const BlockKeyById = {};

Object.keys(BlockRegistry).forEach((key) => {
  const block = BlockRegistry[key];
  const id = block.id; // Explicit ID loaded from JSON to prevent world corruption
  BlockIds[key] = id;
  BlockById[id] = block;
  BlockKeyById[id] = key;
});

// --- Texture Atlas Mapping ---
export const TextureRegistry = [];
const TextureIdByName = {};

const registerTexture = (filename) => {
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

const FaceMappings = new Array(256)
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
