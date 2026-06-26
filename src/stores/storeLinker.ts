import type { StoreApi, UseBoundStore } from 'zustand';
import type { RootState } from '../types/store';

export let getNetworkStore = (): unknown => null;
export let getGameStore = (): UseBoundStore<StoreApi<RootState>> | null => null;

export const setNetworkStore = (store: unknown): void => {
  getNetworkStore = () => store;
};

export const setGameStore = (store: UseBoundStore<StoreApi<RootState>>): void => {
  getGameStore = () => store;
};
