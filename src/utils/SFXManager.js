import * as Tone from 'tone';
import { audioManager } from './AudioManager';
import { useStore } from '../stores/useStore';

class SFXManager {
  constructor() {
    this.initialized = false;
    this.initPromise = null;
    this.buffers = {};
    this.uiSynth = null;
    this.sfxVolume = null;
    this.playerPool = [];
    this.poolSize = 10;
  }

  async initialize() {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      await audioManager.initialize();
      
      this.sfxVolume = new Tone.Volume(0);

      // Connect to the AudioManager's master limiter for consistent ducking/mixing
      this.sfxVolume.connect(audioManager.masterLimiter);
      
      // Create PolySynth for UI and non-spammy interactions
      this.uiSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.01, decay: 0.1, sustain: 0, release: 0.1 }
      }).connect(this.sfxVolume);

      // Pre-render procedural buffers via Tone.Offline
      this.buffers.footstep = await this.renderFootstep();
      this.buffers.break = await this.renderBlockBreak();
      this.buffers.place = await this.renderBlockPlace();
      this.buffers.pickup = await this.renderPickup();
      this.buffers.explosion = await this.renderExplosion();
      this.buffers.stinger1 = await this.renderStinger1();
      this.buffers.stinger2 = await this.renderStinger2();
      this.buffers.thunder = await this.renderThunder();

      // Create an object pool of Tone.Players for rapid spammy sounds
      for (let i = 0; i < this.poolSize; i++) {
        const player = new Tone.Player().connect(this.sfxVolume);
        this.playerPool.push(player);
      }

      this.initialized = true;
      
      // Subscribe to volume changes
      const state = useStore.getState();
      this.setVolume(state.sfxVolume * 100);
      useStore.subscribe(
        (s) => ({ sfx: s.sfxVolume, muted: s.isMuted }),
        (curr) => {
          if (curr.muted) this.setVolume(0);
          else this.setVolume(curr.sfx * 100);
        }
      );

      console.log("SFXManager initialized");
    })();
    
    return this.initPromise;
  }

  setVolume(volPercent) {
    if (!this.initialized) return;
    if (volPercent <= 0) {
      this.sfxVolume.volume.value = -Infinity;
    } else {
      const amplitude = volPercent / 100;
      this.sfxVolume.volume.value = 20 * Math.log10(amplitude);
    }
  }

  // --- OFFLINE RENDERERS ---

  async renderFootstep() {
    return await Tone.Offline(() => {
      const noise = new Tone.Noise("white").start(0).stop(0.1);
      const filter = new Tone.Filter(600, "lowpass");
      const env = new Tone.AmplitudeEnvelope({ attack: 0.01, decay: 0.09, sustain: 0, release: 0 });
      noise.chain(filter, env);
      env.toDestination();
      env.triggerAttack(0);
    }, 0.1);
  }

  async renderBlockBreak() {
    return await Tone.Offline(() => {
      const osc = new Tone.Oscillator(150, "square").start(0).stop(0.1);
      osc.frequency.exponentialRampToValueAtTime(40, 0.1);
      const env = new Tone.AmplitudeEnvelope({ attack: 0.01, decay: 0.09, sustain: 0, release: 0 });
      osc.chain(env);
      env.toDestination();
      env.triggerAttack(0);
    }, 0.1);
  }

  async renderBlockPlace() {
    return await Tone.Offline(() => {
      const osc = new Tone.Oscillator(300, "triangle").start(0).stop(0.1);
      const env = new Tone.AmplitudeEnvelope({ attack: 0.01, decay: 0.09, sustain: 0, release: 0 });
      osc.chain(env);
      env.toDestination();
      env.triggerAttack(0);
    }, 0.1);
  }

  async renderPickup() {
    return await Tone.Offline(() => {
      const osc = new Tone.Oscillator(600, "sine").start(0).stop(0.15);
      osc.frequency.setValueAtTime(800, 0.05);
      const env = new Tone.AmplitudeEnvelope({ attack: 0.01, decay: 0.14, sustain: 0, release: 0 });
      osc.chain(env);
      env.toDestination();
      env.triggerAttack(0);
    }, 0.15);
  }

  async renderExplosion() {
    return await Tone.Offline(() => {
      const osc = new Tone.Oscillator(100, "sawtooth").start(0).stop(0.5);
      osc.frequency.exponentialRampToValueAtTime(10, 0.5);
      const env = new Tone.AmplitudeEnvelope({ attack: 0.01, decay: 0.49, sustain: 0, release: 0 });
      osc.chain(env);
      env.toDestination();
      env.triggerAttack(0);
    }, 0.5);
  }

  async renderStinger1() {
    return await Tone.Offline(() => {
      const synth = new Tone.MetalSynth({
        frequency: 200,
        envelope: { attack: 0.1, decay: 1, release: 1 },
        harmonicity: 5.1,
        modulationIndex: 32,
        resonance: 4000,
        octaves: 1.5
      });
      const reverb = new Tone.Reverb(4);
      synth.chain(reverb);
      reverb.toDestination();
      synth.triggerAttackRelease(0.5, 0);
    }, 2.5); // 2.5 second buffer to allow reverb tail
  }

  async renderStinger2() {
    return await Tone.Offline(() => {
      const noise = new Tone.Noise("white").start(0).stop(1);
      const filter = new Tone.Filter(1500, "bandpass", -24);
      filter.frequency.linearRampToValueAtTime(300, 1);
      const env = new Tone.AmplitudeEnvelope({ attack: 0.5, decay: 0.5, sustain: 0, release: 0 });
      const reverb = new Tone.Reverb(4);
      noise.chain(filter, env, reverb);
      reverb.toDestination();
      env.triggerAttack(0);
    }, 2.5);
  }

  async renderThunder() {
    return await Tone.Offline(() => {
      const noise = new Tone.Noise("pink").start(0).stop(4.0);
      // Sweeping lowpass to simulate the rumble rolling over the hills
      const filter = new Tone.Filter(400, "lowpass");
      filter.frequency.exponentialRampToValueAtTime(40, 4.0);
      const env = new Tone.AmplitudeEnvelope({ attack: 0.02, decay: 3.9, sustain: 0, release: 0 });
      // Add heavy distortion for the initial crack
      const dist = new Tone.Distortion(0.8);
      const reverb = new Tone.Reverb({ decay: 4, preDelay: 0.1 });
      noise.chain(dist, filter, env, reverb);
      reverb.toDestination();
      env.triggerAttack(0);
    }, 5.0);
  }

  // --- PLAYBACK ---

  getAvailablePlayer() {
    // Find a player that isn't currently playing
    return this.playerPool.find(p => p.state === "stopped") || this.playerPool[0]; // Fallback to force restart oldest
  }

  playThunder(delay = 0) {
    if (!this.initialized || !this.buffers.thunder) return;
    setTimeout(() => {
      const player = this.getAvailablePlayer();
      player.buffer = this.buffers.thunder;
      player.playbackRate = 0.8 + (Math.random() * 0.4); // Randomize the rumble pitch
      // Set individual volume high for thunder to ensure it punches through
      player.volume.value = 12; 
      player.start();
    }, delay * 1000);
  }

  play(soundId, options = {}) {
    if (!this.initialized) return;

    if (this.buffers[soundId]) {
      // Play static buffer with randomized pitch to avoid "machine gun" effect
      const player = this.getAvailablePlayer();
      player.buffer = this.buffers[soundId];
      // Randomize playbackRate between 0.95 and 1.05
      player.playbackRate = 0.95 + (Math.random() * 0.1);
      player.start();
      
      // Note: In the future, we could insert a Panner3D node here using options.position
      return;
    }

    // Interactive Synth Sounds
    switch (soundId) {
      case 'scary_stinger': {
        const stingerId = Math.random() > 0.5 ? 'stinger1' : 'stinger2';
        const stingerPlayer = this.getAvailablePlayer();
        stingerPlayer.buffer = this.buffers[stingerId];
        stingerPlayer.playbackRate = 0.8 + (Math.random() * 0.4); // 0.8x to 1.2x
        stingerPlayer.start();
        break;
      }
      case 'jump':
        this.uiSynth.set({ oscillator: { type: 'sine' }, envelope: { decay: 0.2 } });
        this.uiSynth.triggerAttackRelease("C4", "8n");
        // Quick pitch sweep up
        this.uiSynth.setNote("G4", "+0.1");
        break;
      case 'land':
        this.uiSynth.set({ oscillator: { type: 'square' }, envelope: { decay: 0.1 } });
        this.uiSynth.triggerAttackRelease("C2", "16n");
        break;
      case 'damage':
        this.uiSynth.set({ oscillator: { type: 'sawtooth' }, envelope: { decay: 0.3 } });
        this.uiSynth.triggerAttackRelease(["C2", "C#2"], "8n"); // Dissonant crunch
        break;
      case 'ui_click':
        this.uiSynth.set({ oscillator: { type: 'triangle' }, envelope: { decay: 0.05 } });
        this.uiSynth.triggerAttackRelease("C5", "32n");
        break;
      case 'ui_hover':
        this.uiSynth.set({ oscillator: { type: 'sine' }, envelope: { decay: 0.02 } });
        this.uiSynth.triggerAttackRelease("G5", "64n");
        break;
      case 'ui_open':
        this.uiSynth.set({ oscillator: { type: 'triangle' }, envelope: { decay: 0.1 } });
        this.uiSynth.triggerAttackRelease(["E4", "G4", "C5"], "16n");
        break;
      case 'ui_close':
        this.uiSynth.set({ oscillator: { type: 'triangle' }, envelope: { decay: 0.1 } });
        this.uiSynth.triggerAttackRelease(["C5", "G4", "E4"], "16n");
        break;
      case 'hotbar_switch':
        this.uiSynth.set({ oscillator: { type: 'square' }, envelope: { decay: 0.02 } });
        this.uiSynth.triggerAttackRelease("C3", "64n");
        break;
      case 'transaction':
        this.uiSynth.set({ oscillator: { type: 'sine' }, envelope: { decay: 0.3 } });
        this.uiSynth.triggerAttackRelease(["C5", "E5", "G5", "C6"], "8n");
        break;
      case 'chat_message':
        this.uiSynth.set({ oscillator: { type: 'sine' }, envelope: { decay: 0.2 } });
        this.uiSynth.triggerAttackRelease(["G4", "C5"], "8n");
        break;
      default:
        console.warn(`Unknown sound effect: ${soundId}`);
    }
  }
}

export const sfxManager = new SFXManager();
