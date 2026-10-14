import { describe, it, expect, vi, beforeAll } from 'vitest';
import { chunkWorkerPool } from '../../src/utils/workerPool';

class MockWebGLRenderingContext {
  TRIANGLES = 4;
  TRIANGLE_STRIP = 5;
  TRIANGLE_FAN = 6;
  ARRAY_BUFFER = 0x8892;
  ELEMENT_ARRAY_BUFFER = 0x8893;
  ARRAY_BUFFER_BINDING = 0x8894;
  ELEMENT_ARRAY_BUFFER_BINDING = 0x8895;

  _currentBoundBuffer: unknown = null;

  drawArrays(_mode: number, _first: number, _count: number): void {}
  drawElements(_mode: number, _count: number, _type: number, _offset: number): void {}
  bindTexture(_target: number, _texture: unknown): void {}
  bufferData(_target: number, _data: unknown, _usage: number): void {}
  deleteBuffer(_buffer: unknown): void {}
  getParameter(pname: number): unknown {
    if (pname === this.ARRAY_BUFFER_BINDING) return this._currentBoundBuffer;
    return null;
  }
}

describe('Telemetry & Memory Lifecycle Subsystems', () => {
  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).WebGLRenderingContext = MockWebGLRenderingContext;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).WebGLRenderingContext = MockWebGLRenderingContext;
    await import('../../src/utils/WebGLTracker');
  });

  describe('WebGLTracker Telemetry Arithmetic', () => {
    it('accurately tracks drawArrays calls, vertices, and triangle counts for TRIANGLES', () => {
      const ctx = new MockWebGLRenderingContext();
      const stats = window.__DEBUG_STATS__;

      const initialDraws = stats.drawCalls;
      const initialVertices = stats.vertices;
      const initialTriangles = stats.triangles;

      ctx.drawArrays(ctx.TRIANGLES, 0, 12);

      expect(stats.drawCalls).toBe(initialDraws + 1);
      expect(stats.vertices).toBe(initialVertices + 12);
      expect(stats.triangles).toBe(initialTriangles + 4);
    });

    it('accurately calculates triangle counts for TRIANGLE_STRIP mode', () => {
      const ctx = new MockWebGLRenderingContext();
      const stats = window.__DEBUG_STATS__;

      const initialTriangles = stats.triangles;
      ctx.drawArrays(ctx.TRIANGLE_STRIP, 0, 6);

      // TRIANGLE_STRIP produces count - 2 triangles
      expect(stats.triangles).toBe(initialTriangles + 4);
    });

    it('increments texture binds on valid textures and ignores null unbinds', () => {
      const ctx = new MockWebGLRenderingContext();
      const stats = window.__DEBUG_STATS__;

      const initialBinds = stats.textureBinds;

      // Valid texture bind
      ctx.bindTexture(0, { id: 'test_diffuse_atlas' });
      expect(stats.textureBinds).toBe(initialBinds + 1);

      // Null unbind during cleanup must not increment counter
      ctx.bindTexture(0, null);
      expect(stats.textureBinds).toBe(initialBinds + 1);
    });

    it('tracks VBO byte allocations, reallocations, and deallocations accurately without leaks', () => {
      const ctx = new MockWebGLRenderingContext();
      const stats = window.__DEBUG_STATS__;

      const initialVboBytes = stats.vboMemoryBytes;
      const mockBuffer = { id: 'chunk_vbo_001' };
      ctx._currentBoundBuffer = mockBuffer;

      // Initial allocation: 4096 bytes via TypedArray
      const fakeData = new Uint8Array(4096);
      ctx.bufferData(ctx.ARRAY_BUFFER, fakeData, 0);
      expect(stats.vboMemoryBytes).toBe(initialVboBytes + 4096);

      // Reallocation: replacing buffer data with larger 8192 byte buffer
      const largerData = new Uint8Array(8192);
      ctx.bufferData(ctx.ARRAY_BUFFER, largerData, 0);
      // WeakMap subtracts previous 4096 and adds 8192
      expect(stats.vboMemoryBytes).toBe(initialVboBytes + 8192);

      // Deallocation: deleting the buffer clears memory and removes from WeakMap
      ctx.deleteBuffer(mockBuffer);
      expect(stats.vboMemoryBytes).toBe(initialVboBytes);
    });
  });

  describe('WorkerPool Task Priority & Cancellation', () => {
    it('places high-priority rebuild tasks at queue head when no generators exist', () => {
      chunkWorkerPool.cancelAllPending();

      // Make all workers busy to keep tasks queued
      chunkWorkerPool._idle = [];

      const normalRebuildBuffer = new Uint32Array(10);
      const highRebuildBuffer = new Uint32Array(10);

      // Queue low priority rebuild
      void chunkWorkerPool.rebuild(normalRebuildBuffer, [], 10, 10, 1, undefined, false);
      // Queue high priority rebuild
      void chunkWorkerPool.rebuild(highRebuildBuffer, [], 20, 20, 1, undefined, true);

      expect(chunkWorkerPool._queue.length).toBe(2);
      // High priority task unshifts to index 0 ahead of normal task
      expect(chunkWorkerPool._queue[0].cx).toBe(20);
      expect(chunkWorkerPool._queue[0].isHighPriority).toBe(true);
      expect(chunkWorkerPool._queue[1].cx).toBe(10);
    });

    it('cancels all pending tasks and empties queue cleanly on cancelAllPending', async () => {
      chunkWorkerPool.cancelAllPending();
      chunkWorkerPool._idle = [];

      let resolvedNormal: unknown = null;
      let resolvedHigh: unknown = null;

      const p1 = chunkWorkerPool.rebuild(new Uint32Array(5), [], 1, 1, 1, undefined, false).then((res) => {
        resolvedNormal = res;
      });
      const p2 = chunkWorkerPool.rebuild(new Uint32Array(5), [], 2, 2, 1, undefined, true).then((res) => {
        resolvedHigh = res;
      });

      expect(chunkWorkerPool._queue.length).toBe(2);

      chunkWorkerPool.cancelAllPending();

      await Promise.all([p1, p2]);

      expect(chunkWorkerPool._queue.length).toBe(0);
      expect(resolvedNormal).toEqual({ error: 'CANCELLED' });
      expect(resolvedHigh).toEqual({ error: 'CANCELLED' });
    });
  });
});
