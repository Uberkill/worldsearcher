/// <reference types="vite/client" />

import type { StoreApi, UseBoundStore } from 'zustand';
import type { RootState } from './types/store';

declare global {
  interface Window {
    __USE_STORE__?: UseBoundStore<StoreApi<RootState>>;
    useStore?: UseBoundStore<StoreApi<RootState>>;
    worldsearchyouStore?: UseBoundStore<StoreApi<RootState>>;
    __DEBUG_PASS1_CACHE__?: unknown;
    spector?: unknown;
    gameActive?: boolean;
  }
}
