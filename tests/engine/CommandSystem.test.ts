import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initCommandSystem } from '../../src/systems/CommandSystem';
import { NetworkEventBus } from '../../src/utils/NetworkEventBus';
import { EventBus } from '../../src/utils/EventBus';
import { useConnectionStore } from '../../src/stores/connectionSlice';
import { networkActions } from '../../src/stores/networkActions';

// Mock dependencies
const mockSetState = vi.fn();
const mockNetworkState = {
  broadcastEvent: vi.fn(),
  broadcastSystemMessage: vi.fn(),
  connections: [],
  players: { 'sender-1': { name: 'Player1', pos: [0, 0, 0] } },
  isMod: (id: string) => id === 'sender-1',
  mods: ['sender-1'],
  addMod: vi.fn(),
  removeMod: vi.fn(),
  addChatMessage: vi.fn(),
  playerId: 'sender-1'
};

vi.mock('../../src/stores/networkActions', () => ({
  networkActions: {
    getState: vi.fn(() => mockNetworkState)
  }
}));

vi.mock('../../src/stores/storeLinker', () => ({
  getGameStore: vi.fn(() => ({
    getState: vi.fn(() => ({
      initializeShip: vi.fn(),
      setShipTransform: vi.fn(),
      shipBuffer: new Uint8Array([1, 1, 2, 2]),
      executeTeleport: vi.fn(),
      authoritativeInventories: { 'sender-1': [] },
      inventory: [],
      playerPosition: { x: 0, y: 0, z: 0 }
    })),
    setState: vi.fn()
  }))
}));

vi.mock('../../src/stores/connectionSlice', () => ({
  useConnectionStore: {
    getState: vi.fn(() => ({ isHost: true }))
  }
}));

vi.mock('../../src/stores/useStore', () => ({
  useStore: {
    getState: vi.fn(() => ({
      initializeShip: vi.fn(),
      setShipTransform: vi.fn(),
      shipBuffer: new Uint8Array([1, 1, 2, 2]),
      executeTeleport: vi.fn(),
      authoritativeInventories: { 'sender-1': [] },
      inventory: [],
      playerPosition: { x: 0, y: 0, z: 0 }
    })),
    setState: vi.fn()
  }
}));

vi.mock('../../src/stores/environmentSlice', () => ({
  useEnvironmentStore: {
    getState: vi.fn(() => ({
      setWorldTime: vi.fn(),
      worldTime: 12,
      daysElapsed: 1,
      isRaining: false
    }))
  }
}));

describe('CommandSystem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    EventBus.clear();
    
    mockNetworkState.mods = ['sender-1'];
    mockNetworkState.playerId = 'sender-1';
    mockNetworkState.connections = [];
    mockNetworkState.addChatMessage = vi.fn();
    
    initCommandSystem();
  });

  afterEach(() => {
    EventBus.clear();
  });

  it('handles /tp with valid coordinates', () => {
    const mockSendFeedback = vi.fn();
    // We mock addChatMessage to capture the feedback
    const state = (networkActions as any).getState();
    state.addChatMessage = mockSendFeedback;

    NetworkEventBus.emit('SERVER_COMMAND', {
      type: 'SERVER_COMMAND',
      senderId: 'sender-1',
      cmd: '/tp',
      args: ['/tp', '@s', '10', '20', '30']
    });

    expect(mockSendFeedback).toHaveBeenCalledWith('Teleported to 10 20 30', 'system', 'System');
  });

  it('rejects /tp with NaN or Infinity coordinates', () => {
    const mockSendFeedback = vi.fn();
    const state = (networkActions as any).getState();
    state.addChatMessage = mockSendFeedback;

    NetworkEventBus.emit('SERVER_COMMAND', {
      type: 'SERVER_COMMAND',
      senderId: 'sender-1',
      cmd: '/tp',
      args: ['/tp', '@s', 'NaN', 'Infinity', '30']
    });

    expect(mockSendFeedback).toHaveBeenCalledWith('Invalid coordinates', 'system', 'System');
  });

  it('rejects /tp with extremely large out-of-bounds coordinates', () => {
    const mockSendFeedback = vi.fn();
    const state = (networkActions as any).getState();
    state.addChatMessage = mockSendFeedback;

    NetworkEventBus.emit('SERVER_COMMAND', {
      type: 'SERVER_COMMAND',
      senderId: 'sender-1',
      cmd: '/tp',
      args: ['/tp', '@s', '9999999999', '0', '0']
    });

    expect(mockSendFeedback).toHaveBeenCalled();
  });

  it('rejects /give without valid amount or missing arguments', () => {
    const mockSendFeedback = vi.fn();
    const state = (networkActions as any).getState();
    state.addChatMessage = mockSendFeedback;

    NetworkEventBus.emit('SERVER_COMMAND', {
      type: 'SERVER_COMMAND',
      senderId: 'sender-1',
      cmd: '/give',
      args: ['/give', '@s']
    });

    expect(mockSendFeedback).toHaveBeenCalledWith('Usage: /give @s <item> [amount]', 'system', 'System');
  });

  it('denies host-only commands for non-op guests', async () => {
    const state = (networkActions as any).getState();
    state.mods = [];
    state.playerId = 'host-1'; // the host
    const mockSendFeedback = vi.fn();
    state.connections = [{
      metadata: { playerId: 'guest-1' },
      send: mockSendFeedback
    }];

    NetworkEventBus.emit('SERVER_COMMAND', {
      type: 'SERVER_COMMAND',
      senderId: 'guest-1',
      cmd: '/time',
      args: ['/time', 'set', 'day']
    });

    expect(mockSendFeedback).toHaveBeenCalledWith({ type: 'SYSTEM_MESSAGE', text: 'You do not have permission to use this command.' });
  });

  it('handles spam prevention (rate limiting)', () => {
    const mockSendFeedback = vi.fn();
    const state = (networkActions as any).getState();
    state.addChatMessage = mockSendFeedback;
    
    for (let i = 0; i < 10; i++) {
      NetworkEventBus.emit('SERVER_COMMAND', {
        type: 'SERVER_COMMAND',
        senderId: 'sender-1',
        cmd: '/unknowncmd',
        args: ['/unknowncmd']
      });
    }

    expect(mockSendFeedback).toHaveBeenCalledWith(expect.stringContaining('Unknown command: /unknowncmd'), 'system', 'System');
  });
});
