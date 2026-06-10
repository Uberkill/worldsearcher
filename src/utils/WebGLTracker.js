// Initialize global debug stats
window.__DEBUG_STATS__ = window.__DEBUG_STATS__ || {
  fps: 0,
  cpuTime: 0,
  gpuTime: 0,
  drawCalls: 0,
  triangles: 0,
  vertices: 0,
  textureBinds: 0,
  vboMemoryBytes: 0,
  totalChunks: 0,
  chunksRendered: 0,
  totalEntities: 0,
  entitiesRendered: 0,
  errorLog: [],
};

// Only run once
if (!window.__WEBGL_TRACKER_INIT__) {
  window.__WEBGL_TRACKER_INIT__ = true;

  const patchContext = (ContextClass) => {
    if (!ContextClass || !ContextClass.prototype) return;

    const proto = ContextClass.prototype;

    // --- Draw Calls, Triangles, Vertices ---

    const originalDrawArrays = proto.drawArrays;
    proto.drawArrays = function (mode, first, count) {
      window.__DEBUG_STATS__.drawCalls++;
      window.__DEBUG_STATS__.vertices += count;
      if (mode === this.TRIANGLES)
        window.__DEBUG_STATS__.triangles += count / 3;
      else if (mode === this.TRIANGLE_STRIP || mode === this.TRIANGLE_FAN)
        window.__DEBUG_STATS__.triangles += Math.max(0, count - 2);

      return originalDrawArrays.apply(this, arguments);
    };

    const originalDrawElements = proto.drawElements;
    proto.drawElements = function (mode, count, _type, _offset) {
      window.__DEBUG_STATS__.drawCalls++;
      window.__DEBUG_STATS__.vertices += count;
      if (mode === this.TRIANGLES)
        window.__DEBUG_STATS__.triangles += count / 3;
      else if (mode === this.TRIANGLE_STRIP || mode === this.TRIANGLE_FAN)
        window.__DEBUG_STATS__.triangles += Math.max(0, count - 2);

      return originalDrawElements.apply(this, arguments);
    };

    if (proto.drawElementsInstanced) {
      const originalDrawElementsInstanced = proto.drawElementsInstanced;
      proto.drawElementsInstanced = function (
        mode,
        count,
        _type,
        _offset,
        instanceCount
      ) {
        window.__DEBUG_STATS__.drawCalls++;
        window.__DEBUG_STATS__.vertices += count * instanceCount;
        let baseTris = 0;
        if (mode === this.TRIANGLES) baseTris = count / 3;
        else if (mode === this.TRIANGLE_STRIP || mode === this.TRIANGLE_FAN)
          baseTris = Math.max(0, count - 2);

        window.__DEBUG_STATS__.triangles += baseTris * instanceCount;

        return originalDrawElementsInstanced.apply(this, arguments);
      };
    }

    if (proto.drawArraysInstanced) {
      const originalDrawArraysInstanced = proto.drawArraysInstanced;
      proto.drawArraysInstanced = function (mode, first, count, instanceCount) {
        window.__DEBUG_STATS__.drawCalls++;
        window.__DEBUG_STATS__.vertices += count * instanceCount;
        let baseTris = 0;
        if (mode === this.TRIANGLES) baseTris = count / 3;
        else if (mode === this.TRIANGLE_STRIP || mode === this.TRIANGLE_FAN)
          baseTris = Math.max(0, count - 2);

        window.__DEBUG_STATS__.triangles += baseTris * instanceCount;

        return originalDrawArraysInstanced.apply(this, arguments);
      };
    }

    // --- Texture State Changes ---

    const originalBindTexture = proto.bindTexture;
    proto.bindTexture = function (target, texture) {
      // Only count if it's a valid texture bind (ignoring null unbinds which happen during cleanup)
      if (texture) {
        window.__DEBUG_STATS__.textureBinds++;
      }
      return originalBindTexture.apply(this, arguments);
    };

    // --- VBO/VAO GPU Memory Tracking ---

    // We use a WeakMap to track WebGLBuffer byte sizes without causing memory leaks
    const bufferSizes = new WeakMap();

    const originalBufferData = proto.bufferData;
    proto.bufferData = function (target, sizeOrData, _usage) {
      // Find the currently bound buffer for this target
      const buffer = this.getParameter(
        target === this.ARRAY_BUFFER
          ? this.ARRAY_BUFFER_BINDING
          : target === this.ELEMENT_ARRAY_BUFFER
            ? this.ELEMENT_ARRAY_BUFFER_BINDING
            : null
      );

      if (buffer) {
        // Calculate size in bytes
        let bytes = 0;
        if (typeof sizeOrData === 'number') {
          bytes = sizeOrData;
        } else if (sizeOrData && sizeOrData.byteLength !== undefined) {
          bytes = sizeOrData.byteLength;
        }

        // Subtract old size if this buffer is being reallocated
        const oldSize = bufferSizes.get(buffer) || 0;
        window.__DEBUG_STATS__.vboMemoryBytes -= oldSize;

        // Add new size
        bufferSizes.set(buffer, bytes);
        window.__DEBUG_STATS__.vboMemoryBytes += bytes;
      }

      return originalBufferData.apply(this, arguments);
    };

    const originalDeleteBuffer = proto.deleteBuffer;
    proto.deleteBuffer = function (buffer) {
      if (buffer && bufferSizes.has(buffer)) {
        const size = bufferSizes.get(buffer);
        window.__DEBUG_STATS__.vboMemoryBytes -= size;
        bufferSizes.delete(buffer);
      }
      return originalDeleteBuffer.apply(this, arguments);
    };
  };

  // Monkey-patch WebGL 1 and 2
  if (typeof WebGLRenderingContext !== 'undefined')
    patchContext(WebGLRenderingContext);
  if (typeof WebGL2RenderingContext !== 'undefined')
    patchContext(WebGL2RenderingContext);

  console.log(
    '[WebGLTracker] Low-level WebGL hooking initialized successfully.'
  );
}
