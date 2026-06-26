// @ts-nocheck
import { useEffect } from 'react';
import { useStore } from '../stores/useStore';
import { playerPosition, playerRotation } from '../globals';
import { networkActions } from '../stores/networkActions';
import { getGuestSyncData } from '../utils/syncState';

const AUTOSAVE_INTERVAL_MS = 15000; // 15 seconds
let isHalted = false;

export const AutoSaveManager = () => {
  useEffect(() => {
    const interval = setInterval(async () => {
      if (isHalted) return;

      // Guests do not save the world locally!
      const isGuest =
        networkActions.getState().connectionStatus === 'connected' &&
        !networkActions.getState().isHost;
      const state = useStore.getState();
      const pos = [playerPosition.x, playerPosition.y, playerPosition.z];
      const rot = [
        playerRotation.x,
        playerRotation.y,
        playerRotation.z,
      ];

      if (isGuest) {
        // Guests just stream their state to the Host instead of saving locally!
        const dataToSave = getGuestSyncData(state, pos, rot);
        networkActions.getState().syncGuestStateToHost(dataToSave);
        return;
      }

      try {
        // Atomic save: Wait for both player state and chunk saving to complete
        await Promise.all([state.savePlayerState(pos, rot), state.saveWorld()]);
      } catch (err) {
        console.error('AutoSaveManager encountered an error:', err);
      }
    }, AUTOSAVE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleQuotaExceeded = () => {
      if (isHalted) return;
      isHalted = true; // Permanently halt AutoSave!

      // Phase 2: Phantom Save Protection & Cache Purge
      networkActions.setState({ chatMessages: [], waypoints: [] });

      const state = networkActions.getState();
      state.addChatMessage(
        '[CRITICAL ERROR] Storage Full! Non-critical cache purged. AutoSave HALTED to prevent corruption. Please free up disk space.',
        'system',
        'System'
      );
    };

    window.addEventListener('storage_quota_exceeded', handleQuotaExceeded);
    return () =>
      window.removeEventListener('storage_quota_exceeded', handleQuotaExceeded);
  }, []);

  return null;
};

