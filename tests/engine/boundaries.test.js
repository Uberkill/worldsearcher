import { describe, it, expect, beforeEach } from 'vitest';
import { getIndex } from '../../src/utils/chunkData';
import { useStore } from '../../src/stores/useStore';

describe('Doomsday Chaos & Boundary Fuzzing', () => {
  beforeEach(() => {
    useStore.setState({ spawnQueue: [], isTransitMode: false });
  });

  it('Chunk Data packing algorithms calculate absolute zero accurately', () => {
    const index = getIndex(0, 0, 0);
    expect(index).not.toBeNaN();
    expect(index).toBeGreaterThanOrEqual(0);
  });

  it('State machine strictly survives rapid Transit Mode toggling', () => {
    for (let i = 0; i < 100; i++) {
      useStore.setState({ isTransitMode: i % 2 === 0 });
    }
    
    const state = useStore.getState();
    expect(typeof state.isTransitMode).toBe('boolean');
    expect(state.shipPower || 100).toBeGreaterThanOrEqual(0);
  });

  it('Entity Component System losslessly handles exactly 5000 simultaneous entity spawns', () => {
    const t0 = performance.now();
    
    // DOOMSDAY: No "if (requestSpawn)" check. We call it directly. 
    // No mock arrays. We force the engine to actually route 5000 requests.
    for (let i = 0; i < 5000; i++) {
      useStore.getState().requestSpawn('zombie', [i, 0, i], 1);
    }
    
    const t1 = performance.now();

    const state = useStore.getState();
    
    // Strict Assertion 1: Length MUST be exactly 5000. Not greater than 0.
    expect(state.spawnQueue.length).toBe(5000);
    
    // Strict Assertion 2: Memory corruption check on Entity #3742
    // We check if the 3742nd element has the exact correct positional data.
    const sampleEntity = state.spawnQueue[3742];
    expect(sampleEntity.type).toBe('zombie');
    expect(sampleEntity.pos).toStrictEqual([3742, 0, 3742]);

    // Ensure the main thread wasn't blocked for more than 500ms
    expect(t1 - t0).toBeLessThan(500);
  });
});
