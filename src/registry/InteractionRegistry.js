import { SHIP_CENTER_X, SHIP_CENTER_Y, SHIP_CENTER_Z } from '../stores/createShipSlice';

const exitPointerLock = () => {
    if (document.pointerLockElement) document.exitPointerLock();
};

export const InteractionRegistry = {
    'crafting_table': ({ state, EventBus }) => {
        if (state.toggleCraftingTable) {
            setTimeout(() => {
                exitPointerLock();
                state.toggleCraftingTable();
            }, 0);
            EventBus.emit('audio', { sound: 'click', source: 'local' });
        }
    },
    'chest': ({ state, EventBus, bx, by, bz, hit }) => {
        if (state.openChest) {
            setTimeout(() => state.openChest(bx, by, bz, hit.isShip), 0);
            EventBus.emit('audio', { sound: 'click', source: 'local' });
        }
    },
    'furnace': ({ state, EventBus, bx, by, bz, hit }) => {
        if (state.openFurnace) {
            setTimeout(() => state.openFurnace(bx, by, bz, hit.isShip), 0);
            EventBus.emit('audio', { sound: 'click', source: 'local' });
        }
    },
    'ship_furnace': ({ state, EventBus, bx, by, bz, hit }) => {
        if (state.openFurnace) {
            setTimeout(() => state.openFurnace(bx, by, bz, hit.isShip), 0);
            EventBus.emit('audio', { sound: 'click', source: 'local' });
        }
    },
    'ship_helm': ({ state, netState, useStore, bx, by, bz, hit }) => {
        if (!hit || !hit.isShip) return;
        if (state.shipHelmPlayerId === netState.playerId) {
            useStore.setState({ seatOffset: [bx - SHIP_CENTER_X, by - SHIP_CENTER_Y, bz - SHIP_CENTER_Z] });
            const req = { type: 'RELEASE_HELM', playerId: netState.playerId };
            if (netState.isHost) netState.handleNetworkData(req);
            else netState.broadcastEvent(req);
        } else if (!state.shipHelmPlayerId) {
            useStore.setState({ seatOffset: [bx - SHIP_CENTER_X, by - SHIP_CENTER_Y, bz - SHIP_CENTER_Z] });
            const req = { type: 'REQUEST_HELM', playerId: netState.playerId };
            if (netState.isHost) netState.handleNetworkData(req);
            else netState.broadcastEvent(req);
        }
    },
    'ship_seat': ({ useStore, bx, by, bz }) => {
        useStore.setState({ seatOffset: [bx - SHIP_CENTER_X, by - SHIP_CENTER_Y, bz - SHIP_CENTER_Z], isSeated: true });
    },
    'astrolabe': ({ state, EventBus }) => {
        if (state.toggleAstrolabe) {
            setTimeout(() => { exitPointerLock(); state.toggleAstrolabe(); }, 0);
            EventBus.emit('audio', { sound: 'click', source: 'local' });
        }
    },
    'warp_drive_engine': ({ state, EventBus }) => {
        if (state.toggleWarpDrive) {
            setTimeout(() => { exitPointerLock(); state.toggleWarpDrive(); }, 0);
            EventBus.emit('audio', { sound: 'click', source: 'local' });
        }
    },
    'spark_node': ({ state, EventBus }) => {
        if (state.toggleHeartCore) {
            setTimeout(() => { exitPointerLock(); state.toggleHeartCore(); }, 0);
            EventBus.emit('audio', { sound: 'click', source: 'local' });
        }
    },
    'lunar_anchor': ({ state, EventBus }) => {
        if (state.toggleLunarAnchor) {
            setTimeout(() => { exitPointerLock(); state.toggleLunarAnchor(); }, 0);
            EventBus.emit('audio', { sound: 'click', source: 'local' });
        }
    },
    'charging_station': ({ netState, EventBus }) => {
        netState.addChatMessage('> Charging Station Offline / Coming Soon', 'system', 'System');
        EventBus.emit('audio', { sound: 'click', source: 'local' });
    },
    'ship_core': ({ state, EventBus, bx, by, bz }) => {
        if (state.toggleShipyardUI) {
            setTimeout(() => { exitPointerLock(); state.toggleShipyardUI([bx, by, bz]); }, 0);
            EventBus.emit('audio', { sound: 'click', source: 'local' });
        }
    }
};
