import React from 'react';
import { useNetworkStore } from '../../stores/useNetworkStore';
import { Signal, SignalHigh, SignalMedium, SignalLow } from 'lucide-react';
import { getSeed } from '../../worldSeed';

export const Scoreboard = ({ isVisible }) => {
  const { players, isHost, playerName, playerId, roomCode, connectionStatus } = useNetworkStore();

  if (!isVisible || connectionStatus !== 'connected') return null;

  const myPing = window.__DEBUG_STATS__?.ping || 0;

  // Compile list of all players
  const allPlayers = [];
  
  // Add myself
  allPlayers.push({
    id: playerId,
    name: playerName || (isHost ? 'Host' : 'Guest'),
    isHost: isHost,
    ping: isHost ? 0 : myPing,
    isMe: true
  });

  // Add others
  Object.entries(players).forEach(([id, p]) => {
    // Determine if this player is the host
    // If I am guest, and this id matches the host ID (which is ws-game-ROOMCODE)... 
    // wait, the host's ID is stored as hostId in WELCOME.
    // Actually, we can just guess by name if they are the host or by role if we had a role field.
    // Let's just mark the Host if `p.name` is the host's name, or simpler: the host's id length is longer, etc.
    // For now, if I'm not host, the single player in my list IS the host (since guests don't see other guests directly in players array unless host forwards them... wait, the host forwards PLAYER_MOVE for all guests, so guests DO have other guests in their players object!).
    
    // We can infer Host if id === `ws-game-${roomCode}`.
    const isThisHost = id.toLowerCase() === `ws-game-${roomCode}`.toLowerCase();
    
    allPlayers.push({
      id,
      name: p.name || `Guest-${id.substring(0,4)}`,
      isHost: isThisHost,
      ping: p.ping || '?', // Only host tracks ping of others currently
      isMe: false
    });
  });

  // Sort: Host first, then me, then others
  allPlayers.sort((a, b) => {
    if (a.isHost) return -1;
    if (b.isHost) return 1;
    if (a.isMe) return -1;
    if (b.isMe) return 1;
    return a.name.localeCompare(b.name);
  });

  const getPingIcon = (ping) => {
    if (ping === '?') return <Signal size={16} className="text-white/30" />;
    if (ping < 50) return <SignalHigh size={16} className="text-green-400" />;
    if (ping < 120) return <SignalMedium size={16} className="text-yellow-400" />;
    return <SignalLow size={16} className="text-red-400 animate-pulse" />;
  };

  return (
    <div className="absolute inset-0 z-[70] flex items-center justify-center pointer-events-none">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
      
      <div className="bg-black/80 backdrop-blur-2xl border border-white/20 rounded-2xl w-[600px] shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col relative">
        <div className="absolute inset-0 bg-gradient-to-b from-cyan-900/20 to-transparent pointer-events-none" />
        
        {/* Header */}
        <div className="p-6 border-b border-white/10 flex items-center justify-between relative z-10">
           <div>
             <h2 className="text-xl font-light tracking-[0.3em] text-white mb-1">SCOREBOARD</h2>
             <div className="flex space-x-4">
               <span className="text-[10px] tracking-widest text-cyan-400 font-bold uppercase">Room: {roomCode}</span>
               <span className="text-[10px] tracking-widest text-cyan-400/50 font-bold uppercase">Seed: {getSeed()}</span>
             </div>
           </div>
           <div className="bg-white/5 border border-white/10 px-4 py-2 rounded-lg">
             <span className="text-xs tracking-widest font-bold text-white/70">PLAYERS: <span className="text-white">{allPlayers.length}</span></span>
           </div>
        </div>

        {/* Table Header */}
        <div className="grid grid-cols-12 gap-4 px-8 py-3 bg-white/5 text-[10px] font-bold tracking-[0.2em] text-white/50 uppercase border-b border-white/5 relative z-10">
          <div className="col-span-6">Player</div>
          <div className="col-span-3 text-center">Role</div>
          <div className="col-span-3 text-right">Ping</div>
        </div>

        {/* Player List */}
        <div className="p-4 space-y-2 relative z-10">
          {allPlayers.map(p => (
            <div 
              key={p.id} 
              className={`grid grid-cols-12 gap-4 px-4 py-3 rounded-xl items-center transition-colors border ${
                p.isMe 
                  ? 'bg-cyan-900/30 border-cyan-500/50 shadow-[inset_0_0_20px_rgba(34,211,238,0.1)]' 
                  : 'bg-white/5 border-white/5'
              }`}
            >
              <div className="col-span-6 flex items-center space-x-3">
                <div className={`w-8 h-8 rounded-md flex items-center justify-center font-bold text-sm ${p.isHost ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' : 'bg-white/10 text-white/70 border border-white/10'}`}>
                   {p.name.charAt(0).toUpperCase()}
                </div>
                <span className={`font-bold tracking-wider ${p.isMe ? 'text-cyan-300' : 'text-white/90'}`}>
                  {p.name} {p.isMe && <span className="text-[10px] text-cyan-400/50 ml-2">(YOU)</span>}
                </span>
              </div>
              <div className="col-span-3 flex justify-center">
                <span className={`text-[10px] tracking-widest px-2 py-1 rounded-sm border font-bold ${p.isHost ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300' : 'bg-white/5 border-white/10 text-white/50'}`}>
                  {p.isHost ? 'HOST' : 'GUEST'}
                </span>
              </div>
              <div className="col-span-3 flex justify-end items-center space-x-2">
                <span className="font-mono text-xs text-white/70">{p.ping === 0 ? 'Local' : (p.ping === '?' ? '---' : `${p.ping}ms`)}</span>
                {getPingIcon(p.ping === 0 ? 10 : p.ping)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
