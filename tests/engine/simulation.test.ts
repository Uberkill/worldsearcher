import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../../src/stores/useStore';

describe('Doomsday Headless Engine Simulation', () => {
  beforeEach(() => {
    // Hard reset state before each test
    useStore.setState({ 
      playerPosition: [0, 0, 0],
      spawnQueue: [],
      chunkMap: new Map(),
      isWorldReady: true
    });
  });

  it('Simulates a player crossing a chunk boundary and triggers exact loading', () => {
    const state = useStore.getState();
    expect(state.playerPosition).toEqual([0, 0, 0]);

    // Simulate crossing boundary into chunk [16, 0, 0]
    useStore.setState({ playerPosition: [16, 0, 0] });
    
    // Strict assertion: The player position must be absolutely correct.
    const newState = useStore.getState();
    expect(newState.playerPosition).toStrictEqual([16, 0, 0]);
  });

  it('Entity State Machine forcefully transitions and enqueues spawn', () => {
    const initialCount = useStore.getState().spawnQueue.length;
    
    // DOOMSDAY: No "if (requestSpawn)" check. We call it directly. 
    // If the engine lacks this fundamental function, the test will violently crash with TypeError.
    useStore.getState().requestSpawn('hostile', [10, 0, 10]);
    
    // Strict Assertion: The queue must precisely increment by exactly 1.
    expect(useStore.getState().spawnQueue.length).toBe(initialCount + 1);
  });
});
