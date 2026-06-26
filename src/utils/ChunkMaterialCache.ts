// @ts-nocheck
import { getTextureAtlas } from './TextureAtlas';
import { createChunkMaterial } from '../materials/ChunkMaterial';

export const materialCache = new Map();

export const initMaterials = () => {
  if (!materialCache.has('solid')) {
    materialCache.set('solid', createChunkMaterial(getTextureAtlas(), false));
    materialCache.set('transparent', createChunkMaterial(getTextureAtlas(), true));
    materialCache.set('flora', createChunkMaterial(getTextureAtlas(), true));
  }
};
