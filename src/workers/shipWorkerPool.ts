let sharedShipWorker: Worker | null = null;

export const getShipWorker = () => {
    if (typeof window === 'undefined') return null;
    if (!sharedShipWorker) {
        sharedShipWorker = new Worker(new URL('./shipWorker.js', import.meta.url), { type: 'module' });
    }
    return sharedShipWorker;
};
