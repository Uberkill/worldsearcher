import { getGameStore } from '../storeLinker';
import { playerPosition } from '../../globals';

export const createChunkActions = (set: any, get: any): Record<string, any> => ({
  processChunkQueue: () => {
     const state = get();
     if (state.inFlightChunkRequests >= state.MAX_CONCURRENT_CHUNK_REQUESTS || state.chunkQueue.length === 0) return;
     
     // Sort pendingChunkRequests by distance to player
     let px = 0, pz = 0;
     const useStore = (window as any).useStore || (typeof getGameStore === 'function' ? getGameStore() : null);
     if (useStore) {
        px = playerPosition.x;
        pz = playerPosition.z;
     }
     
     const sortedQueue = [...state.chunkQueue].sort((a, b) => {
        const [ax, az] = a.chunkKey.split(',').map(Number);
        const [bx, bz] = b.chunkKey.split(',').map(Number);
        const distA = Math.pow(ax * 16 - px, 2) + Math.pow(az * 16 - pz, 2);
        const distB = Math.pow(bx * 16 - px, 2) + Math.pow(bz * 16 - pz, 2);
        return distA - distB;
     });
     
     const nextReq = sortedQueue[0];
     
     set((prev: any) => ({ 
         chunkQueue: prev.chunkQueue.filter((r: any) => r.chunkKey !== nextReq.chunkKey),
         inFlightChunkRequests: prev.inFlightChunkRequests + 1,
         chunkRequests: { ...prev.chunkRequests, [nextReq.chunkKey]: nextReq.resolve }
     }));
     
     const hostConn = get().connections[0];
     
     const sendRequest = (retryCount = 0) => {
        try {
           hostConn.send({ type: 'REQUEST_CHUNK', chunkKey: nextReq.chunkKey });
        } catch(_e) {
           if (retryCount > 3) {
              nextReq.resolve('PRISTINE');
              set((prev: any) => {
                  const next = { ...prev.chunkRequests };
                  delete next[nextReq.chunkKey];
                  return { chunkRequests: next, inFlightChunkRequests: Math.max(0, prev.inFlightChunkRequests - 1) };
              });
              setTimeout(() => get().processChunkQueue(), 0);
              return;
           }
        }
        
        setTimeout(() => {
           const requests = get().chunkRequests;
           if (requests[nextReq.chunkKey]) {
              console.warn(`Chunk request timed out for ${nextReq.chunkKey}. Retrying (${retryCount + 1})...`);
              if (retryCount >= 4) { // Hard limit 5 retries (10s, 20s, 40s...)
                 console.error(`Chunk request FATAL timeout for ${nextReq.chunkKey}. Disconnecting to save data.`);
                 sessionStorage.setItem('kickReason', 'Network Sync Failure: Missing Chunks.');
                 window.location.reload();
                 return;
              }
              sendRequest(retryCount + 1);
           }
        }, 10000 * Math.pow(1.5, retryCount)); // Exponential backoff
     };
     sendRequest();
     
     get().processChunkQueue();
  },

  requestChunkFromHost: (chunkKey: string) => {
     return new Promise((resolve) => {
        const { connections, isHost } = get();
        if (isHost || connections.length === 0) {
           resolve('PRISTINE');
           return;
        }
        
        set((state: any) => ({ chunkQueue: [...state.chunkQueue, { chunkKey, resolve }] }));
        get().processChunkQueue();
     });
  }
});
