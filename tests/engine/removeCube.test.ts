import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../../src/stores/useStore';
import { useChunkStore } from '../../src/stores/chunkSlice';
import { setBlock, getIndex } from '../../src/utils/chunkData';

describe('removeCube', () => {
  beforeEach(() => {
    useChunkStore.setState({ chunks: {} });
  });

  it('removes a cube correctly', () => {
    const chunkKey = '0,0';
    const buffer = new Uint32Array(16 * 288 * 16);
    // Set a block at 0, 10, 0
    const idx = getIndex(0, 10, 0);
    setBlock(buffer, idx, 1, 100, false);
    
    useChunkStore.setState({
      chunks: {
        [chunkKey]: {
          buffer,
          isModified: false,
          rebuildId: 1
        }
      }
    });

    const state = useStore.getState();
    expect(useChunkStore.getState().chunks[chunkKey].rebuildId).toBe(1);
    
    // Remove the cube
    state.removeCube(0, 10, 0);
    
    // Check if the store is updated
    const newChunk = useChunkStore.getState().chunks[chunkKey];
    expect(newChunk).toBeDefined();
    expect(newChunk.rebuildId).toBe(2);
    expect(newChunk.isModified).toBe(true);
    expect(newChunk.buffer[idx] & 0xff).toBe(0); // Should be air
  });
});
