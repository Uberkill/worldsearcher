const fs = require('fs');
let code = fs.readFileSync('src/stores/useNetworkStore.js', 'utf8');

if (!code.includes('syncGuestStateToHost: (stateData)')) {
    code = code.replace('removePlayer: (id) =>', 'syncGuestStateToHost: (stateData) => {\n     const state = get();\n     if (state.isHost || state.connectionStatus !== \'connected\' || state.connections.length === 0) return;\n     try {\n        state.connections[0].send({ type: \'GUEST_SAVE\', state: stateData });\n     } catch (e) {}\n  },\n\n  removePlayer: (id) =>');
}

if (!code.includes('popPendingAttacks: ()')) {
    code = code.replace('lockSlots: (keys) => {', 'popPendingAttacks: () => {\n     const attacks = get().pendingHostAttacks || [];\n     if (attacks.length > 0) {\n         set({ pendingHostAttacks: [] });\n     }\n     return attacks;\n  },\n\n  lockSlots: (keys) => {');
}

const listeners = `    else if (data.type === 'TAKE_DAMAGE') {
       const useStore = getGameStore();
       if (useStore) {
          if (data.targetType === 'player' && data.targetId === get().playerId) {
             useStore.getState().damagePlayer(data.amount);
          } else if (data.targetType === 'enemy') {
             useStore.getState().damageEnemy(data.targetId, data.amount);
          }
       }
    }
    else if (data.type === 'SPAWN_PROJECTILE') {
       const useStore = getGameStore();
       if (useStore) {
          useStore.getState().spawnVisualProjectile(data);
       }
    }
    else if (data.type === 'PROJECTILE_IMPACT') {
       const useStore = getGameStore();
       if (useStore) {
          useStore.getState().destroyVisualProjectile(data.id, data.point);
       }
    }
  },`;

if (!code.includes('data.type === \\\'TAKE_DAMAGE\\\'')) {
    code = code.replace(/}\s*,\s*connectToPeer:/, listeners + '\n\n  connectToPeer:');
}

fs.writeFileSync('src/stores/useNetworkStore.js', code);
console.log('Fixed useNetworkStore successfully.');
