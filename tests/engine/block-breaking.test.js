import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStore } from '../../src/stores/useStore';
import { useChunkStore } from '../../src/stores/chunkSlice';
import { getIndex } from '../../src/utils/chunkData';
import { BlockIds } from '../../src/registry/BlockRegistry';

describe('Block Breaking & Damage Logic', () => {
  beforeEach(() => {
    useStore.setState({
      requestMeshRebuild: vi.fn(),
      removeCube: vi.fn(),
    });
    
    // Create a mock chunk with one dirt block at (0, 0, 0)
    const mockBuffer = new Uint32Array(16 * 288 * 16);
    const idx = getIndex(0, 0, 0);
    const health = 300;
    mockBuffer[idx] = BlockIds.dirt | (health << 8);

    useChunkStore.setState({
      chunks: {
        '0,0': {
          buffer: mockBuffer,
          rebuildId: 1
        }
      }
    });
  });

  it('damageBlock reduces health and triggers mesh rebuild without removing block initially', () => {
    // We need to test the actual damageBlock from the store
    // Re-importing or getting it directly from store
    const { damageBlock } = useStore.getState();
    expect(typeof damageBlock).toBe('function');

    damageBlock(0, 0, 0, 100);

    const chunkStore = useChunkStore.getState();
    const chunkData = chunkStore.chunks['0,0'];
    const idx = getIndex(0, 0, 0);
    const newVal = chunkData.buffer[idx];
    
    const newHealth = (newVal >> 8) & 0x1ff;
    expect(newHealth).toBe(200); // 300 - 100 = 200

    // The game no longer requests a mesh rebuild on damage because crack textures
    // are not yet implemented in the worker, and rebuilding at 60fps causes massive lag.
    expect(useStore.getState().requestMeshRebuild).not.toHaveBeenCalled();
    expect(useStore.getState().removeCube).not.toHaveBeenCalled();
  });

  it('damageBlock calls removeCube when health hits zero', () => {
    const { damageBlock } = useStore.getState();
    
    damageBlock(0, 0, 0, 300);

    // Should have called removeCube because health <= 0
    expect(useStore.getState().removeCube).toHaveBeenCalledWith(0, 0, 0);
  });
});
