// @ts-nocheck
import { getGameStore } from '../storeLinker';

export const parseBinaryPacket = (data: ArrayBuffer | Uint8Array, set: any, get: any, senderConn?: any): void => {
    try {
        const isArrayBuffer = data instanceof ArrayBuffer;
        const buffer = isArrayBuffer ? data : data.buffer;
        const byteOffset = isArrayBuffer ? 0 : data.byteOffset;
        const byteLength = isArrayBuffer ? data.byteLength : data.byteLength;

        if (!buffer || byteLength < 1) return;

        const view = new DataView(buffer, byteOffset, byteLength);
        const typeByte = view.getUint8(0);

        if (typeByte === 1) { // PLAYER_MOVE
            // 1 type + 36 id + 20 coords (5 * float32) = 57 bytes minimum
            if (byteLength < 57) {
                console.warn(`[Network] Dropped truncated PLAYER_MOVE packet (len ${byteLength})`);
                return;
            }

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

            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(pitch) || !Number.isFinite(yaw)) {
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
                            x,
                            y,
                            z,
                            pitch,
                            yaw,
                            lastUpdate: Date.now(),
                            positionBuffer: newBuffer
                        }
                    }
                };
            });

            // Host relays Guest movement to all other peers via unreliable channels
            const state = typeof get === 'function' ? get() : null;
            if (state?.isHost && state?.unreliableConnections) {
                const rawPayload = buffer.slice(byteOffset, byteOffset + byteLength);
                state.unreliableConnections.forEach((conn: any) => {
                    if (conn.peer !== senderConn?.peer && conn.open) {
                        try {
                            conn.send(rawPayload);
                        } catch (e: any) {
                            console.warn('[Network] Movement relay dropped:', e.message);
                        }
                    }
                });
            }
            return;
        }

        if (typeByte === 2) { // BLOCK_DELTA
            // 1 type + 3 pad + 4 cx + 4 cz = 12 bytes minimum header
            if (byteLength < 12) {
                console.warn(`[Network] Dropped truncated BLOCK_DELTA packet (len ${byteLength})`);
                return;
            }

            const cx = view.getInt32(4, true);
            const cz = view.getInt32(8, true);

            const payloadBytes = byteLength - 12;
            const elementCount = Math.floor(payloadBytes / 4);
            const startByte = byteOffset + 12;

            let deltas: Uint32Array;
            if (startByte % 4 === 0) {
                deltas = new Uint32Array(buffer, startByte, elementCount);
            } else {
                // Handle unaligned frame slices safely without throwing RangeError
                const alignedBuffer = new ArrayBuffer(elementCount * 4);
                new Uint8Array(alignedBuffer).set(new Uint8Array(buffer, startByte, elementCount * 4));
                deltas = new Uint32Array(alignedBuffer);
            }

            const useStore = getGameStore();
            if (useStore) {
                useStore.getState().applyNetworkDelta(`${cx},${cz}`, Array.from(deltas));
            }

            // Host relays Guest block delta to all other peers via reliable connections
            const state = typeof get === 'function' ? get() : null;
            if (state?.isHost && state?.connections) {
                const rawPayload = buffer.slice(byteOffset, byteOffset + byteLength);
                state.connections.forEach((conn: any) => {
                    if (conn.peer !== senderConn?.peer && conn.open) {
                        try {
                            conn.send(rawPayload);
                        } catch (e: any) {
                            console.warn('[Network] Block delta relay dropped:', e.message);
                        }
                    }
                });
            }
            return;
        }

        if (typeByte === 3) { // ENTITY_STATE
            // 1 type + 1 subType + 2 count + 2 seq = 6 bytes header
            if (byteLength < 6) {
                console.warn(`[Network] Dropped truncated ENTITY_STATE packet (len ${byteLength})`);
                return;
            }

            const subType = view.getUint8(1);
            const count = view.getUint16(2, true);
            const packetSeq = view.getUint16(4, true);

            const expectedBytes = 6 + (count * 24);
            if (byteLength < expectedBytes) {
                console.warn(`[Network] Dropped truncated ENTITY_STATE payload: expected ${expectedBytes}, got ${byteLength}`);
                return;
            }

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
    } catch (err) {
        console.error('[Network] Fatal error parsing binary packet:', err);
    }
};
