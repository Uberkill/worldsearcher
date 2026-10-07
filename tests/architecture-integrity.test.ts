import { describe, it, expect } from 'vitest';
import { useStore } from '../src/stores/useStore';

describe('Core Engine Architectural Integrity', () => {
  it('Core Zustand ECS constraints and state contracts remain intact', () => {
    const state = useStore.getState();

    // Verify critical world and entity properties
    expect(state).toHaveProperty('isWorldReady');
    expect(state).toHaveProperty('playerPower');
    expect(state).toHaveProperty('authoritativeSkills');
    
    // Verify vehicle and transit state contracts
    expect(state).toHaveProperty('isTransitMode');
    expect(state).toHaveProperty('shipTransform');
  });
});
