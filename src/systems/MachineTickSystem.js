import { useInventoryStore } from '../stores/inventorySlice';
import { networkActions } from '../stores/networkActions';
import { SmeltingRecipes, FuelRegistry } from '../registry/SmeltingRegistry';
import { getNetworkStore } from '../stores/storeLinker';

export const initializeMachineState = (machineId, type = 'furnace') => {
  if (type !== 'furnace' && type !== 'ship_furnace') return;
  useInventoryStore.setState(prev => {
    if (prev.machines[machineId]) return prev;
    return {
      machines: {
        ...prev.machines,
        [machineId]: { cookProgress: 0, currentCookMax: 100, burnTimeLeft: 0, currentFuelMax: 100 }
      }
    };
  });
};

let tickInterval = null;

export const initMachineTickSystem = () => {
  if (tickInterval) return;
  tickInterval = setInterval(() => {
    const netState = getNetworkStore().getState();
    if (!netState.isHost) return;

    const inventoryState = useInventoryStore.getState();
    const machines = inventoryState.machines;
    const chests = inventoryState.chests;
    if (!machines) return;

    let hasChanges = false;
    const nextMachines = { ...machines };
    const nextChests = { ...chests };

    Object.keys(machines).forEach(machineId => {
      const state = { ...machines[machineId] };
      const originalInv = nextChests[machineId];
      if (!originalInv || originalInv.length < 3) return;
      
      const inv = [...originalInv];
      nextChests[machineId] = inv;

      let machineChanged = false;

      // Decrement burn time
      if (state.burnTimeLeft > 0) {
        state.burnTimeLeft--;
        machineChanged = true;
      }

      const inputSlot = inv[0];
      const fuelSlot = inv[1];
      const outputSlot = inv[2];

      let canCook = false;
      let recipe = null;
      
      if (inputSlot && SmeltingRecipes[inputSlot.texture]) {
        recipe = SmeltingRecipes[inputSlot.texture];
        canCook = !outputSlot || (outputSlot.texture === recipe.output && outputSlot.count < 64);
      }

      if (canCook) {
        if (state.burnTimeLeft <= 0 && fuelSlot && FuelRegistry[fuelSlot.texture]) {
          const fuelInfo = FuelRegistry[fuelSlot.texture];
          state.burnTimeLeft = fuelInfo.burnTime;
          state.currentFuelMax = fuelInfo.burnTime;
          machineChanged = true;

          const nextFuel = { ...fuelSlot, count: fuelSlot.count - 1 };
          if (nextFuel.count <= 0) inv[1] = null;
          else inv[1] = nextFuel;
          hasChanges = true;
        }

        if (state.burnTimeLeft > 0) {
          state.currentCookMax = recipe.cookTime;
          state.cookProgress++;
          machineChanged = true;

          if (state.cookProgress >= state.currentCookMax) {
            state.cookProgress = 0;
            const nextInput = { ...inputSlot, count: inputSlot.count - 1 };
            if (nextInput.count <= 0) inv[0] = null;
            else inv[0] = nextInput;

            if (!outputSlot) {
              inv[2] = { texture: recipe.output, count: 1 };
            } else {
              inv[2] = { ...outputSlot, count: outputSlot.count + 1 };
            }
            hasChanges = true;
          }
        }
      } else {
        if (state.cookProgress > 0) {
          state.cookProgress = 0;
          machineChanged = true;
        }
      }

      if (machineChanged) {
        nextMachines[machineId] = state;
        hasChanges = true;
      }
    });

    if (hasChanges) {
      useInventoryStore.setState({ machines: nextMachines, chests: nextChests });
      netState.broadcastEvent({ type: 'SYNC_MACHINES', machines: nextMachines });
      
      const patch = { chests: nextChests };
      netState.handleNetworkData({ type: 'WORLD_PATCH', patch, sender: netState.playerId });
      netState.broadcastEvent({ type: 'WORLD_PATCH', patch, sender: netState.playerId });
    }
  }, 1000);
};

