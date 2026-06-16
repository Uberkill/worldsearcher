import * as THREE from 'three';
import {
  BlockRegistry,
  TextureRegistry,
} from '../registry/BlockRegistry';

export const ATLAS_GRID_SIZE = 16;
const ATLAS_TILE_SIZE = 128; // Updated for 128x128 textures

let generatedAtlas = null;

export const getTextureAtlas = () => {
  if (generatedAtlas) return generatedAtlas;

  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_GRID_SIZE * ATLAS_TILE_SIZE;
  canvas.height = ATLAS_GRID_SIZE * ATLAS_TILE_SIZE;
  const ctx = canvas.getContext('2d', {
    willReadFrequently: true,
    alpha: true,
  });

  // Make everything completely transparent initially
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.flipY = false;

  // We loop through TextureRegistry (which are filenames)
  // ID 0 is reserved for 'fallback' air, so we skip it or just handle it gracefully
  TextureRegistry.forEach((filename, id) => {
    if (id === 0) return;

    const tileX = (id % ATLAS_GRID_SIZE) * ATLAS_TILE_SIZE;
    const tileY = Math.floor(id / ATLAS_GRID_SIZE) * ATLAS_TILE_SIZE;

    // Default Fallback Color based on ID hash if image fails to load
    const fallbackHue = (id * 137.5) % 360;

    if (filename.startsWith('color:')) {
      const color = filename.split(':')[1];
      ctx.globalAlpha = 1.0;
      ctx.fillStyle = color;
      ctx.fillRect(tileX, tileY, ATLAS_TILE_SIZE, ATLAS_TILE_SIZE);
      texture.needsUpdate = true;
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      ctx.clearRect(tileX, tileY, ATLAS_TILE_SIZE, ATLAS_TILE_SIZE);
      ctx.drawImage(img, tileX, tileY, ATLAS_TILE_SIZE, ATLAS_TILE_SIZE);
      texture.needsUpdate = true;
    };
    img.onerror = () => {
      // If the user hasn't created the image yet, paint a solid procedural color
      // Try to find the block color this texture belongs to for a better fallback
      let matchedBlockColor = null;
      let matchedOpacity = 1.0;
      for (const [key, block] of Object.entries(BlockRegistry)) {
        if (filename.includes(key)) {
          matchedBlockColor = block.color;
          matchedOpacity = block.opacity !== undefined ? block.opacity : 1.0;
          break;
        }
      }

      ctx.globalAlpha = matchedOpacity;
      ctx.fillStyle = matchedBlockColor || `hsl(${fallbackHue}, 50%, 50%)`;
      ctx.fillRect(tileX, tileY, ATLAS_TILE_SIZE, ATLAS_TILE_SIZE);
      ctx.globalAlpha = 1.0;
      texture.needsUpdate = true;
    };
    // Trigger load from public dir
    img.src = `/textures/blocks/${filename}`;
  });

  generatedAtlas = texture;
  return texture;
};
