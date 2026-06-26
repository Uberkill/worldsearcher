// @ts-nocheck
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';

export const DebugTracker = () => {
  const { gl, scene, camera } = useThree();

  const frameTimes = useRef([]);
  const lastTime = useRef(0);
  const cpuStart = useRef(0);

  const extRef = useRef(null);
  const queryRef = useRef(null);
  const isQueryRunning = useRef(false);
  const isQueryActiveThisFrame = useRef(false);

  useEffect(() => {
    const glContext = gl.getContext();
    if (!glContext || glContext.isContextLost()) return;

    // Attempt to get the WebGL2 disjoint timer extension
    const ext = glContext.getExtension('EXT_disjoint_timer_query_webgl2');
    extRef.current = ext;

    // Expose for runtime diagnostics
    window.__THREE_GL__ = gl;
    window.__THREE_SCENE__ = scene;
    window.__THREE_CAMERA__ = camera;

    return () => {
      // Clean up WebGL resources on unmount/re-render to prevent leaks & HMR errors
      if (queryRef.current && glContext && !glContext.isContextLost()) {
        try {
          if (ext) {
            const activeQuery = glContext.getQuery(ext.TIME_ELAPSED_EXT, glContext.CURRENT_QUERY);
            if (activeQuery === queryRef.current) {
              glContext.endQuery(ext.TIME_ELAPSED_EXT);
            }
          }
          glContext.deleteQuery(queryRef.current);
        } catch (e) {
          console.warn('[DebugTracker] Cleanup failed:', e);
        }
        queryRef.current = null;
      }
      isQueryRunning.current = false;
      isQueryActiveThisFrame.current = false;
    };
  }, [gl, scene, camera]);

  // Priority -1: Initialize frame stats and start the GPU query
  useFrame(() => {
    cpuStart.current = performance.now();

    if (!window.__DEBUG_STATS__) return;
    const stats = window.__DEBUG_STATS__;

    // Reset stats at the start of the frame
    stats.drawCalls = 0;
    stats.triangles = 0;
    stats.vertices = 0;
    stats.textureBinds = 0;
    stats.chunksRendered = 0;
    stats.entitiesRendered = 0;
    stats.totalEntities = 0;

    // Reset Three.js internal render counters so we can detect if a render occurred
    gl.info.render.calls = 0;
    gl.info.render.triangles = 0;
    gl.info.render.points = 0;

    const glContext = gl.getContext();
    const ext = extRef.current;

    if (ext && !glContext.isContextLost()) {
      if (!queryRef.current) {
        queryRef.current = glContext.createQuery();
      }

      // If no query is currently in flight, we can start a new one
      if (!isQueryRunning.current) {
        glContext.beginQuery(ext.TIME_ELAPSED_EXT, queryRef.current);
        isQueryActiveThisFrame.current = true;
      }
    }
  }, -1);

  // Priority 10: End the query, handle fallbacks, and gather metrics
  useFrame(() => {
    if (!window.__DEBUG_STATS__) return;
    const stats = window.__DEBUG_STATS__;

    const glContext = gl.getContext();
    const ext = extRef.current;

    // --- Safeguard: Fallback Render ---
    // If no other component (like EffectComposer) rendered the scene, we must do it ourselves
    if (gl.info.render.calls === 0) {
      gl.render(scene, camera);
    }

    // --- GPU Timer Query Reading ---
    if (ext && !glContext.isContextLost()) {
      // If we started a query this frame, end it now
      if (isQueryActiveThisFrame.current) {
        glContext.endQuery(ext.TIME_ELAPSED_EXT);
        isQueryRunning.current = true;
        isQueryActiveThisFrame.current = false;
      }

      // Read query asynchronously when available
      if (isQueryRunning.current && queryRef.current) {
        const available = glContext.getQueryParameter(
          queryRef.current,
          glContext.QUERY_RESULT_AVAILABLE
        );
        const disjoint = glContext.getParameter(ext.GPU_DISJOINT_EXT);

        if (available) {
          if (!disjoint) {
            const timeElapsed = glContext.getQueryParameter(
              queryRef.current,
              glContext.QUERY_RESULT
            );
            stats.gpuTime = timeElapsed / 1000000; // Nanoseconds -> Milliseconds
          }
          isQueryRunning.current = false; // Ready for the next query
        }
      }
    } else {
      stats.gpuTime = 0; // Timer queries unsupported or context lost
    }

    // --- WebGL Metrics ---
    // Fall back to Three.js counters only if the WebGLTracker monkey-patch is inactive
    if (stats.drawCalls === 0) {
      stats.drawCalls = gl.info.render.calls;
      stats.triangles = gl.info.render.triangles;
      stats.vertices = gl.info.render.triangles * 3; // Best approximation without vertex counts
      stats.textureBinds = gl.info.memory.textures; // Memory-allocated textures count
    }
    stats.geometries = gl.info.memory.geometries;

    // --- CPU Time Tracking ---
    if (lastTime.current === 0) lastTime.current = performance.now();
    const now = performance.now();
    const cpuTime = now - cpuStart.current;

    frameTimes.current.push(cpuTime);
    if (frameTimes.current.length > 30) frameTimes.current.shift();

    const sum = frameTimes.current.reduce((a, b) => a + b, 0);
    stats.cpuTime = sum / frameTimes.current.length;

    const frameDelta = now - lastTime.current;
    lastTime.current = now;

    if (frameDelta > 0) {
      stats.fps = Math.round(1000 / frameDelta);
    }
  }, 10);

  return null;
};

