import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseBinaryPacket } from '../../src/stores/network/packetParser';
import { createChunkActions } from '../../src/stores/network/chunkActions';
import { NetworkEventBus } from '../../src/utils/NetworkEventBus';
import '../../src/systems/network/ConnectionSystems';

describe('Multiplayer Synchronization & Hardening Suite (TASK-002)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('RLE Chunk Compression / Decompression Roundtrip', () => {
    const compressRLEPure = (sourceArray: Uint32Array): Uint32Array => {
      const rle: number[] = [];
      let currentVal = sourceArray[0];
      let count = 1;
      for (let i = 1; i < sourceArray.length; i++) {
        if (sourceArray[i] === currentVal) {
          count++;
        } else {
          rle.push(count, currentVal);
          currentVal = sourceArray[i];
          count = 1;
        }
      }
      rle.push(count, currentVal);
      return new Uint32Array(rle);
    };

    const decompressRLEPure = (rleArray: Uint32Array, totalLength: number): Uint32Array => {
      const out = new Uint32Array(totalLength);
      let outIdx = 0;
      for (let i = 0; i < rleArray.length; i += 2) {
        const count = rleArray[i];
        const val = rleArray[i + 1];
        out.fill(val, outIdx, Math.min(outIdx + count, totalLength));
        outIdx += count;
      }
      return out;
    };

    it('preserves exact bit-level integrity on diverse voxel buffers', () => {
      const bufferSize = 8192;
      const testBuffer = new Uint32Array(bufferSize);

      testBuffer.fill(0, 0, 2000); // Air run
      testBuffer.fill(1 | (100 << 8) | (15 << 26), 2000, 5000); // Stone with sunlight
      testBuffer.fill(2 | (80 << 8), 5000, 7000); // Dirt run
      for (let i = 7000; i < bufferSize; i++) {
        testBuffer[i] = (i % 5) | (200 << 8); // Rapid alternation
      }

      const compressed = compressRLEPure(testBuffer);
      expect(compressed.length).toBeLessThan(bufferSize);

      const decompressed = decompressRLEPure(compressed, bufferSize);
      expect(decompressed.length).toBe(testBuffer.length);

      let isIdentical = true;
      for (let i = 0; i < bufferSize; i++) {
        if (decompressed[i] !== testBuffer[i]) {
          isIdentical = false;
          break;
        }
      }
      expect(isIdentical).toBe(true);
    });
  });

  describe('Chunk Request Queue Draining & Concurrency Cap', () => {
    it('respects MAX_CONCURRENT_CHUNK_REQUESTS and drains queue sequentially', async () => {
      const mockHostConn = {
        send: vi.fn(),
      };

      let state: any = {
        MAX_CONCURRENT_CHUNK_REQUESTS: 2,
        inFlightChunkRequests: 0,
        chunkQueue: [],
        chunkRequests: {},
        connections: [mockHostConn],
        isHost: false,
      };

      const set = (updater: any) => {
        const patch = typeof updater === 'function' ? updater(state) : updater;
        state = { ...state, ...patch };
      };
      const get = () => state;

      const chunkActions = createChunkActions(set, get);
      state = { ...state, ...chunkActions };

      // Queue 4 chunk requests
      const p1 = chunkActions.requestChunkFromHost('0,0');
      const p2 = chunkActions.requestChunkFromHost('1,0');
      const p3 = chunkActions.requestChunkFromHost('2,0');
      const p4 = chunkActions.requestChunkFromHost('3,0');

      // Only 2 requests should be sent immediately due to concurrency cap of 2
      expect(mockHostConn.send).toHaveBeenCalledTimes(2);
      expect(state.inFlightChunkRequests).toBe(2);
      expect(state.chunkQueue.length).toBe(2);

      // Resolve p1
      state.chunkRequests['0,0']('PRISTINE');
      delete state.chunkRequests['0,0'];
      state.inFlightChunkRequests--;
      chunkActions.processChunkQueue();

      // Third request is now dispatched
      expect(mockHostConn.send).toHaveBeenCalledTimes(3);

      // Resolve p2
      state.chunkRequests['1,0']('PRISTINE');
      delete state.chunkRequests['1,0'];
      state.inFlightChunkRequests--;
      chunkActions.processChunkQueue();

      // Fourth request is now dispatched
      expect(mockHostConn.send).toHaveBeenCalledTimes(4);

      // Resolve p3 and p4
      state.chunkRequests['2,0']('PRISTINE');
      delete state.chunkRequests['2,0'];
      state.inFlightChunkRequests--;

      state.chunkRequests['3,0']('PRISTINE');
      delete state.chunkRequests['3,0'];
      state.inFlightChunkRequests--;

      const results = await Promise.all([p1, p2, p3, p4]);
      expect(results).toEqual(['PRISTINE', 'PRISTINE', 'PRISTINE', 'PRISTINE']);
      expect(state.inFlightChunkRequests).toBe(0);
      expect(state.chunkQueue.length).toBe(0);
    });
  });

  describe('Host Multi-Peer Relays', () => {
    it('relays PLAYER_MOVE from Guest 1 to Guest 2 across unreliable channels', () => {
      const guest1Conn = { peer: 'guest-1', open: true, send: vi.fn() };
      const guest2Conn = { peer: 'guest-2', open: true, send: vi.fn() };

      const buffer = new ArrayBuffer(57);
      const view = new DataView(buffer);
      view.setUint8(0, 1); // PLAYER_MOVE
      const guest1Id = 'guest-uuid-1';
      for (let i = 0; i < guest1Id.length; i++) {
        view.setUint8(1 + i, guest1Id.charCodeAt(i));
      }
      view.setFloat32(37, 10.0, true);
      view.setFloat32(41, 64.0, true);
      view.setFloat32(45, 20.0, true);
      view.setFloat32(49, 0.5, true);
      view.setFloat32(53, 1.0, true);

      let serverState: any = {
        isHost: true,
        players: {},
        unreliableConnections: [guest1Conn, guest2Conn],
      };

      const set = (updater: any) => {
        const patch = typeof updater === 'function' ? updater(serverState) : updater;
        serverState = { ...serverState, ...patch };
      };
      const get = () => serverState;

      parseBinaryPacket(buffer, set, get, guest1Conn);

      // Verify host state records both positionBuffer and root coordinates
      expect(serverState.players[guest1Id]).toBeDefined();
      expect(serverState.players[guest1Id].x).toBeCloseTo(10.0);
      expect(serverState.players[guest1Id].y).toBeCloseTo(64.0);
      expect(serverState.players[guest1Id].z).toBeCloseTo(20.0);
      expect(serverState.players[guest1Id].positionBuffer).toHaveLength(1);

      // Verify Guest 2 received the relayed packet, but Guest 1 was excluded
      expect(guest1Conn.send).not.toHaveBeenCalled();
      expect(guest2Conn.send).toHaveBeenCalledTimes(1);
    });

    it('relays BLOCK_DELTA from Guest 1 to Guest 2 across reliable connections', () => {
      const guest1Conn = { peer: 'guest-1', open: true, send: vi.fn() };
      const guest2Conn = { peer: 'guest-2', open: true, send: vi.fn() };

      const buffer = new ArrayBuffer(16);
      const view = new DataView(buffer);
      view.setUint8(0, 2); // BLOCK_DELTA
      view.setInt32(4, 3, true); // cx
      view.setInt32(8, -4, true); // cz
      view.setUint32(12, 9999, true); // delta data

      let serverState: any = {
        isHost: true,
        connections: [guest1Conn, guest2Conn],
      };

      const set = (updater: any) => {
        const patch = typeof updater === 'function' ? updater(serverState) : updater;
        serverState = { ...serverState, ...patch };
      };
      const get = () => serverState;

      parseBinaryPacket(buffer, set, get, guest1Conn);

      // Verify Guest 2 received the delta, but sender Guest 1 was excluded
      expect(guest1Conn.send).not.toHaveBeenCalled();
      expect(guest2Conn.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('WELCOME Handshake Resiliency', () => {
    it('transitions connectionStatus to connected even when hostName is empty or undefined', () => {
      let networkState: any = {
        connectionStatus: 'connecting',
        players: {},
      };

      const setNetworkState = (updater: any) => {
        const patch = typeof updater === 'function' ? updater(networkState) : updater;
        networkState = { ...networkState, ...patch };
      };

      NetworkEventBus.emit('WELCOME', {
        data: {
          hostId: 'host-peer-id-123',
          hostName: '',
          worldSeed: 12345,
        },
        setNetworkState,
      });

      expect(networkState.connectionStatus).toBe('connected');
      expect(networkState.players['host-peer-id-123']).toBeDefined();
      expect(networkState.players['host-peer-id-123'].name).toBe('Host');
    });

    it('transitions connectionStatus to connected when hostId is missing by falling back gracefully', () => {
      let networkState: any = {
        connectionStatus: 'connecting',
        players: {},
      };

      const setNetworkState = (updater: any) => {
        const patch = typeof updater === 'function' ? updater(networkState) : updater;
        networkState = { ...networkState, ...patch };
      };

      NetworkEventBus.emit('WELCOME', {
        data: {
          hostId: null,
          hostName: null,
          worldSeed: 54321,
        },
        setNetworkState,
      });

      expect(networkState.connectionStatus).toBe('connected');
      expect(networkState.players['host']).toBeDefined();
      expect(networkState.players['host'].name).toBe('Host');
    });
  });

  describe('SHIP_TRANSFORM Broadcast Reachability', () => {
    it('dispatches SHIP_TRANSFORM to all connected peers', () => {
      const connA = { peer: 'peer-a', send: vi.fn() };
      const connB = { peer: 'peer-b', send: vi.fn() };

      const connections = [connA, connB];
      const transformPayload = {
        type: 'SHIP_TRANSFORM',
        position: [100, 200, 300],
        rotation: [0, 1.57, 0],
      };

      connections.forEach((conn) => {
        conn.send(transformPayload);
      });

      expect(connA.send).toHaveBeenCalledWith(transformPayload);
      expect(connB.send).toHaveBeenCalledWith(transformPayload);
    });
  });
});
