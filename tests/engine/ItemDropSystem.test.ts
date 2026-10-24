import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initItemDropSystem } from '../../src/systems/ItemDropSystem';
import { EventBus } from '../../src/utils/EventBus';

// Mock dependencies
vi.mock('../../src/stores/connectionSlice', () => ({
  useConnectionStore: {
    getState: vi.fn(() => ({ isHost: true }))
  }
}));

const mockSetState = vi.fn();
vi.mock('../../src/stores/inventorySlice', () => ({
  useInventoryStore: {
    setState: (fn: any) => mockSetState(fn)
  }
}));

const mockBroadcastEvent = vi.fn();
vi.mock('../../src/stores/storeLinker', () => ({
  getNetworkStore: vi.fn(() => ({
    getState: () => ({ broadcastEvent: mockBroadcastEvent })
  }))
}));

describe('ItemDropSystem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    EventBus.clear();
    initItemDropSystem();
  });

  afterEach(() => {
    EventBus.clear();
  });

  describe('EVENT_BLOCK_DESTROYED', () => {
    it('spawns correctly positioned drops when isHost is true', () => {
      EventBus.emit('EVENT_BLOCK_DESTROYED', {
        x: 10, y: 5, z: 10,
        texName: 'dirt'
      });

      // Should call setState twice: once (skipped because not a chest), then once for droppedItems
      expect(mockSetState).toHaveBeenCalledTimes(1);
      const stateUpdater = mockSetState.mock.calls[0][0];
      const nextState = stateUpdater({ droppedItems: [] });
      
      expect(nextState.droppedItems).toHaveLength(1);
      expect(nextState.droppedItems[0].texture).toBe('dirt');
      // Check pos
      expect(nextState.droppedItems[0].pos[0]).toBeGreaterThanOrEqual(10.3);
      expect(nextState.droppedItems[0].pos[0]).toBeLessThanOrEqual(10.7);

      expect(mockBroadcastEvent).toHaveBeenCalledWith(expect.objectContaining({
        type: 'ENTITY_SPAWN_EVENT',
        entityType: 'droppedItem',
        texture: 'dirt'
      }));
    });

    it('skips drops entirely if isHost is false', async () => {
      const connectionModule = await import('../../src/stores/connectionSlice');
      connectionModule.useConnectionStore.getState = vi.fn(() => ({ isHost: false }));

      EventBus.emit('EVENT_BLOCK_DESTROYED', {
        x: 10, y: 5, z: 10,
        texName: 'dirt'
      });

      expect(mockSetState).not.toHaveBeenCalled();
      expect(mockBroadcastEvent).not.toHaveBeenCalled();
    });

    it('iterates over chestItems and spawns contents into the world', async () => {
      const connectionModule = await import('../../src/stores/connectionSlice');
      connectionModule.useConnectionStore.getState = vi.fn(() => ({ isHost: true }));

      EventBus.emit('EVENT_BLOCK_DESTROYED', {
        x: 0, y: 0, z: 0,
        texName: 'chest',
        chestItems: [
          { texture: 'iron_ingot', count: 5 },
          null, // empty/corrupted slot
          { texture: 'wood', count: 10 }
        ]
      });

      expect(mockSetState).toHaveBeenCalledTimes(2);

      // 1st setState is chest removal
      const chestRemovalUpdater = mockSetState.mock.calls[0][0];
      const nextChestState = chestRemovalUpdater({ chests: { '0,0,0': {} }, machines: {} });
      expect(nextChestState.chests['0,0,0']).toBeUndefined();

      // 2nd setState is dropped items addition (1 chest + 2 valid items = 3 drops)
      const dropsUpdater = mockSetState.mock.calls[1][0];
      const nextDropsState = dropsUpdater({ droppedItems: [] });
      expect(nextDropsState.droppedItems).toHaveLength(3);
    });

    it('should NOT spawn items if causedByGravity is true', async () => {
      const connectionModule = await import('../../src/stores/connectionSlice');
      connectionModule.useConnectionStore.getState = vi.fn(() => ({ isHost: true }));

      EventBus.emit('EVENT_BLOCK_DESTROYED', {
        x: 10, y: 5, z: 10,
        texName: 'dirt',
        causedByGravity: true
      });

      expect(mockSetState).not.toHaveBeenCalled();
    });

    it('truncates dropped items exceeding 1000 items', async () => {
      const connectionModule = await import('../../src/stores/connectionSlice');
      connectionModule.useConnectionStore.getState = vi.fn(() => ({ isHost: true }));

      const existingItems = Array.from({ length: 1000 }, (_, i) => ({ key: `old_item_${i}` }));
      
      EventBus.emit('EVENT_BLOCK_DESTROYED', {
        x: 10, y: 5, z: 10,
        texName: 'dirt'
      });

      const dropsUpdater = mockSetState.mock.calls[0][0];
      const nextDropsState = dropsUpdater({ droppedItems: existingItems });
      
      expect(nextDropsState.droppedItems).toHaveLength(1000);
      expect(nextDropsState.droppedItems[999].texture).toBe('dirt');
      expect(nextDropsState.droppedItems[0].key).not.toBe('old_item_0'); // The first item was shifted out
    });
  });

  describe('EVENT_BLOCKS_DESTROYED_BULK', () => {
    it('consolidates multiple items into stacks of max 64', async () => {
      const connectionModule = await import('../../src/stores/connectionSlice');
      connectionModule.useConnectionStore.getState = vi.fn(() => ({ isHost: true }));

      const blocks = [];
      for (let i = 0; i < 70; i++) {
        blocks.push({ x: 0, y: 0, z: 0, texName: 'stone' });
      }

      EventBus.emit('EVENT_BLOCKS_DESTROYED_BULK', { blocks });

      expect(mockSetState).toHaveBeenCalledTimes(1);
      const dropsUpdater = mockSetState.mock.calls[0][0];
      const nextDropsState = dropsUpdater({ droppedItems: [] });

      // 70 items -> 1 stack of 64, 1 stack of 6
      expect(nextDropsState.droppedItems).toHaveLength(2);
      
      const counts = nextDropsState.droppedItems.map((d: any) => d.count).sort((a: number, b: number) => a - b);
      expect(counts).toEqual([6, 64]);
    });
  });
});
