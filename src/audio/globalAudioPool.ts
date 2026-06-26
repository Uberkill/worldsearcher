// @ts-nocheck
// Global reference so non-React components can request spatial audio
export let globalAudioPool = null;

export const setGlobalAudioPool = (pool) => {
  globalAudioPool = pool;
};

