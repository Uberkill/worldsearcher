// @ts-nocheck
import { useChunkStore } from '../chunkSlice';
import { useInventoryStore } from '../inventorySlice';
import { useEnvironmentStore } from '../environmentSlice';
import { useFlareStore } from '../flareSlice';
import { worldState } from './sharedState';

import type { RootState } from '../../types/store';

let currentRawGet = null;

const getStoreKeys = (store: any) => new Set(Object.keys(store.getState()));

let chunkKeys: Set<string>;
let inventoryKeys: Set<string>;
let envKeys: Set<string>;
let flareKeys: Set<string>;

const ensureKeys = () => {
  if (!chunkKeys) {
    chunkKeys = getStoreKeys(useChunkStore);
    inventoryKeys = getStoreKeys(useInventoryStore);
    envKeys = getStoreKeys(useEnvironmentStore);
    flareKeys = getStoreKeys(useFlareStore);
  }
};

const staticWorldProxy = new Proxy({}, {
  get: (target, prop) => {
    ensureKeys();
    if (chunkKeys.has(prop as string)) return useChunkStore.getState()[prop];
    if (inventoryKeys.has(prop as string)) return useInventoryStore.getState()[prop];
    if (envKeys.has(prop as string)) return useEnvironmentStore.getState()[prop];
    if (flareKeys.has(prop as string)) return useFlareStore.getState()[prop];
    return currentRawGet ? currentRawGet()[prop] : undefined;
  }
});

const getCombinedState = (rawGet: any): RootState => {
  currentRawGet = rawGet;
  return staticWorldProxy as unknown as RootState;
};

export function applyStranglerPatch(__patch: any, rawSet: any) {
    if (!__patch) return;
    ensureKeys();
    const cPatch: any = {};
    const iPatch: any = {};
    const ePatch: any = {};
    const fPatch: any = {};
    const rPatch: any = {};

    for (const [key, val] of Object.entries(__patch)) {
      if (key === '_meta') continue;
      if (chunkKeys.has(key)) cPatch[key] = val;
      else if (inventoryKeys.has(key)) iPatch[key] = val;
      else if (envKeys.has(key)) ePatch[key] = val;
      else if (flareKeys.has(key)) fPatch[key] = val;
      else rPatch[key] = val;
    }

    if (Object.keys(cPatch).length > 0) useChunkStore.setState(cPatch);
    if (Object.keys(iPatch).length > 0) useInventoryStore.setState(iPatch);
    if (Object.keys(ePatch).length > 0) useEnvironmentStore.setState(ePatch);
    if (Object.keys(fPatch).length > 0) useFlareStore.setState(fPatch);
    if (Object.keys(rPatch).length > 0) rawSet(rPatch);
}

export { getCombinedState };
