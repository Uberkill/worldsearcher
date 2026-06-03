import { useState, useEffect } from 'react';
import { Play, Pause, SkipForward, SkipBack, Volume2 } from 'lucide-react';
import { audioManager } from '../../utils/AudioManager';

export const MusicPlayerWidget = () => {
  const [playerState, setPlayerState] = useState({
    isPlaying: false,
    currentTrack: 'None'
  });
  
  const [localVolume, setLocalVolume] = useState(100);

  useEffect(() => {
    // Subscribe to AudioManager state changes
    const unsubscribe = audioManager.subscribe((state) => {
      setPlayerState(state);
    });
    return unsubscribe;
  }, []);

  const handleVolumeChange = (e) => {
    const val = Number(e.target.value);
    setLocalVolume(val);
    audioManager.setMusicVolume(val);
  };

  const handlePlayPause = () => {
    if (playerState.currentTrack === 'None' && !playerState.isPlaying) {
      audioManager.playNext(); // Start if nothing playing
    } else {
      audioManager.togglePause();
    }
  };

  return (
    <div className="w-full bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-[0_0_30px_rgba(34,211,238,0.1)] flex flex-col space-y-4">
      {/* Top Row: Track Info */}
      <div className="flex justify-between items-center px-2">
        <div className="flex flex-col">
          <span className="text-[10px] text-cyan-400 tracking-[0.3em] font-bold uppercase">Now Playing</span>
          <span className="text-sm font-light tracking-widest text-white mt-1 capitalize">
            {playerState.currentTrack !== 'None' ? playerState.currentTrack : 'Idle'}
          </span>
        </div>
        
        {/* Playback Controls */}
        <div className="flex items-center space-x-4">
          <button onClick={() => audioManager.playPrevious()} className="text-white/50 hover:text-white transition-colors p-2">
            <SkipBack size={20} />
          </button>
          
          <button onClick={handlePlayPause} className="w-10 h-10 rounded-full bg-cyan-500/20 border border-cyan-400/50 flex items-center justify-center text-cyan-300 hover:bg-cyan-500/40 hover:scale-105 transition-all">
            {playerState.isPlaying ? <Pause size={18} /> : <Play size={18} className="ml-1" />}
          </button>
          
          <button onClick={() => audioManager.playNext()} className="text-white/50 hover:text-white transition-colors p-2">
            <SkipForward size={20} />
          </button>
        </div>
      </div>

      {/* Bottom Row: Volume Control */}
      <div className="flex items-center space-x-3 px-2 pt-2 border-t border-white/10">
        <Volume2 size={14} className="text-white/40" />
        <div className="flex-1 relative flex items-center h-4">
          <div className="absolute w-full h-[2px] bg-white/10 rounded-full" />
          <div className="absolute h-[2px] bg-cyan-400 rounded-full" style={{ width: `${localVolume}%` }} />
          <input 
            type="range" 
            min="0" 
            max="100" 
            value={localVolume} 
            onChange={handleVolumeChange}
            className="absolute w-full opacity-0 cursor-pointer" 
          />
        </div>
        <span className="text-[10px] font-mono text-cyan-200 w-8 text-right">{localVolume}%</span>
      </div>
    </div>
  );
};
