// @ts-nocheck
import * as THREE from 'three';
import { useAudioStore } from '../stores/useAudioStore';
import { EventBus } from '../utils/EventBus';

class GameAudioSystem {
  listener: THREE.AudioListener | null;
  audioLoader: THREE.AudioLoader;
  buffers: Map<string, AudioBuffer>;
  uiSounds: Map<string, THREE.Audio>;
  musicElements: Record<string, HTMLAudioElement>;
  activeMusic: string | null;
  context: AudioContext | null;
  masterGain: GainNode | null;
  sfxGain: GainNode | null;
  musicGain: GainNode | null;
  masterLimiter: DynamicsCompressorNode | null;
  musicCompressor: DynamicsCompressorNode | null;
  sfxCompressor: DynamicsCompressorNode | null;
  initialized: boolean;
  voiceCounts: Map<string, number>;
  MAX_VOICES_PER_SOUND: number;
  tracks: string[];
  currentTrackIndex: number;
  isPlaying: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subscribers: Set<(state: any) => void>;
  lastPlayed?: Record<string, number>;

  constructor() {
    this.listener = null;
    this.audioLoader = new THREE.AudioLoader();
    this.buffers = new Map();
    this.uiSounds = new Map(); // THREE.Audio objects for UI

    // HTML5 Audio Elements for streaming music
    this.musicElements = {};
    this.activeMusic = null;

    this.context = null;
    this.masterGain = null;
    this.sfxGain = null;
    this.musicGain = null;
    
    this.masterLimiter = null;
    this.musicCompressor = null;
    this.sfxCompressor = null;

    this.initialized = false;

    // Concurrency tracking
    this.voiceCounts = new Map();
    this.MAX_VOICES_PER_SOUND = 4;

    this.tracks = ['drone', 'crystalline', 'neon', 'starlight'];
    this.currentTrackIndex = 0;
    this.isPlaying = false;
    this.subscribers = new Set();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subscribe(callback: (state: any) => void) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  notify() {
    const state = {
      isPlaying: this.isPlaying,
      currentTrack: this.activeMusic || 'None',
    };
    this.subscribers.forEach((cb) => cb(state));
  }

  // Must be called from a React component after user interaction
  async initialize(camera: THREE.Camera) {
    if (this.initialized) return;

    // 1. Create Listener and attach to Camera
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);

    this.context = this.listener.context;

    // 2. Setup Audio Buses and Ducking Compressor
    this.masterGain = this.context.createGain();
    this.sfxGain = this.context.createGain();
    this.musicGain = this.context.createGain();

    // -- Music Compressor (Gentle leveling) --
    this.musicCompressor = this.context.createDynamicsCompressor();
    this.musicCompressor.threshold.setValueAtTime(-24, this.context.currentTime);
    this.musicCompressor.knee.setValueAtTime(10, this.context.currentTime);
    this.musicCompressor.ratio.setValueAtTime(4, this.context.currentTime);
    this.musicCompressor.attack.setValueAtTime(0.01, this.context.currentTime);
    this.musicCompressor.release.setValueAtTime(0.25, this.context.currentTime);

    // -- SFX Limiter (Brick-wall to catch overlapping explosions) --
    this.sfxCompressor = this.context.createDynamicsCompressor();
    this.sfxCompressor.threshold.setValueAtTime(-3, this.context.currentTime);
    this.sfxCompressor.knee.setValueAtTime(0, this.context.currentTime);
    this.sfxCompressor.ratio.setValueAtTime(20, this.context.currentTime);
    this.sfxCompressor.attack.setValueAtTime(0.003, this.context.currentTime);
    this.sfxCompressor.release.setValueAtTime(0.1, this.context.currentTime);

    // -- Master Limiter (Protective) --
    this.masterLimiter = this.context.createDynamicsCompressor();
    this.masterLimiter.threshold.setValueAtTime(-0.5, this.context.currentTime);
    this.masterLimiter.knee.setValueAtTime(0, this.context.currentTime);
    this.masterLimiter.ratio.setValueAtTime(20, this.context.currentTime);
    this.masterLimiter.attack.setValueAtTime(0.001, this.context.currentTime);
    this.masterLimiter.release.setValueAtTime(0.05, this.context.currentTime);

    // Routing: Music -> MusicCompressor -> MasterLimiter -> MasterGain
    this.musicGain.connect(this.musicCompressor);
    this.musicCompressor.connect(this.masterLimiter);

    // Routing: SFX -> SFXCompressor -> MasterLimiter -> MasterGain
    this.sfxGain.connect(this.sfxCompressor);
    this.sfxCompressor.connect(this.masterLimiter);

    this.masterLimiter.connect(this.masterGain);
    this.masterGain.connect(this.context.destination);

    // Override Three.js AudioListener's internal destination to route through our SFX Bus
    this.listener.gain.disconnect();
    this.listener.gain.connect(this.sfxGain);

    // 3. Load Assets
    await this.loadAssets();

    // 4. Subscribe to Zustand settings
    this.updateVolumes();
    useAudioStore.subscribe(() => this.updateVolumes());

    this.initialized = true;
    
    // Subscribe to EventBus for discrete audio triggers
    EventBus.on('audio', 'GameAudioSystem', (payload) => {
      // 1. Sanitization fallback
      const soundName = typeof payload === 'string' ? payload : payload?.sound;
      if (!soundName) return;

      // 2. Throttle identical sounds (50ms)
      if (!this.lastPlayed) this.lastPlayed = {};
      const now = performance.now();
      if (now - (this.lastPlayed[soundName] || 0) < 50) return;
      
      // 3. Temporary Multiplayer Distance Culling (Max 32 blocks)
      if (typeof payload === 'object' && payload.position && payload.source === 'network' && this.listener) {
        const dist = this.listener.position.distanceTo(
          new THREE.Vector3(payload.position[0], payload.position[1], payload.position[2])
        );
        if (dist > 32) return; // Drop sounds too far away
      }

      this.lastPlayed[soundName] = now;
      this.playGlobal(soundName);
    });

    console.log('GameAudioSystem Initialized!');
  }

