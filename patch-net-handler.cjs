const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/stores/useNetworkStore.js');
let code = fs.readFileSync(filePath, 'utf-8');

const handlerAddition = `
    else if (data.type === 'INVENTORY_INTENT') {
       if (!state.isHost) return; // Only Host processes intents
       
       const senderId = senderConn.metadata?.playerId;
       if (!senderId) return;

       // 1. Generate Lock Keys
       const getLockKey = (loc) => {
          if (loc.type === 'player') return \`player_\${loc.id}_slot_\${loc.slot}\`;
          if (loc.type === 'container') return \`container_\${loc.id}_slot_\${loc.slot}\`;
          return null;
       };
       
       const srcKey = getLockKey(data.source);
       const dstKey = getLockKey(data.destination);
       
       const keysToLock = [];
       if (srcKey) keysToLock.push(srcKey);
       if (dstKey) keysToLock.push(dstKey);
       
       // 2. Attempt Mutex Lock
       if (!get().lockSlots(keysToLock)) {
           // Collision! Send rejection sync
           try { senderConn.send({ type: 'INVENTORY_SYNC', reason: 'LOCKED' }); } catch { /* ignore */ }
           return;
       }
       
       try {
           // 3. Distance Validation for Containers
           const pPos = state.players[senderId]?.pos;
           if (!pPos) throw new Error("Player position unknown");
           
           const checkDistance = (loc) => {
              if (loc.type === 'container') {
                 // loc.id is "chest_12,64,-5"
                 const coords = loc.id.replace('chest_', '').split(',').map(Number);
                 if (coords.length === 3) {
                    const dx = pPos[0] - coords[0];
                    const dy = pPos[1] - coords[1];
                    const dz = pPos[2] - coords[2];
                    const distSq = dx*dx + dy*dy + dz*dz;
                    if (distSq > 25) { // Distance > 5
                       throw new Error("Container too far away!");
                    }
                 }
              }
           };
           checkDistance(data.source);
           checkDistance(data.destination);
           
           // 4. Perform Transaction Logic (Will be handled in createWorldSlice/createPlayerSlice)
           // TODO: Execute Move/Split/Drop/Craft using the authoritative store.
           // For now, we simulate success and broadcast sync.
           
           console.log("Valid Transaction:", data.action, data.source, "->", data.destination);
           
           // Broadcast success sync
           get().broadcastEvent({ type: 'INVENTORY_SYNC' });
           
       } catch (err) {
           console.warn("Transaction Rejected:", err.message);
           try { senderConn.send({ type: 'INVENTORY_SYNC', reason: 'VALIDATION_FAILED' }); } catch { /* ignore */ }
       } finally {
           // 5. Release Mutex Locks NO MATTER WHAT
           get().unlockSlots(keysToLock);
       }
    }
`;

const insertAfter = `    else if (data.type === 'WORLD_SYNC') {
      const useStore = getGameStore();
      if (useStore) {
        useStore.getState().applyWorldSync({ [data.chunkKey]: data.buffer });
      }
    }`;

code = code.replace(insertAfter, insertAfter + handlerAddition);

fs.writeFileSync(filePath, code);
console.log('useNetworkStore.js patched with try...finally INVENTORY_INTENT handler!');
