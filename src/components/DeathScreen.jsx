import { useEffect } from 'react';
import { useStore } from '../stores/useStore';
import { useNetworkStore } from '../stores/useNetworkStore';
import { Skull, RotateCcw, LogOut, AlertTriangle } from 'lucide-react';

export const DeathScreen = () => {
  const isDead = useStore(state => state.isDead);
  const gameMode = useStore(state => state.gameMode);
  const isHardcore = gameMode?.toLowerCase() === 'hardcore';
  const resetWorld = useStore(state => state.resetWorld);
  const respawnPlayer = useStore(state => state.respawnPlayer);
  
  const connectionStatus = useNetworkStore(state => state.connectionStatus);
  const isHost = useNetworkStore(state => state.isHost);
  const isGuest = connectionStatus === 'connected' && !isHost;

  useEffect(() => {
    if (isDead) {
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
      
      // Broadcast death to other players
      const { connectionStatus, broadcastChatMessage, playerName, isHost } = useNetworkStore.getState();
      if (connectionStatus === 'connected') {
        const name = playerName || (isHost ? 'Host' : 'Guest');
        broadcastChatMessage(`${name} fell to their death.`);
      }
    }
  }, [isDead]);

  if (!isDead) return null;

  return (
    <div className="fixed inset-0 z-[10000] backdrop-blur-[60px] bg-[#1a0505]/90 flex flex-col items-center justify-center font-sans text-white select-none">
      
      {/* Background vignette/blur */}
      <div className="absolute inset-0 bg-gradient-to-b from-red-950/20 via-transparent to-[#0a0000]/80 pointer-events-none" />

      <div className="bg-red-950/20 border border-red-500/20 rounded-3xl p-12 w-[600px] flex flex-col items-center shadow-[0_0_100px_rgba(220,38,38,0.15)] relative overflow-hidden">
        
        {/* Subtle grid pattern background for tech feel */}
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)', backgroundSize: '20px 20px' }} />

        <Skull className="text-red-500/80 mb-6 drop-shadow-[0_0_15px_rgba(239,68,68,0.5)]" size={64} strokeWidth={1} />
        
        <h1 className="text-5xl font-light tracking-[0.3em] text-red-500 mb-2 uppercase text-center drop-shadow-[0_0_20px_rgba(220,38,38,0.8)]">
           SYSTEM FAILURE
        </h1>
        
        <div className="w-full h-[1px] bg-gradient-to-r from-transparent via-red-500/50 to-transparent my-6" />

        <p className="text-red-200/60 font-light tracking-widest text-sm mb-12 uppercase text-center">
          {isHardcore 
            ? 'Hardcore Protocol engaged. Data unrecoverable.' 
            : 'Suit integrity compromised. Biosignals lost.'}
        </p>

        <div className="flex w-full space-x-6 relative z-10">
          {!isHardcore && (
            <button
              onClick={respawnPlayer}
              className="group flex-1 flex flex-col items-center justify-center py-6 bg-red-950/40 border border-red-500/30 rounded-xl hover:bg-red-900/60 hover:border-red-400 hover:shadow-[0_0_30px_rgba(239,68,68,0.3)] transition-all duration-300 cursor-pointer"
            >
              <RotateCcw className="text-red-400 mb-3 group-hover:text-red-300 transition-colors" size={24} />
              <span className="text-xs font-bold tracking-[0.2em] text-red-200 group-hover:text-white transition-colors">
                INITIATE RESPAWN
              </span>
            </button>
          )}

          <button
            onClick={() => {
              if (isGuest) {
                 useNetworkStore.getState().disconnect(true);
                 sessionStorage.removeItem('saveSlotId');
                 window.location.reload();
                 return;
              }
              if (isHardcore) {
                resetWorld(); 
              } else {
                sessionStorage.removeItem('saveSlotId');
                window.location.reload();
              }
            }}
            className="group flex-1 flex flex-col items-center justify-center py-6 bg-black/40 border border-white/10 rounded-xl hover:bg-white/10 hover:border-white/20 hover:shadow-[0_0_30px_rgba(255,255,255,0.05)] transition-all duration-300 cursor-pointer"
          >
            {isHardcore && !isGuest ? (
              <>
                <AlertTriangle className="text-orange-500/70 mb-3 group-hover:text-orange-400 transition-colors" size={24} />
                <span className="text-xs font-bold tracking-[0.2em] text-white/50 group-hover:text-white transition-colors">
                  PURGE SECTOR
                </span>
              </>
            ) : (
              <>
                <LogOut className="text-white/50 mb-3 group-hover:text-white transition-colors" size={24} />
                <span className="text-xs font-bold tracking-[0.2em] text-white/50 group-hover:text-white transition-colors">
                  DISCONNECT
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
