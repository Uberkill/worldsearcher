import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initMachineTickSystem, stopMachineTickSystem } from '../../src/systems/MachineTickSystem';
import { useInventoryStore } from '../../src/stores/inventorySlice';

vi.mock('../../src/stores/inventorySlice', () => ({
  useInventoryStore: {
    getState: vi.fn(() => ({
      machines: {},
      chests: {}
    })),
    setState: vi.fn()
  }
}));

vi.mock('../../src/stores/storeLinker', () => ({
  getNetworkStore: vi.fn(() => ({
    getState: () => ({ 
      isHost: true,
      broadcastEvent: vi.fn(),
      handleNetworkData: vi.fn(),
      playerId: 'host'
    })
  })),
  getGameStore: vi.fn()
}));

// Mock registries
vi.mock('../../src/registry/SmeltingRegistry', () => ({
  SmeltingRecipes: {
    'iron_ore': { output: 'iron_ingot', cookTime: 10 }
  },
  FuelRegistry: {
    'coal': { burnTime: 20 }
  }
}));

describe('MachineTickSystem', () => {

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    initMachineTickSystem();
  });

  afterEach(() => {
    stopMachineTickSystem();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('consumes fuel and advances smelting progress', async () => {
    useInventoryStore.getState = vi.fn(() => ({
      machines: {
        '0,0,0': { cookProgress: 0, currentCookMax: 10, burnTimeLeft: 0, currentFuelMax: 100 }
      },
      chests: {
        '0,0,0': [
          { texture: 'iron_ore', count: 1 }, // input
          { texture: 'coal', count: 1 }, // fuel
          null // output
        ]
      }
    }));

    vi.advanceTimersByTime(1000);

    const setState = useInventoryStore.setState as any;
    expect(setState).toHaveBeenCalled();
    const callArgs = setState.mock.calls[0][0];

    // Fuel consumed, burn time increased, progress increased
    const updatedChest = callArgs.chests['0,0,0'];
    expect(updatedChest[1]).toBeNull(); // coal consumed
    const updatedMachine = callArgs.machines['0,0,0'];
    expect(updatedMachine.burnTimeLeft).toBe(20);
    expect(updatedMachine.cookProgress).toBe(1);
  });

  it('pauses when fuel runs out', async () => {
    useInventoryStore.getState = vi.fn(() => ({
      machines: {
        '0,0,0': { cookProgress: 1, currentCookMax: 10, burnTimeLeft: 0, currentFuelMax: 100 }
      },
      chests: {
        '0,0,0': [
          { texture: 'iron_ore', count: 1 },
          null, // no fuel
          null
        ]
      }
    }));

    vi.advanceTimersByTime(1000);

    const setState = useInventoryStore.setState as any;
    expect(setState).not.toHaveBeenCalled(); // No changes when paused in the middle of smelting
  });

  it('deposits output and resets when smelting completes', async () => {
    useInventoryStore.getState = vi.fn(() => ({
      machines: {
        '0,0,0': { cookProgress: 9, currentCookMax: 10, burnTimeLeft: 5, currentFuelMax: 20 }
      },
      chests: {
        '0,0,0': [
          { texture: 'iron_ore', count: 1 },
          null,
          null
        ]
      }
    }));

    vi.advanceTimersByTime(1000);

    const setState = useInventoryStore.setState as any;
    expect(setState).toHaveBeenCalled();
    const callArgs = setState.mock.calls[0][0];

    const updatedMachine = callArgs.machines['0,0,0'];
    const updatedChest = callArgs.chests['0,0,0'];
    
    expect(updatedChest[0]).toBeNull(); // input consumed
    expect(updatedChest[2]).toEqual({ texture: 'iron_ingot', count: 1 }); // output deposited
    expect(updatedMachine.cookProgress).toBe(0); // timer resets
  });
});
