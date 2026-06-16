import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/utils/db.js', () => ({
  saveChunkToDB: vi.fn(),
  loadChunkFromDB: vi.fn(),
  clearDB: vi.fn(),
  cancelLoadFromDB: vi.fn(),
  flushWAL: vi.fn()
}));

vi.mock('../src/utils/workerPool.js', () => ({
  chunkWorkerPool: {
    requestChunkRebuild: vi.fn(),
    recycleBuffers: vi.fn()
  },
  injectWorkerDependencies: vi.fn()
}));

vi.stubGlobal('Worker', class Worker {
  constructor() {}
  postMessage() {}
  addEventListener() {}
  removeEventListener() {}
  terminate() {}
});

import { useStore } from '../src/stores/useStore';
import { getShipIndex, SHIP_SIZE_X, SHIP_SIZE_Y, SHIP_SIZE_Z } from '../src/stores/createShipSlice';

describe('Ship Store Logic', () => {
  beforeEach(() => {
    // Reset state before each test
    useStore.setState({ shipCorePower: 10000, shipMaxPower: 10000 });
  });

  it('getShipIndex calculates correct 1D array index', () => {
    expect(getShipIndex(0, 0, 0)).toBe(0);
    expect(getShipIndex(1, 0, 0)).toBe(1);
    expect(getShipIndex(0, 1, 0)).toBe(32 * 32); // Y level 1 starts at 1024
    expect(getShipIndex(31, 31, 31)).toBe(SHIP_SIZE_X * SHIP_SIZE_Y * SHIP_SIZE_Z - 1);
  });

  it('drainShipPower clamps to 0', () => {
    const state = useStore.getState();
    state.drainShipPower(5000);
    expect(useStore.getState().shipCorePower).toBe(5000);
    
    state.drainShipPower(10000);
    expect(useStore.getState().shipCorePower).toBe(0); // Should clamp
  });

  it('chargeShipPower clamps to shipMaxPower', () => {
    const state = useStore.getState();
    state.drainShipPower(5000);
    state.chargeShipPower(2000);
    expect(useStore.getState().shipCorePower).toBe(7000);

    state.chargeShipPower(10000);
    expect(useStore.getState().shipCorePower).toBe(10000); // Should clamp
  });
});
