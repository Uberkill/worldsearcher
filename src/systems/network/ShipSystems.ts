// @ts-nocheck
/* eslint-disable no-unused-vars */
import { NetworkEventBus } from '../../utils/NetworkEventBus';
import { BlockKeyById } from '../../registry/BlockRegistry';
import { getGameStore, getNetworkStore } from '../../stores/storeLinker';
import { useInventoryStore } from '../../stores/inventorySlice';
import { useChunkStore } from '../../stores/chunkSlice';
import { _playerPosition, _playerRotation } from '../../globals';

const initializeShipSystems = () => {
    NetworkEventBus.on('SHIP_BUFFER_SYNC', (payload) => {
        const { data, senderConn: _senderConn, getNetworkState, setNetworkState } = payload;
        const get = getNetworkState;
        const _set = setNetworkState;
        const _state = get();

      const useStore = getGameStore();
      if (useStore && data.shipBufferRLE) {
          const buffer = new Uint32Array(32768);
          const rle = data.shipBufferRLE;
          let idx = 0;
          for (let i = 0; i < rle.length; i += 2) {
              const val = rle[i];
              const count = rle[i+1];
              if (idx < 32768) {
                  buffer.fill(val, idx, Math.min(idx + count, 32768));
                  idx += count;
              }
          }
          useStore.getState().setShipBufferRaw(buffer);
          useStore.setState({ isShipActive: true });
      }
    
    });
    NetworkEventBus.on('SHIP_TRANSFORM', (payload) => {
        const { data, senderConn: _senderConn, getNetworkState, setNetworkState } = payload;
        const get = getNetworkState;
        const _set = setNetworkState;
        const _state = get();

        const useStore = getGameStore();
        if (useStore) {
            useStore.getState().setShipTransform('default', data.position, data.rotation);
            useStore.setState({ isShipActive: true });
        }
    
    });
    NetworkEventBus.on('REQUEST_HELM', (payload) => {
        const { data, senderConn, getNetworkState, setNetworkState } = payload;
        const get = getNetworkState;
        const _set = setNetworkState;
        const state = get();

       if (!state.isHost) return;
       const useStore = getGameStore();
       if (!useStore) return;
       const currentHelm = useStore.getState().shipHelmPlayerId;
       const reqId = data.playerId || (senderConn ? senderConn.metadata?.playerId : state.playerId);
       if (!currentHelm || data.force) {
           useStore.getState().setShipHelmPlayerId(reqId);
           state.broadcastEvent({ type: 'HELM_UPDATE', playerId: reqId });
           if (reqId === state.playerId) {
               useStore.setState({ isSeated: true });
           }
       }
    
    });
    NetworkEventBus.on('RELEASE_HELM', (payload) => {
        const { data, senderConn, getNetworkState, setNetworkState } = payload;
        const get = getNetworkState;
        const _set = setNetworkState;
        const state = get();

       if (!state.isHost) return;
       const useStore = getGameStore();
       if (!useStore) return;
       const currentHelm = useStore.getState().shipHelmPlayerId;
       const reqId = data.playerId || (senderConn ? senderConn.metadata?.playerId : state.playerId);
       if (currentHelm === reqId) {
           useStore.getState().setShipHelmPlayerId(null);
           state.broadcastEvent({ type: 'HELM_UPDATE', playerId: null });
           if (reqId === state.playerId) {
               useStore.setState({ isSeated: false });
           }
       }
    
    });
    NetworkEventBus.on('HELM_UPDATE', (payload) => {
        const { data, senderConn: _senderConn, getNetworkState, setNetworkState } = payload;
        const get = getNetworkState;
        const _set = setNetworkState;
        const state = get();

       const useStore = getGameStore();
       if (!useStore) return;
       const wasHelm = useStore.getState().shipHelmPlayerId === state.playerId;
       useStore.getState().setShipHelmPlayerId(data.playerId);
       
       if (data.playerId === state.playerId) {
           useStore.setState({ isSeated: true });
       } else if (wasHelm && data.playerId !== state.playerId) {
           useStore.setState({ isSeated: false });
       }
    
    });
    NetworkEventBus.on('SHIP_STEER_INTENT', (payload) => {
        const { data, senderConn, getNetworkState, setNetworkState } = payload;
        const get = getNetworkState;
        const _set = setNetworkState;
        const state = get();

       const useStore = getGameStore();
       if (useStore && state.isHost) {
           const id = data.playerId || (senderConn ? senderConn.metadata?.playerId : state.playerId);
           useStore.getState().setShipSteerIntent(id, data);
       }
    
    });
    NetworkEventBus.on('LAUNCH_SHIP_INTENT', (payload) => {
        const { data, senderConn: _senderConn, getNetworkState, setNetworkState } = payload;
        const get = getNetworkState;
        const _set = setNetworkState;
        const state = get();

         if (!state.isHost) return;
         const useStore = getGameStore();
         if (useStore) {
            const cx = Math.floor(data.pos[0]);
            const cy = Math.floor(data.pos[1]);
            const cz = Math.floor(data.pos[2]);

            const SHIP_SIZE_X = 32, SHIP_SIZE_Y = 32, SHIP_SIZE_Z = 32;
            const SHIP_CENTER_X = 16, SHIP_CENTER_Y = 16, SHIP_CENTER_Z = 16;
            const buffer = new Uint32Array(SHIP_SIZE_X * SHIP_SIZE_Y * SHIP_SIZE_Z);
            
            const blocksToRemove = [];
            const worldState = useStore.getState();
            const invState = useInventoryStore.getState();
            let nextChests = { ...invState.chests };
            let nextMachines = { ...invState.machines };
            let inventoryChanged = false;

            const getBlock = (wx, wy, wz) => {
                const chunkX = Math.floor(wx / 16);
                const chunkZ = Math.floor(wz / 16);
                const chunkKey = `${chunkX},${chunkZ}`;
                const chunk = useChunkStore.getState().chunks[chunkKey];
                if (!chunk || !chunk.buffer) return -1;
                const lx = (wx % 16 + 16) % 16;
                const lz = (wz % 16 + 16) % 16;
                if (wy < 0 || wy >= 512) return -1;
                return chunk.buffer[wy * 256 + lz * 16 + lx];
            };

            for (let x = 0; x < SHIP_SIZE_X; x++) {
                for (let y = 0; y < SHIP_SIZE_Y; y++) {
                    for (let z = 0; z < SHIP_SIZE_Z; z++) {
                        const wx = cx + (x - SHIP_CENTER_X);
                        const wy = cy + (y - SHIP_CENTER_Y);
                        const wz = cz + (z - SHIP_CENTER_Z);
                        
                        const val = getBlock(wx, wy, wz);
                        if (val > 0) {
                            const tex = val & 0xff;
                            const key = BlockKeyById[tex];
                            if (key && !['grass', 'dirt', 'stone', 'sand', 'bedrock', 'water'].includes(key)) {
                                const idx = y * (SHIP_SIZE_X * SHIP_SIZE_Z) + z * SHIP_SIZE_X + x;
                                buffer[idx] = val;
                                blocksToRemove.push({ x: wx, y: wy, z: wz });

                                if (key === 'chest' || key === 'ship_furnace') {
                                    const worldKey = `${wx},${wy},${wz}`;
                                    const shipKey = `ship_${x}_${y}_${z}`;
                                    if (nextChests[worldKey]) {
                                        nextChests[shipKey] = nextChests[worldKey];
                                        delete nextChests[worldKey];
                                        inventoryChanged = true;
                                    }
                                    if (nextMachines[worldKey]) {
                                        nextMachines[shipKey] = nextMachines[worldKey];
                                        delete nextMachines[worldKey];
                                        inventoryChanged = true;
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if (inventoryChanged) {
                useInventoryStore.setState({ chests: nextChests, machines: nextMachines });
                get().broadcastEvent({ type: 'INVENTORY_SYNC', chests: nextChests, machines: nextMachines });
            }

            if (blocksToRemove.length > 0) {
                worldState.removeCubesBulk(blocksToRemove, true, null);
            }

            worldState.setShipBufferRaw(buffer);
            const shipPos = [cx, cy + 15, cz];
            worldState.setShipTransform('default', shipPos, [0, 0, 0]);
            get().broadcastEvent({ type: 'SHIP_TRANSFORM', position: shipPos, rotation: [0, 0, 0] });
            
            const rle = [];
            let currentVal = buffer[0];
            let count = 0;
            for (let i = 0; i < buffer.length; i++) {
                if (buffer[i] === currentVal) {
                    count++;
                } else {
                    rle.push(currentVal, count);
                    currentVal = buffer[i];
                    count = 1;
                }
            }
            rle.push(currentVal, count);
            get().broadcastEvent({ type: 'SHIP_BUFFER_SYNC', shipBufferRLE: rle });
         }
    
    });

    NetworkEventBus.on('OUTBOUND_SHIP_CRITICAL_ALERT', (payload) => {
        const net = getNetworkStore()?.getState();
        if (!net) return;
        net.addChatMessage(payload.message, 'system', 'System');
        net.broadcastEvent({ type: 'CHAT_MESSAGE', message: payload.message, author: 'System' });
    });

    NetworkEventBus.on('OUTBOUND_SHIP_DAMAGE', (payload) => {
        const net = getNetworkStore()?.getState();
        if (!net) return;
        if (net.isHost) {
            net.broadcastEvent({ type: 'SHIP_HEALTH_UPDATE', health: payload.newHealth });
        } else {
            net.connections[0]?.send({ type: 'SHIP_DAMAGE_INTENT', amount: payload.amount });
        }
    });

    NetworkEventBus.on('OUTBOUND_SHIP_HEAL', (payload) => {
        const net = getNetworkStore()?.getState();
        if (!net) return;
        if (net.isHost) {
            net.broadcastEvent({ type: 'SHIP_HEALTH_UPDATE', health: payload.newHealth });
        } else {
            net.connections[0]?.send({ type: 'SHIP_HEAL_INTENT', amount: payload.amount });
        }
    });

    NetworkEventBus.on('OUTBOUND_SHIP_DECONSTRUCT', (payload) => {
        const net = getNetworkStore()?.getState();
        if (!net) return;
        net.handleNetworkData({ type: 'RELEASE_HELM', playerId: payload.helmPlayerId });
    });

    NetworkEventBus.on('OUTBOUND_SHIP_SEAT_DESTROYED', (payload) => {
        const net = getNetworkStore()?.getState();
        if (!net) return;
        const intent = { type: 'RELEASE_HELM', playerId: payload.helmPlayerId };
        net.broadcastEvent(intent);
        if (net.isHost) net.handleNetworkData(intent);
    });

    NetworkEventBus.on('OUTBOUND_SHORT_WARP_INTENT', (payload) => {
        const net = getNetworkStore()?.getState();
        if (!net) return;
        const intent = { type: 'SHORT_WARP_INTENT', x: payload.x, z: payload.z };
        if (net.isHost) {
            net.handleNetworkData(intent, { peer: 'local' });
        } else {
            net.connections[0]?.send(intent);
        }
    });
};


initializeShipSystems();

