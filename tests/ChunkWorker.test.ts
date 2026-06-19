import { describe, it, expect } from 'vitest';
import { getIndex, setBlock, getTextureId } from '../src/utils/chunkData';

describe('Chunk Data Bitpacking', () => {
  it('getIndex calculates correct 1D array index for 16x288x16 chunk', () => {
    // CHUNK_Y_MIN is -32
    // getIndex = (y - (-32)) * 256 + lz * 16 + lx
    expect(getIndex(0, 0, 0)).toBe(32 * 256);

    const maxIndex = (255 + 32) * 256 + 15 * 16 + 15;
    expect(getIndex(15, 255, 15)).toBe(maxIndex);
  });

  it('setBlock packs texture IDs correctly into 32-bit integers', () => {
    const buffer = new Uint32Array(16 * 256 * 16);
    const index = getIndex(5, 50, 5);
    
    // Test with texture ID 255
    setBlock(buffer, index, 255);
    expect(getTextureId(buffer[index])).toBe(255);

    // Test with texture ID 1
    setBlock(buffer, index, 1);
    expect(getTextureId(buffer[index])).toBe(1);
  });
});