  updateVolumes() {
    if (!this.initialized || !this.context || !this.masterGain || !this.sfxGain || !this.musicGain) return;
    const state = useAudioStore.getState();
    const isMuted = state.isMuted;

    const masterVol = isMuted ? 0 : state.masterVolume;
    const sfxVol = isMuted ? 0 : state.sfxVolume;
    const musicVol = isMuted ? 0 : state.musicVolume * 0.5; // Music naturally quieter

    // Smooth volume transition to prevent popping
    const now = this.context.currentTime;
    this.masterGain.gain.setTargetAtTime(masterVol, now, 0.1);
    this.sfxGain.gain.setTargetAtTime(sfxVol, now, 0.1);
    this.musicGain.gain.setTargetAtTime(musicVol, now, 0.1);
  }

  async loadAssets() {
    const sfxFiles = [
      'footstep',
      'footstep_2',
      'footstep_3',
      'jump',
      'land',
      'damage',
      'attack',
      'explosion',
      'ui_click',
      'ui_hover',
    ];

    for (const name of sfxFiles) {
      try {
        const buffer = await this.audioLoader.loadAsync(
          `${import.meta.env.BASE_URL}assets/audio/${name}.wav`
        );
        this.buffers.set(name, buffer);

        // Create a generic THREE.Audio for global (non-spatial) playback of this SFX
        const globalSound = new THREE.Audio(this.listener);
        globalSound.setBuffer(buffer);
        // Calibrate headroom: UI at 1.0, non-UI sounds down to 0.4 (-8dBFS) to leave room for spatial explosions
        globalSound.setVolume(name.startsWith('ui_') ? 1.0 : 0.4);
        this.uiSounds.set(name, globalSound);
      } catch (err) {
        console.warn(`Failed to load audio: ${name}`, err);
      }
    }

    // Setup Streaming Music
    const musicFiles = ['drone', 'crystalline', 'neon', 'starlight'];
    for (const name of musicFiles) {
      const el = document.createElement('audio');
      el.src = `${import.meta.env.BASE_URL}assets/audio/${name}.wav`;
      el.preload = 'none';
      el.loop = true;

      if (this.context && this.musicGain) {
        const sourceNode = this.context.createMediaElementSource(el);
        sourceNode.connect(this.musicGain); // Route directly to music bus
      }
      this.musicElements[name] = el;
    }
  }

