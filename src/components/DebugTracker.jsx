import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';

export const DebugTracker = () => {
  const { gl, scene, camera } = useThree();
  
  const frameTimes = useRef([]);
  const lastTime = useRef(performance.now());
  const cpuStart = useRef(0);
  

  const extRef = useRef(null);
  const queryRef = useRef(null);
  const isQueryRunning = useRef(false);

  useEffect(() => {
    // Attempt to get the WebGL2 disjoint timer extension
    const glContext = gl.getContext();
    extRef.current = glContext.getExtension('EXT_disjoint_timer_query_webgl2');
  }, [gl]);

  // Priority -1 runs first in the frame loop
  useFrame(() => {
    cpuStart.current = performance.now();
    
    if (window.__DEBUG_STATS__) {
      // Reset our custom WebGL tracker counters to 0 at the start of the frame.
      window.__DEBUG_STATS__.drawCalls = 0;
      window.__DEBUG_STATS__.triangles = 0;
      window.__DEBUG_STATS__.vertices = 0;
      window.__DEBUG_STATS__.textureBinds = 0;
      
      window.__DEBUG_STATS__.chunksRendered = 0;
      window.__DEBUG_STATS__.entitiesRendered = 0;
      window.__DEBUG_STATS__.totalEntities = 0; // Will be summed up by SwarmManagers
    }
  }, -1);

  // Priority 1 runs last, and intercepts the default R3F render call
  useFrame(() => {
    if (!window.__DEBUG_STATS__) return;
    
    const stats = window.__DEBUG_STATS__;
    const glContext = gl.getContext();
    const ext = extRef.current;

    // --- GPU Render Tracking ---
    if (ext) {
      if (!queryRef.current) queryRef.current = glContext.createQuery();
      
      // If previous query is done, read it
      if (isQueryRunning.current) {
        const available = glContext.getQueryParameter(queryRef.current, glContext.QUERY_RESULT_AVAILABLE);
        const disjoint = glContext.getParameter(ext.GPU_DISJOINT_EXT);

        if (available && !disjoint) {
          const timeElapsed = glContext.getQueryParameter(queryRef.current, glContext.QUERY_RESULT);
          stats.gpuTime = timeElapsed / 1000000; // Convert nanoseconds to milliseconds
          isQueryRunning.current = false;
        }
      }

      // Start new query (or fallback render)
      if (!isQueryRunning.current) {
        glContext.beginQuery(ext.TIME_ELAPSED_EXT, queryRef.current);
        gl.render(scene, camera);
        glContext.endQuery(ext.TIME_ELAPSED_EXT);
        isQueryRunning.current = true;
      } else {
        // Query still pending – render without starting a new query
        gl.render(scene, camera);
      }
    } else {
      // Fallback: No WebGL2 Timer Support
      gl.render(scene, camera);
    }

    // --- WebGL Metrics ---
    // Extract stats natively from Three.js instead of double-hooking the context
    stats.drawCalls = gl.info.render.calls;
    stats.triangles = gl.info.render.triangles;
    stats.vertices = gl.info.render.points;
    stats.textureBinds = gl.info.memory.textures;
    stats.geometries = gl.info.memory.geometries;

    // --- CPU Time Tracking ---
    const now = performance.now();
    const cpuTime = now - cpuStart.current;
    
    frameTimes.current.push(cpuTime);
    if (frameTimes.current.length > 30) frameTimes.current.shift();
    
    // Calculate rolling average
    let sum = 0;
    for (let i = 0; i < frameTimes.current.length; i++) {
        sum += frameTimes.current[i];
    }
    const avgCpuTime = sum / frameTimes.current.length;
    
    // The total time elapsed between frames (including VSync/GPU wait) for FPS calc
    const frameDelta = now - lastTime.current;
    lastTime.current = now;
    
    stats.cpuTime = avgCpuTime;
    
    // FPS is 1000ms / actual frame delta (not cpu delta)
    if (frameDelta > 0) {
      stats.fps = Math.round(1000 / frameDelta);
    }

  }, 1);

  return null;
};
