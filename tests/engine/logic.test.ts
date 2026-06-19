import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../../src/stores/useStore';

describe('Engine Headless Testing: Player and Ship Logic', () => {
  beforeEach(() => {
    // Reset any state needed before tests
    useStore.setState({
      playerPower: 100,
      playerMaxPower: 100,
      isTransitMode: false,
      gameMode: 'survival'
    });
  });

  it('Player power drains and recharges correctly', () => {
    const { drainPower, rechargePower } = useStore.getState();
    
    expect(typeof drainPower).toBe('function');
    
    drainPower(50);
    expect(useStore.getState().playerPower).toBe(50);
    
    rechargePower(100);
    // Should cap at playerMaxPower (100)
    expect(useStore.getState().playerPower).toBe(100);
  });

  it('Ship warp state transitions', () => {
    const { toggleTransitMode } = useStore.getState();
    
    expect(typeof toggleTransitMode).toBe('function');
    expect(useStore.getState().isTransitMode).toBe(false);
    
    // Transition to jumping
    toggleTransitMode();
    expect(useStore.getState().isTransitMode).toBe(true);
  });
});
