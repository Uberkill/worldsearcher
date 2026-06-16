import { describe, it, expect } from 'vitest';
import { useStore } from '../../src/stores/useStore';
import { useChunkStore } from '../../src/stores/chunkSlice';

describe('Doomsday Memory Lifecycle Testing', () => {
  it('Autonomous GC unloads distant chunks after expiration timer to prevent OOM', () => {
    // Fake populating chunks
    const testMap = new Map();
    for (let x = 0; x < 10; x++) {
      testMap.set(`${x},0`, { buffer: new Uint32Array(16*288*16) }); 
    }
    
    useChunkStore.setState({ chunks: Object.fromEntries(testMap) });
    expect(Object.keys(useChunkStore.getState().chunks).length).toBe(10);

    // Simulate player teleporting infinitely far away
    useStore.setState({ playerPosition: [999999, 0, 999999] });

    // The headless tick loop runs unloadDistantChunks natively
    useStore.getState().unloadDistantChunks([999999, 0, 999999]);

    // Initial check: The chunks should NOT be deleted instantly. They have a 15-second grace period.
    expect(Object.keys(useChunkStore.getState().chunks).length).toBe(10);

    // Fast-forward time (simulate 16 seconds passing)
    // We override Date.now() for this specific test frame to bypass the pure expiration timestamp
    const realDateNow = Date.now.bind(global.Date);
    global.Date.now = () => realDateNow() + 16000;

    // The headless tick loop natively calls tickGarbageCollection
    useStore.getState().tickGarbageCollection();

    // Strict Assertion: The chunk map must be entirely eradicated by the engine logic.
    expect(Object.keys(useChunkStore.getState().chunks).length).toBe(0);

    // Restore Date.now
    global.Date.now = realDateNow;
  });
});

