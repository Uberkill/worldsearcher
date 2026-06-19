import { getGameStore } from '../storeLinker';

export const parseBinaryPacket = (data: ArrayBuffer | Uint8Array, set: any, get: any): void => {
    const buffer = data instanceof ArrayBuffer ? data : data.buffer;
    const typeByte = new Uint8Array(buffer)[0];
    const view = new DataView(buffer);
    
    if (typeByte === 1) { // PLAYER_MOVE
        let id = '';
        for (let i = 0; i < 36; i++) {
           const charCode = view.getUint8(1 + i);
           if (charCode !== 0) id += String.fromCharCode(charCode);
        }
        const x = view.getFloat32(37, true);
        const y = view.getFloat32(41, true);
        const z = view.getFloat32(45, true);
        const pitch = view.getFloat32(49, true);
        const yaw = view.getFloat32(53, true);
        
        if ((!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) || !Number.isFinite(pitch) || !Number.isFinite(yaw)) {
           console.error(`[Network] Dropped PLAYER_MOVE packet with NaN coordinates from ${id}`);
           return;
        }

        set((prev: any) => {
            const currentBuffer = prev.players[id]?.positionBuffer || [];
            const newBuffer = [...currentBuffer, { x, y, z, pitch, yaw, timestamp: Date.now() }];
            if (newBuffer.length > 5) newBuffer.shift();
            return {
                players: {
                   ...prev.players,
                   [id]: {
                      ...(prev.players[id] || {}),
                      positionBuffer: newBuffer
                   }
                }
            };
        });
        return;
    }
    
    if (typeByte === 2) { // BLOCK_DELTA
        const cx = view.getInt32(4, true);
        const cz = view.getInt32(8, true);
        const deltas = new Uint32Array(buffer, 12);
        const useStore = getGameStore();
        if (useStore) useStore.getState().applyNetworkDelta(`${cx},${cz}`, Array.from(deltas));
        return;
    }
    
    if (typeByte === 3) { // ENTITY_STATE
        const subType = view.getUint8(1);
        const count = view.getUint16(2, true);
        const packetSeq = view.getUint16(4, true);
        
        const entities = [];
        for (let i = 0; i < count; i++) {
            const offset = 6 + (i * 24);
            entities.push({
               id: view.getUint16(offset, true),
               mode: view.getUint8(offset + 2),
               health: view.getFloat32(offset + 4, true),
               x: view.getFloat32(offset + 8, true),
               y: view.getFloat32(offset + 12, true),
               z: view.getFloat32(offset + 16, true),
               yaw: view.getFloat32(offset + 20, true)
            });
        }
        
        set((prev: any) => ({
            enemySyncBuffers: {
                ...prev.enemySyncBuffers,
                [subType]: { entities, seq: packetSeq, timestamp: Date.now() }
            }
        }));
        return;
    }
};
