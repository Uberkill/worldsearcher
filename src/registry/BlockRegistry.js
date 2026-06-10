import blocksConfig from '../data/blocks.json';

export const BlockRegistry = blocksConfig;

export const getBlockKeys = () => Object.keys(BlockRegistry);

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
export const TextureIdByName = {};

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

export const FaceMappings = new Array(256)
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
