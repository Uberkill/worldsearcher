import * as THREE from 'three';
import { getGameStore } from '../stores/storeLinker';

class GameAudioSystem {
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
    this.compressor = null;

    this.initialized = false;

    // Concurrency tracking
    this.voiceCounts = new Map();
    this.MAX_VOICES_PER_SOUND = 4;

    this.tracks = ['drone', 'crystalline', 'neon', 'starlight'];
    this.currentTrackIndex = 0;
    this.isPlaying = false;
    this.subscribers = new Set();
  }

  subscribe(callback) {
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
  async initialize(camera) {
    if (this.initialized) return;

    // 1. Create Listener and attach to Camera
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);

    this.context = this.listener.context;

    // 2. Setup Audio Buses and Ducking Compressor
    this.masterGain = this.context.createGain();
    this.sfxGain = this.context.createGain();
    this.musicGain = this.context.createGain();

    this.compressor = this.context.createDynamicsCompressor();
    this.compressor.threshold.setValueAtTime(-24, this.context.currentTime);
    this.compressor.knee.setValueAtTime(10, this.context.currentTime);
    this.compressor.ratio.setValueAtTime(8, this.context.currentTime);
    this.compressor.attack.setValueAtTime(0.01, this.context.currentTime);
    this.compressor.release.setValueAtTime(0.25, this.context.currentTime);

    // Routing: Music -> Compressor -> Master
    this.musicGain.connect(this.compressor);
    this.compressor.connect(this.masterGain);

    // Routing: SFX -> Master AND sidechain trigger (if Web Audio API supported, else just Master)
    this.sfxGain.connect(this.masterGain);
    // Note: True sidechaining in WebAudio requires a dummy node, but we'll simulate ducking on heavy hits via JS for wider browser support.

    this.masterGain.connect(this.context.destination);

    // Override Three.js AudioListener's internal destination to route through our SFX Bus
    this.listener.gain.disconnect();
    this.listener.gain.connect(this.sfxGain);

    // 3. Load Assets
    await this.loadAssets();

    // 4. Subscribe to Zustand settings
    this.updateVolumes();
    const useStore = getGameStore();
    if (useStore) {
      useStore.subscribe(() => this.updateVolumes());
    }

    this.initialized = true;
    console.log('GameAudioSystem Initialized!');
  }

  updateVolumes() {
    if (!this.initialized) return;
    const useStore = getGameStore();
    if (!useStore) return;
    const state = useStore.getState();
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
          `/assets/audio/${name}.wav`
        );
        this.buffers.set(name, buffer);

        // Create a generic THREE.Audio for global (non-spatial) playback of this SFX
        const globalSound = new THREE.Audio(this.listener);
        globalSound.setBuffer(buffer);
        globalSound.setVolume(name.startsWith('ui_') ? 1.0 : 0.6); // Slightly quieter for non-UI global sounds
        this.uiSounds.set(name, globalSound);
      } catch (err) {
        console.warn(`Failed to load audio: ${name}`, err);
      }
    }

    // Setup Streaming Music
    const musicFiles = ['drone', 'crystalline', 'neon', 'starlight'];
    for (const name of musicFiles) {
      const el = document.createElement('audio');
      el.src = `/assets/audio/${name}.wav`;
      el.preload = 'none';
      el.loop = true;

      const sourceNode = this.context.createMediaElementSource(el);
      sourceNode.connect(this.musicGain); // Route directly to music bus
      this.musicElements[name] = el;
    }
  }

  resumeContext() {
    if (this.context && this.context.state === 'suspended') {
      this.context.resume();
    }
  }

  playGlobal(name) {
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

  playMusic(trackName) {
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
    const useStore = getGameStore();
    if (!useStore) return;
    // Duck music heavily for 0.5s, then recover over 1s
    const now = this.context.currentTime;
    const currentVol = this.musicGain.gain.value;
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setValueAtTime(Math.max(0.001, currentVol * 0.2), now);
    this.musicGain.gain.exponentialRampToValueAtTime(
      Math.max(0.001, useStore.getState().musicVolume * 0.5),
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
    if (current >= this.MAX_VOICES_PER_SOUND) return false;
    this.voiceCounts.set(name, current + 1);
    return true;
  }

  releaseVoice(name) {
    const current = this.voiceCounts.get(name) || 1;
    this.voiceCounts.set(name, Math.max(0, current - 1));
  }
}

export const gameAudio = new GameAudioSystem();
