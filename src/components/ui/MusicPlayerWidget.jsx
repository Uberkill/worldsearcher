import { useState, useEffect } from 'react';
import { Play, Pause, SkipForward, SkipBack, Volume2 } from 'lucide-react';
import { gameAudio } from '../../audio/GameAudio';
import { useStore } from '../../stores/useStore';
import { useAudioStore } from '../../stores/useAudioStore';
import { useRef } from 'react';

export const MusicPlayerWidget = () => {
  const [playerState, setPlayerState] = useState({
    isPlaying: false,
    currentTrack: 'None',
  });

  const storeMusicVolume = useAudioStore((state) => state.musicVolume);
  const setMusicVolumeStore = useAudioStore((state) => state.setMusicVolume);

  // localVolume uses 0-100 scale for UI slider
  const [localVolume, setLocalVolume] = useState(() =>
    Math.round(storeMusicVolume * 100)
  );
  const debounceRef = useRef(null);

  useEffect(() => {
    // Subscribe to GameAudio state changes
    const unsubscribe = gameAudio.subscribe((state) => {
      setPlayerState(state);
    });
    return unsubscribe;
  }, []);

  const handleVolumeChange = (e) => {
    const val = Number(e.target.value);
    setLocalVolume(val);
    useAudioStore.getState().setMusicVolume(val); // Realtime audio response

    // Debounce store write to prevent React render flooding
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setMusicVolumeStore(val / 100);
    }, 200);
  };

  const handlePlayPause = () => {
    if (playerState.currentTrack === 'None' && !playerState.isPlaying) {
      gameAudio.playNext(); // Start if nothing playing
    } else {
      gameAudio.togglePause();
    }
  };

  return (
    <div className="w-full bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-[0_0_30px_rgba(255,255,255,0.05)] flex flex-col space-y-4">
      {/* Top Row: Track Info */}
      <div className="flex justify-between items-center px-2">
        <div className="flex flex-col">
          <span className="text-[10px] text-white tracking-[0.3em] font-bold uppercase">
            Now Playing
          </span>
          <span className="text-sm font-medium tracking-widest text-white mt-1 capitalize">
            {playerState.currentTrack !== 'None'
              ? playerState.currentTrack
              : 'Idle'}
          </span>
        </div>

        {/* Playback Controls */}
        <div className="flex items-center space-x-4">
          <button
            onClick={() => gameAudio.playPrevious()}
            className="text-white/50 hover:text-white transition-colors p-2"
          >
            <SkipBack size={20} />
          </button>

          <button
            onClick={handlePlayPause}
            className="w-10 h-10 rounded-full bg-white/20 border border-white/20 flex items-center justify-center text-white/90 hover:bg-white/20 hover:scale-105 transition-all"
          >
            {playerState.isPlaying ? (
              <Pause size={18} />
            ) : (
              <Play size={18} className="ml-1" />
            )}
          </button>

          <button
            onClick={() => gameAudio.playNext()}
            className="text-white/50 hover:text-white transition-colors p-2"
          >
            <SkipForward size={20} />
          </button>
        </div>
      </div>

      {/* Bottom Row: Volume Control */}
      <div className="flex items-center space-x-3 px-2 pt-2 border-t border-white/10">
        <Volume2 size={14} className="text-white/40" />
        <div className="flex-1 relative flex items-center h-4">
          <div className="absolute w-full h-[2px] bg-white/10 rounded-full" />
          <div
            className="absolute h-[2px] bg-white rounded-full"
            style={{ width: `${localVolume}%` }}
          />
          <input
            type="range"
            min="0"
            max="100"
            value={localVolume}
            onChange={handleVolumeChange}
            className="absolute w-full opacity-0 cursor-pointer"
          />
        </div>
        <span className="text-[10px] font-mono text-white/80 w-8 text-right">
          {localVolume}%
        </span>
      </div>
    </div>
  );
};
