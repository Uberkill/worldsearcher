import { EventBus } from '../utils/EventBus';
import { useStore } from '../stores/useStore';
import { useConnectionStore } from '../stores/connectionSlice';

export const initQuestSystem = () => {
  // Single break listener
  EventBus.on('EVENT_BLOCK_DESTROYED', 'quest_tracker_single', (payload) => {
    const { texName, causedByGravity, initiatedByPlayerId } = payload;
    if (causedByGravity) return;

    const localPlayerId = useConnectionStore.getState().playerId;
    const isLocalAction = !initiatedByPlayerId || initiatedByPlayerId === localPlayerId;

    if (isLocalAction && useStore.getState().updateObjectiveProgress) {
      useStore.getState().updateObjectiveProgress('MINE', texName, 1);
    }
  });

  // Bulk break listener (consolidates multi-objective updates)
  EventBus.on('EVENT_BLOCKS_DESTROYED_BULK', 'quest_tracker_bulk', (payload) => {
    const { blocks, causedByGravity, initiatedByPlayerId } = payload;
    if (causedByGravity) return;

    const localPlayerId = useConnectionStore.getState().playerId;
    const isLocalAction = !initiatedByPlayerId || initiatedByPlayerId === localPlayerId;
    if (!isLocalAction) return;

    const totals = new Map();
    blocks.forEach(b => {
      totals.set(b.texName, (totals.get(b.texName) || 0) + 1);
    });

    const state = useStore.getState();
    if (state.updateObjectiveProgress) {
      totals.forEach((count, texName) => {
        state.updateObjectiveProgress('MINE', texName, count);
      });
    }
  });
};
