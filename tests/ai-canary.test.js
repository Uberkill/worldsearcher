import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { useStore } from '../src/stores/useStore';

describe('AI Canary / Architectural Integrity', () => {
  it('Canary Tracker must be properly formatted and versioned', () => {
    const canaryPath = path.resolve(__dirname, '../docs/canary_tracker.json');
    expect(fs.existsSync(canaryPath)).toBe(true);

    const data = JSON.parse(fs.readFileSync(canaryPath, 'utf8'));
    
    // If an AI hallucinates or forgets to update this on core changes, 
    // it violates the AI_AGENT_WARNINGS.md rules.
    expect(typeof data.version).toBe('number');
    expect(data.version).toBeGreaterThanOrEqual(1);
    expect(typeof data.last_updated_by).toBe('string');
    expect(typeof data.reason).toBe('string');
  });

  it('Core Zustand ECS constraints must remain intact', () => {
    // We instantiate the store to ensure it hasn't been fatally broken
    const state = useStore.getState();

    // Critical structural checks (if AI changes these without knowing, it breaks the engine)
    expect(state).toHaveProperty('isWorldReady');
    expect(state).toHaveProperty('playerPower');
    expect(state).toHaveProperty('authoritativeSkills');
    
    // Ship slice checks
    expect(state).toHaveProperty('isTransitMode');
    expect(state).toHaveProperty('shipTransform');
  });
});
