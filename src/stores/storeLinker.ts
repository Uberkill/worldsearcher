// TODO(ts-migration): Replace `any` with proper store types when useStore.js is migrated
export let getNetworkStore = (): any => null;
export let getGameStore = (): any => null;

export const setNetworkStore = (store: any): void => {
  getNetworkStore = () => store;
};

export const setGameStore = (store: any): void => {
  getGameStore = () => store;
};
