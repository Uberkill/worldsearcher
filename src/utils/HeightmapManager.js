import * as THREE from 'three';
import { useStore } from '../stores/useStore';
import { CHUNK_Y_MIN, CHUNK_Y_MAX, getIndex, getTextureId } from './chunkData';

class HeightmapManager {
  constructor() {
    this.textureSize = 64; // 64x64 blocks = 4x4 chunks. Covers the 40x40 weather box perfectly.
    this.data = new Uint8Array(this.textureSize * this.textureSize);
    
    // NearestFilter is CRITICAL to prevent bilinear interpolation smoothing between mountain peaks and caves!
    this.texture = new THREE.DataTexture(this.data, this.textureSize, this.textureSize, THREE.RedFormat);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    
    this.bounds = new THREE.Vector4(0, 0, this.textureSize, this.textureSize); // minX, minZ, width, depth
    
    this.lastPlayerCx = -999;
    this.lastPlayerCz = -999;
    this.isDirty = true;
  }

  update(playerPos, chunks) {
    const cx = Math.floor(playerPos[0] / 16);
    const cz = Math.floor(playerPos[2] / 16);

    // If player hasn't moved 16 blocks (1 chunk), we don't necessarily need to shift the grid.
    // But for safety and to keep the player roughly centered in the 64x64 map, we update when they cross a 16-block boundary.
    if (cx !== this.lastPlayerCx || cz !== this.lastPlayerCz) {
      this.lastPlayerCx = cx;
      this.lastPlayerCz = cz;
      
      // Center the 64x64 map around the player's current chunk
      // Map covers (cx - 1) to (cx + 2) chunks = 4 chunks = 64 blocks
      const minX = (cx - 1) * 16;
      const minZ = (cz - 1) * 16;
      this.bounds.set(minX, minZ, this.textureSize, this.textureSize);
      this.isDirty = true;
    }

    if (!this.isDirty) return;

    // Scan the 64x64 area!
    const minX = this.bounds.x;
    const minZ = this.bounds.y;

    for (let x = 0; x < this.textureSize; x++) {
      for (let z = 0; z < this.textureSize; z++) {
        const worldX = minX + x;
        const worldZ = minZ + z;
        
        const chunkCx = Math.floor(worldX / 16);
        const chunkCz = Math.floor(worldZ / 16);
        const chunk = chunks[`${chunkCx},${chunkCz}`];

        let topY = 0; // Absolute bottom

        if (chunk && chunk.buffer) {
          const lx = ((worldX % 16) + 16) % 16;
          const lz = ((worldZ % 16) + 16) % 16;

          // Scan from top of the world down to find highest non-air block
          for (let y = CHUNK_Y_MAX; y >= CHUNK_Y_MIN; y--) {
            const val = chunk.buffer[getIndex(lx, y, lz)];
            if (val !== 0 && getTextureId(val) !== 0) {
              // Found a solid block!
              topY = y + 1; // Rain hits the TOP of this block
              break;
            }
          }
        }
        
        // Write to texture (Red channel)
        // Normalize 0-256 height to 0-255 uint8
        // Assuming max world height is 256. 
        const normalized = Math.min(255, Math.max(0, topY));
        const index = x + z * this.textureSize; // 2D flat array
        this.data[index] = normalized;
      }
    }

    this.texture.needsUpdate = true;
    this.isDirty = false;
  }
}

export const heightmapManager = new HeightmapManager();
