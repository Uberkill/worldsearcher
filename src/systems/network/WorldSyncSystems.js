/* eslint-disable no-unused-vars */
import { NetworkEventBus } from '../../utils/NetworkEventBus';
import { getGameStore } from '../../stores/storeLinker';
import { useInventoryStore } from '../../stores/inventorySlice';
import { useChunkStore } from '../../stores/chunkSlice';
import { compressRLE, decompressRLE } from '../../utils/db';

const initializeWorldSyncSystems = () => {
    NetworkEventBus.on('WORLD_SYNC', (payload) => {
        const { data, senderConn, getNetworkState, setNetworkState } = payload;
        const get = getNetworkState;
        const set = setNetworkState;
        const state = get();

      const useStore = getGameStore();
      if (useStore) {
        useStore.getState().applyWorldSync({ [data.chunkKey]: data.buffer });
      }
    });

    NetworkEventBus.on('REQUEST_CHUNK', (payload) => {
        const { data, senderConn, getNetworkState } = payload;
        const state = getNetworkState();
        
        if (state.isHost) {
            const useStore = getGameStore();
            if (useStore) {
               const chunk = useChunkStore.getState().chunks[data.chunkKey];
               if (chunk && chunk.isModified && chunk.buffer) {
                   compressRLE(chunk.buffer).then(rle => {
                       try { senderConn.send({ type: 'WORLD_SYNC_RLE', chunkKey: data.chunkKey, rle }); } catch { /* ignore */ }
                   });
               } else if (chunk && !chunk.isModified) {
                   try { senderConn.send({ type: 'CHUNK_PRISTINE', chunkKey: data.chunkKey }); } catch { /* ignore */ }
               } else {
                   import('../../utils/db').then(({ loadChunkFromDB }) => {
                      loadChunkFromDB(data.chunkKey).then(dbChunk => {
                         if (dbChunk && dbChunk.isModified && dbChunk.buffer) {
                             compressRLE(dbChunk.buffer).then(rle => {
                                 try { senderConn.send({ type: 'WORLD_SYNC_RLE', chunkKey: data.chunkKey, rle }); } catch { /* ignore */ }
                             });
                         } else {
                             try { senderConn.send({ type: 'CHUNK_PRISTINE', chunkKey: data.chunkKey }); } catch { /* ignore */ }
                         }
                      });
                   });
               }
            }
         }
    });

    NetworkEventBus.on('CHUNK_PRISTINE', (payload) => {
        const { data, getNetworkState, setNetworkState } = payload;
        const state = getNetworkState();
        const set = setNetworkState;
        const get = getNetworkState;

        const resolver = state.chunkRequests[data.chunkKey];
        if (resolver) {
            resolver('PRISTINE');
            set(prev => {
                const next = { ...prev.chunkRequests };
                delete next[data.chunkKey];
                return { chunkRequests: next, inFlightChunkRequests: Math.max(0, prev.inFlightChunkRequests - 1) };
            });
            get().processChunkQueue();
        }
    });

    NetworkEventBus.on('WORLD_SYNC_RLE', (payload) => {
        const { data, getNetworkState, setNetworkState } = payload;
        const state = getNetworkState();
        const set = setNetworkState;
        const get = getNetworkState;

        decompressRLE(data.rle).then(decompressed => {
             const resolver = state.chunkRequests[data.chunkKey];
             if (resolver) {
                resolver(decompressed.buffer);
                set(prev => {
                   const next = { ...prev.chunkRequests };
                   delete next[data.chunkKey];
                   return { chunkRequests: next, inFlightChunkRequests: Math.max(0, prev.inFlightChunkRequests - 1) };
                });
                get().processChunkQueue();
                
                // Process queued deltas STRICTLY after resolution
                const queued = get().queuedDeltas[data.chunkKey];
                if (queued && queued.length > 0) {
                    const useStore = getGameStore();
                    if (useStore) {
                        queued.forEach(delta => useStore.getState().applyNetworkDelta(data.chunkKey, delta));
                    }
                    set(prev => {
                        const nextQ = { ...prev.queuedDeltas };
                        delete nextQ[data.chunkKey];
                        return { queuedDeltas: nextQ };
                    });
                }
             }
         });
    });
};

initializeWorldSyncSystems();

