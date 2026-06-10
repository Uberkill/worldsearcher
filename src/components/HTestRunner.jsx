import React, { useEffect } from 'react';
import { useStore } from '../stores/useStore';
import * as THREE from 'three';

export const HTestRunner = () => {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const testMode = params.get('htest');

    if (!testMode) return;

    console.log(`[H-Test] Initializing test: ${testMode}`);

    if (testMode === 'load') {
      // H-Test Case 1: Extreme Load Generation
      // Spawn 500 entities and generate chunks rapidly
      let ticks = 0;
      const interval = setInterval(() => {
        ticks++;
        if (ticks > 500) {
          clearInterval(interval);
          console.log('[H-Test] Load test complete.');
          return;
        }
        // Teleport player rapidly to force chunk generation
        const { position } = useStore.getState();
        if (position) {
          useStore.setState({
            position: [position[0] + 16, position[1], position[2] + 16]
          });
        }
      }, 100);
    }

    if (testMode === 'memory') {
      // H-Test Case 2: Memory Creep and Disposal Validation
      // Constantly place and break blocks to trigger greedy meshing
      let cycle = 0;
      const interval = setInterval(() => {
        cycle++;
        if (cycle > 1000) {
          clearInterval(interval);
          console.log('[H-Test] Memory test complete.');
          return;
        }
        const x = Math.floor(Math.random() * 16);
        const y = 60 + Math.floor(Math.random() * 10);
        const z = Math.floor(Math.random() * 16);
        
        const setVoxelRaw = useStore.getState().setVoxelRaw;
        setVoxelRaw(x, y, z, 1);
        setTimeout(() => setVoxelRaw(x, y, z, 0), 50);

        if (cycle % 100 === 0) {
          console.log(`[H-Test] Memory test progress: ${cycle}/1000`);
        }
      }, 100);
    }

  }, []);

  return null;
};
