import { useEffect } from 'react';
import { useStore } from '../stores/useStore';
import { playerPosition, playerRotation } from '../globals';
import { useNetworkStore } from '../stores/useNetworkStore';

const AUTOSAVE_INTERVAL_MS = 15000; // 15 seconds
let isHalted = false;

export const AutoSaveManager = () => {
  useEffect(() => {
    const interval = setInterval(async () => {
      if (isHalted) return;
      
      // Guests do not save the world locally!
      const isGuest = useNetworkStore.getState().connectionStatus === 'connected' && !useNetworkStore.getState().isHost;
      const state = useStore.getState();
      const pos = [playerPosition.x, playerPosition.y, playerPosition.z];
      const rot = [playerRotation.x, playerRotation.y, playerRotation.z, playerRotation.w];

      if (isGuest) {
         // Guests just stream their state to the Host instead of saving locally!
         const dataToSave = {
            version: state.version || 1,
            inventory: state.inventory,
            activeHotbarIndex: state.activeHotbarIndex,
            texture: state.texture,
            coins: state.coins,
            playerHealth: state.playerHealth,
            playerMaxHealth: state.playerMaxHealth,
            playerDamageMult: state.playerDamageMult,
            playerJumpMult: state.playerJumpMult,
            playerPos: pos,
            playerRot: rot,
            isDead: state.isDead,
            playtime: state.playtime || 0
         };
         useNetworkStore.getState().syncGuestStateToHost(dataToSave);
         return;
      }

      try {
        // Atomic save: Wait for both player state and chunk saving to complete
        await Promise.all([
          state.savePlayerState(pos, rot),
          state.saveWorld()
        ]);
      } catch (err) {
        console.error("AutoSaveManager encountered an error:", err);
      }
    }, AUTOSAVE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleQuotaExceeded = () => {
       if (isHalted) return;
       isHalted = true; // Permanently halt AutoSave!
       
       const state = useNetworkStore.getState();
       state.addChatMessage('[CRITICAL ERROR] Storage full! Your world can no longer be saved. Please free up disk space to continue playing safely.', 'system', 'System');
    };
    
    window.addEventListener('storage_quota_exceeded', handleQuotaExceeded);
    return () => window.removeEventListener('storage_quota_exceeded', handleQuotaExceeded);
  }, []);

  return null;
};
