export let getNetworkStore = () => null;
export let getGameStore = () => null;

export const setNetworkStore = (store) => {
  getNetworkStore = () => store;
};

export const setGameStore = (store) => {
  getGameStore = () => store;
};
