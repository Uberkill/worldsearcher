import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

// The new modular slice for Environment logic
export const useEnvironmentStore = create(subscribeWithSelector((set, get) => ({
  worldTime: 12.0,
  daysElapsed: 1,
  isRaining: false,
  isNightTime: false,

  setWorldTime: (time, day, isRainingOverride = undefined) => {
    let newRaining;
    set((state) => {
      newRaining = isRainingOverride !== undefined ? isRainingOverride : state.isRaining;
      if (isRainingOverride === undefined && Math.floor(time) !== Math.floor(state.worldTime)) {
        if (Math.random() < 0.1) {
          newRaining = !newRaining;
        }
      }
      return { worldTime: time, daysElapsed: day, isRaining: newRaining };
    });
    return newRaining;
  },
  
  // Shadow state validator
  validateStateParity: (oldState) => {
    const state = get();
    if (state.worldTime !== oldState.worldTime) console.warn('[State Parity Error] worldTime mismatch:', state.worldTime, oldState.worldTime);
    if (state.daysElapsed !== oldState.daysElapsed) console.warn('[State Parity Error] daysElapsed mismatch:', state.daysElapsed, oldState.daysElapsed);
    if (state.isRaining !== oldState.isRaining) console.warn('[State Parity Error] isRaining mismatch:', state.isRaining, oldState.isRaining);
  }
})));
