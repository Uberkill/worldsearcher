/* eslint-disable */
import {
  BlockRegistry,
  BlockIds,
  FaceMappings,
  TextureRegistry,
} from './src/registry/BlockRegistry.js';

const grassId = BlockIds['tall_grass'];
console.log('Tall Grass ID:', grassId);
const faceMapping = FaceMappings[grassId];
console.log('FaceMapping for Tall Grass:', faceMapping);
console.log('Texture Array Index:', faceMapping.top);
console.log(
  'Texture filename at that index:',
  TextureRegistry[faceMapping.top]
);

const vTexId = faceMapping.top;
const tileX = vTexId % 16;
const tileY = Math.floor(vTexId / 16);
console.log('Shader tileX:', tileX, 'tileY:', tileY);
