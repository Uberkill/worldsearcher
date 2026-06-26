// @ts-nocheck
import { tickFluids } from '../../utils/fluidSystem';

export const createFluidSimulation = (rawSet, rawGet) => {
  const set = rawSet;
  const get = rawGet;
  return {
tickFluids: () => tickFluids(rawGet, rawSet),
  };
};