  resumeContext() {
    if (this.context && this.context.state === 'suspended') {
      this.context.resume();
    }
  }

  playGlobal(name: string) {
    if (!this.initialized) return;
    this.resumeContext();

    // Round-robin or random variations for global too
    if (name === 'footstep') {
      const variations = ['footstep', 'footstep_2', 'footstep_3'];
      name = variations[Math.floor(Math.random() * variations.length)];
    }

    const sound = this.uiSounds.get(name) || this.uiSounds.get('ui_click');
    if (sound) {
      if (sound.isPlaying) sound.stop();
      sound.play();
    }
  }

  playMusic(trackName: string) {
    if (!this.initialized) return;
    this.resumeContext();

    if (this.activeMusic && this.musicElements[this.activeMusic]) {
      this.musicElements[this.activeMusic].pause();
    }

    if (this.musicElements[trackName]) {
      this.musicElements[trackName].play().catch(() => {});
      this.activeMusic = trackName;
      this.currentTrackIndex = this.tracks.indexOf(trackName);
      this.isPlaying = true;
      this.notify();
    }
  }

  playNext() {
    if (!this.initialized) return;
    const nextIndex = (this.currentTrackIndex + 1) % this.tracks.length;
    this.playMusic(this.tracks[nextIndex]);
  }

  playPrevious() {
    if (!this.initialized) return;
    const prevIndex =
      (this.currentTrackIndex - 1 + this.tracks.length) % this.tracks.length;
    this.playMusic(this.tracks[prevIndex]);
  }

  togglePause() {
    if (!this.initialized || !this.activeMusic) return;
    const el = this.musicElements[this.activeMusic];
    if (!el) return;

    if (this.isPlaying) {
      el.pause();
      this.isPlaying = false;
    } else {
      el.play().catch(() => {});
      this.isPlaying = true;
    }
    this.notify();
  }

  triggerDucking() {
    if (!this.initialized) return;
    // Duck music heavily for 0.5s, then recover over 1s
    const now = this.context.currentTime;
    const currentVol = this.musicGain.gain.value;
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setValueAtTime(Math.max(0.001, currentVol * 0.2), now);
    this.musicGain.gain.exponentialRampToValueAtTime(
      Math.max(0.001, useAudioStore.getState().musicVolume * 0.5),
      now + 1.5
    );
  }

  getBuffer(name) {
    // Round-robin or random variations
    if (name === 'footstep') {
      const variations = ['footstep', 'footstep_2', 'footstep_3'];
      name = variations[Math.floor(Math.random() * variations.length)];
    }
    return this.buffers.get(name);
  }

  canPlayVoice(name) {
    const current = this.voiceCounts.get(name) || 0;
    
    // Dynamic Voice Limits
    let limit = this.MAX_VOICES_PER_SOUND;
    if (name === 'explosion' || name === 'damage') limit = 2; // Keep heavy hits from stacking up
    else if (name.startsWith('footstep')) limit = 6; // Allow multiple concurrent footsteps from spiders/pigs
    
    if (current >= limit) return false;
    this.voiceCounts.set(name, current + 1);
    return true;
  }

  releaseVoice(name) {
    const current = this.voiceCounts.get(name) || 1;
    this.voiceCounts.set(name, Math.max(0, current - 1));
  }
}

export const gameAudio = new GameAudioSystem();

