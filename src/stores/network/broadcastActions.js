// Module-level singleton buffer for zero-allocation broadcasting
const movementBuffer = new ArrayBuffer(64);
const movementView = new DataView(movementBuffer);

export const createBroadcastActions = (set, get) => ({
  broadcastMovement: (playerId, x, y, z, rx, ry, rz) => {
    // Phase 2: NaN Network Contagion Preventer
    if (
      !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) ||
      !Number.isFinite(rx) || !Number.isFinite(ry) || !Number.isFinite(rz)
    ) {
      console.warn('[Network Sanitizer] Dropped outbound movement packet containing NaN');
      return;
    }

    const { unreliableConnections } = get();
    if (!unreliableConnections || unreliableConnections.length === 0) return;
    
    movementView.setUint8(0, 1);
    for (let i = 0; i < 36; i++) {
       movementView.setUint8(1 + i, i < playerId.length ? playerId.charCodeAt(i) : 0);
    }
    
    movementView.setFloat32(37, x, true);
    movementView.setFloat32(41, y, true);
    movementView.setFloat32(45, z, true);
    movementView.setFloat32(49, rx, true);
    movementView.setFloat32(53, ry, true);
    movementView.setFloat32(57, rz, true);
    
    if (typeof window.__packetSeq === 'undefined') window.__packetSeq = 0;
    movementView.setUint16(61, window.__packetSeq++, true);
    
    const state = get();
    unreliableConnections.forEach(conn => {
       const guestId = conn.metadata?.playerId;
       if (guestId && state.players[guestId]) {
          const guestPos = state.players[guestId];
          const dx = guestPos.x - x;
          const dy = guestPos.y - y;
          const dz = guestPos.z - z;
          const distSq = dx*dx + dy*dy + dz*dz;
          
          if (distSq > 16384) { // > 128 blocks away: CULL
             return; 
          }
          if (distSq > 1024) { // > 32 blocks away: THROTTLE (1 in 4)
             if (Math.random() > 0.25) return;
          }
       }
       
       try { conn.send(movementBuffer); } catch(e) { console.warn("[Network] Dropped binary packet/action:", e.message); }
    });
  },

  broadcastEntityState: (subType, entities) => {
    const { unreliableConnections, isHost } = get();
    if (unreliableConnections.length === 0 || !isHost) return;
    
    const count = entities.length;
    const buffer = new ArrayBuffer(6 + (count * 24));
    const view = new DataView(buffer);
    
    view.setUint8(0, 3); // Type 3: ENTITY_STATE_SYNC
    view.setUint8(1, subType);
    view.setUint16(2, count, true);
    
    if (typeof window.__packetSeq === 'undefined') window.__packetSeq = 0;
    view.setUint16(4, window.__packetSeq++, true);
    
    for (let i = 0; i < count; i++) {
       const offset = 6 + (i * 24);
       const ent = entities[i];
       view.setUint16(offset, ent.id, true);
       view.setUint8(offset + 2, ent.mode);
       view.setFloat32(offset + 4, ent.health, true);
       view.setFloat32(offset + 8, ent.x, true);
       view.setFloat32(offset + 12, ent.y, true);
       view.setFloat32(offset + 16, ent.z, true);
       view.setFloat32(offset + 20, ent.yaw, true);
    }
    
    unreliableConnections.forEach(conn => {
       try { conn.send(buffer); } catch(e) { console.warn("[Network] Dropped binary packet/action:", e.message); }
    });
  },
  
  broadcastEvent: (data) => {
    const { connections } = get();
    if (connections.length === 0) return;
    connections.forEach(conn => {
      try { conn.send(data); } catch(e) { console.warn("[Network] Dropped binary packet/action:", e.message); }
    });
  },
  
  broadcastDelta: (chunkKey, deltas) => {
     const { connections } = get();
     if (connections.length === 0) return;
     
     if (!window.__PENDING_DELTAS) window.__PENDING_DELTAS = {};
     if (!window.__PENDING_DELTAS[chunkKey]) window.__PENDING_DELTAS[chunkKey] = [];
     
     window.__PENDING_DELTAS[chunkKey].push(...deltas);
     
     if (!window.__DELTA_TIMER) {
        window.__DELTA_TIMER = setTimeout(() => {
           const { connections } = get();
           if (connections.length > 0) {
               for (const ck in window.__PENDING_DELTAS) {
                  const deltaPayload = window.__PENDING_DELTAS[ck];
                  if (deltaPayload && deltaPayload.length > 0) {
                     const [cx, cz] = ck.split(',').map(Number);
                     
                     // Binary Packet Structure:
                     // 0: Type (2)
                     // 1-3: Padding
                     // 4-7: cx (Int32)
                     // 8-11: cz (Int32)
                     // 12+: Uint32Array deltas
                     const buffer = new ArrayBuffer(12 + deltaPayload.length * 4);
                     const view = new DataView(buffer);
                     view.setUint8(0, 2);
                     view.setInt32(4, cx, true);
                     view.setInt32(8, cz, true);
                     
                     const uint32View = new Uint32Array(buffer, 12);
                     uint32View.set(deltaPayload);
                     
                     connections.forEach(conn => {
                        try {
                           conn.send(buffer);
                        } catch(err) {
                           console.error('Failed to broadcast delta chunk:', err);
                        }
                     });
                     delete window.__PENDING_DELTAS[ck];
                  }
               }
           }
           window.__PENDING_DELTAS = {};
           window.__DELTA_TIMER = null;
        }, 0);
     }
  },

  sendBinary: (type, data) => {
       const state = get();
       if (type === 1) { // PLAYER_MOVE
          const buffer = new ArrayBuffer(63);
          const view = new DataView(buffer);
          view.setUint8(0, 1);
          
          const id = state.playerId;
          for (let i = 0; i < 36; i++) {
             view.setUint8(1 + i, i < id.length ? id.charCodeAt(i) : 0);
          }
          
          view.setFloat32(37, data.x, true);
          view.setFloat32(41, data.y, true);
          view.setFloat32(45, data.z, true);
          view.setFloat32(49, data.pitch, true);
          view.setFloat32(53, data.yaw, true);
          view.setUint32(57, 0, true); // anim
          
          window.__sendSeq = (window.__sendSeq || 0) + 1;
          view.setUint16(61, window.__sendSeq % 65535, true);
          
          if (state.isHost) {
             // Host broadcasts to all guests
             state.connections.forEach(conn => {
                // Prefer unreliable channel if available for this specific peer
                const moveConn = state.unreliableConnections.find(c => c.peer === conn.peer);
                const targetConn = moveConn || conn;
                try { targetConn.send(buffer); } catch(e) { console.warn("[Network] Send error:", e.message); }
             });
          } else {
             // Guest sends to host
             const hostConn = state.unreliableConnections[0] || state.connections[0];
             if (hostConn) {
                try { hostConn.send(buffer); } catch(e) { console.warn("[Network] Send error:", e.message); }
             }
          }
       }
    }
});
