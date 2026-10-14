import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseBinaryPacket } from '../../src/stores/network/packetParser';
import { networkActions } from '../../src/stores/networkActions';
import { setGameStore } from '../../src/stores/storeLinker';

describe('Multiplayer Edge Cases and Network Robustness', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('parseBinaryPacket', () => {
    it('parses valid PLAYER_MOVE packet into player positionBuffer', () => {
      const buffer = new ArrayBuffer(57);
      const view = new DataView(buffer);
      view.setUint8(0, 1); // PLAYER_MOVE type

      const playerId = 'player-uuid-12345678-abcd-1234-5678';
      for (let i = 0; i < playerId.length; i++) {
        view.setUint8(1 + i, playerId.charCodeAt(i));
      }

      view.setFloat32(37, 10.5, true);
      view.setFloat32(41, 64.0, true);
      view.setFloat32(45, -20.5, true);
      view.setFloat32(49, 0.15, true);
      view.setFloat32(53, 1.25, true);

      let updatedState: Record<string, unknown> | null = null;
      const set = (updater: (prev: { players: Record<string, unknown> }) => Record<string, unknown>) => {
        updatedState = updater({ players: {} });
      };

      parseBinaryPacket(buffer, set, () => ({}));

      expect(updatedState).not.toBeNull();
      const players = (updatedState as { players: Record<string, { positionBuffer: Array<{ x: number, y: number, z: number, pitch: number, yaw: number }> }> }).players;
      expect(players[playerId]).toBeDefined();
      expect(players[playerId].positionBuffer[0].x).toBeCloseTo(10.5);
      expect(players[playerId].positionBuffer[0].y).toBeCloseTo(64.0);
      expect(players[playerId].positionBuffer[0].z).toBeCloseTo(-20.5);
      expect(players[playerId].positionBuffer[0].pitch).toBeCloseTo(0.15);
      expect(players[playerId].positionBuffer[0].yaw).toBeCloseTo(1.25);
    });

    it('silently drops truncated PLAYER_MOVE packet without throwing', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const buffer = new ArrayBuffer(40); // Under required 57 bytes
      const view = new DataView(buffer);
      view.setUint8(0, 1);

      const set = vi.fn();
      expect(() => parseBinaryPacket(buffer, set, () => ({}))).not.toThrow();
      expect(set).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Dropped truncated PLAYER_MOVE'));
    });

    it('rejects PLAYER_MOVE packet containing NaN or Infinity coordinates', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const buffer = new ArrayBuffer(57);
      const view = new DataView(buffer);
      view.setUint8(0, 1);

      view.setFloat32(37, Number.NaN, true);
      view.setFloat32(41, 64.0, true);
      view.setFloat32(45, Number.POSITIVE_INFINITY, true);
      view.setFloat32(49, 0, true);
      view.setFloat32(53, 0, true);

      const set = vi.fn();
      parseBinaryPacket(buffer, set, () => ({}));

      expect(set).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Dropped PLAYER_MOVE packet with NaN coordinates'));
    });

    it('safely handles unaligned byte offsets in BLOCK_DELTA packet', () => {
      const applyNetworkDeltaMock = vi.fn();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setGameStore({ getState: () => ({ applyNetworkDelta: applyNetworkDeltaMock }) } as any);

      // Create a large buffer and slice from an odd byte offset to simulate WebRTC buffer slice
      const rawBuffer = new ArrayBuffer(64);
      const uint8 = new Uint8Array(rawBuffer);
      const unalignedOffset = 3;
      const packetLength = 20; // 12 header + 8 payload (2 delta ints)

      const view = new DataView(rawBuffer, unalignedOffset, packetLength);
      view.setUint8(0, 2); // BLOCK_DELTA type
      view.setInt32(4, 12, true); // cx
      view.setInt32(8, -7, true); // cz
      view.setUint32(12, 1001, true); // delta 1
      view.setUint32(16, 2002, true); // delta 2

      const unalignedSlice = uint8.subarray(unalignedOffset, unalignedOffset + packetLength);

      expect(() => parseBinaryPacket(unalignedSlice, vi.fn(), () => ({}))).not.toThrow();
      expect(applyNetworkDeltaMock).toHaveBeenCalledWith('12,-7', [1001, 2002]);
    });

    it('drops truncated BLOCK_DELTA header under 12 bytes', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const buffer = new ArrayBuffer(10);
      new DataView(buffer).setUint8(0, 2);

      const set = vi.fn();
      expect(() => parseBinaryPacket(buffer, set, () => ({}))).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Dropped truncated BLOCK_DELTA packet'));
    });

    it('parses valid ENTITY_STATE packet and updates enemySyncBuffers', () => {
      const buffer = new ArrayBuffer(6 + 24);
      const view = new DataView(buffer);
      view.setUint8(0, 3); // ENTITY_STATE type
      view.setUint8(1, 4); // subType
      view.setUint16(2, 1, true); // count = 1
      view.setUint16(4, 42, true); // seq = 42

      const offset = 6;
      view.setUint16(offset, 101, true); // entity id
      view.setUint8(offset + 2, 2); // mode
      view.setFloat32(offset + 4, 85.5, true); // health
      view.setFloat32(offset + 8, 12.0, true); // x
      view.setFloat32(offset + 12, 34.0, true); // y
      view.setFloat32(offset + 16, 56.0, true); // z
      view.setFloat32(offset + 20, 3.14, true); // yaw

      let statePatch: Record<string, unknown> | null = null;
      const set = (updater: (prev: { enemySyncBuffers: Record<string, unknown> }) => Record<string, unknown>) => {
        statePatch = updater({ enemySyncBuffers: {} });
      };

      parseBinaryPacket(buffer, set, () => ({}));

      expect(statePatch).not.toBeNull();
      const buffers = (statePatch as { enemySyncBuffers: Record<number, { seq: number, entities: Array<{ id: number, health: number, x: number }> }> }).enemySyncBuffers;
      expect(buffers[4]).toBeDefined();
      expect(buffers[4].seq).toBe(42);
      expect(buffers[4].entities).toHaveLength(1);
      expect(buffers[4].entities[0].id).toBe(101);
      expect(buffers[4].entities[0].health).toBeCloseTo(85.5);
    });

    it('drops truncated ENTITY_STATE payload when byte length is less than expected', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const buffer = new ArrayBuffer(6 + 10); // Count is 1, expects 6 + 24 = 30 bytes
      const view = new DataView(buffer);
      view.setUint8(0, 3);
      view.setUint8(1, 1);
      view.setUint16(2, 1, true);
      view.setUint16(4, 1, true);

      const set = vi.fn();
      parseBinaryPacket(buffer, set, () => ({}));

      expect(set).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Dropped truncated ENTITY_STATE payload'));
    });
  });

  describe('cullDeadConnection', () => {
    it('removes dead player, closes connection, and releases ship helm if dead player was captain', () => {
      const deadPlayerId = 'dead-captain-001';
      const mockConn = {
        metadata: { playerId: deadPlayerId },
        close: vi.fn(),
      };

      const handleNetworkDataMock = vi.fn();
      const broadcastSystemMessageMock = vi.fn();

      networkActions.setState({
        isHost: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        connections: [mockConn as any],
        players: {
          [deadPlayerId]: { name: 'CaptainNemo' },
          'alive-player': { name: 'FirstMate' },
        },
        broadcastSystemMessage: broadcastSystemMessageMock,
        handleNetworkData: handleNetworkDataMock,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setGameStore({
        getState: () => ({
          shipHelmPlayerId: deadPlayerId,
        }),
      } as any);

      networkActions.getState().cullDeadConnection(deadPlayerId);

      const state = networkActions.getState();
      expect(state.players[deadPlayerId]).toBeUndefined();
      expect(mockConn.close).toHaveBeenCalled();
      expect(handleNetworkDataMock).toHaveBeenCalledWith({
        type: 'RELEASE_HELM',
        playerId: deadPlayerId,
      });
      expect(broadcastSystemMessageMock).toHaveBeenCalledWith('CaptainNemo timed out.');
    });
  });
});
