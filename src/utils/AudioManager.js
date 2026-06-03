import * as Tone from 'tone';

class AudioManager {
  constructor() {
    this.initialized = false;
    this.initPromise = null;
    this.masterLimiter = null;
    this.ambientDuckingNode = null;
    this.globalMusicVolume = null;
    
    this.tracks = ['drone', 'crystalline', 'neon', 'starlight'];
    this.currentTrackIndex = 0;
    this.isPlaying = false;
    
    this.activeNodes = null; // { volume, synths, patterns, effects, name }
    
    this.subscribers = new Set();
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  notify() {
    const state = {
      isPlaying: this.isPlaying,
      currentTrack: this.activeNodes ? this.activeNodes.name : 'None'
    };
    this.subscribers.forEach(cb => cb(state));
  }

  async initialize() {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      await Tone.start();
      
      this.masterLimiter = new Tone.Limiter(-1).toDestination();
      this.ambientDuckingNode = new Tone.Gain(1).connect(this.masterLimiter);
      this.globalMusicVolume = new Tone.Volume(0);
      this.globalMusicVolume.connect(this.masterLimiter);

      this.initialized = true;
      console.log("AudioManager initialized");
    })();
    
    return this.initPromise;
  }

  getAmbientDestination() {
    return this.ambientDuckingNode || Tone.getDestination();
  }

  setMusicVolume(volPercent) {
    if (!this.initialized) return;
    // Map 0-100 to decibels: 100 -> 0dB, 0 -> -Infinity
    if (volPercent <= 0) {
      this.globalMusicVolume.volume.value = -Infinity;
    } else {
      // 20 * log10(amplitude)
      const amplitude = (volPercent / 100) * 0.3; // Lower music base volume by 70%
      this.globalMusicVolume.volume.value = 20 * Math.log10(amplitude);
    }
  }

  stopCurrentTrack(fadeTime = 2) {
    if (!this.activeNodes) return;
    
    const nodesToDispose = this.activeNodes;
    this.activeNodes = null;
    
    // Fade out volume
    nodesToDispose.volume.volume.rampTo(-Infinity, fadeTime);
    
    // Stop patterns immediately to prevent new notes
    nodesToDispose.patterns.forEach(p => p.stop());
    
    // Queue disposal after fade out
    setTimeout(() => {
      nodesToDispose.synths.forEach(s => {
        if (s && !s.disposed) s.dispose();
      });
      nodesToDispose.patterns.forEach(p => {
        if (p && !p.disposed) p.dispose();
      });
      nodesToDispose.effects.forEach(e => {
        if (e && !e.disposed) e.dispose();
      });
      if (nodesToDispose.volume && !nodesToDispose.volume.disposed) {
        nodesToDispose.volume.dispose();
      }
    }, fadeTime * 1000 + 1000); // Wait for fade + 1s buffer
    
    if (this.ambientDuckingNode && !this.isPlaying) {
      this.ambientDuckingNode.gain.rampTo(1, fadeTime);
    }
  }

  playTrack(index) {
    if (!this.initialized) return;
    
    this.currentTrackIndex = (index + this.tracks.length) % this.tracks.length;
    const trackName = this.tracks[this.currentTrackIndex];
    
    // Fade out current track over 2 seconds
    if (this.isPlaying) {
      this.stopCurrentTrack(2);
    }
    
    this.isPlaying = true;
    
    if (this.ambientDuckingNode) {
      this.ambientDuckingNode.gain.rampTo(0.3, 2);
    }

    // Create a new volume node for this track, start at -Infinity and fade in
    const trackVolume = new Tone.Volume(-Infinity).connect(this.globalMusicVolume);
    trackVolume.volume.rampTo(0, 2);
    
    this.activeNodes = {
      volume: trackVolume,
      synths: [],
      patterns: [],
      effects: [],
      name: trackName
    };

    if (Tone.Transport.state !== 'started') {
      Tone.Transport.start();
    }

    switch (trackName) {
      case 'drone': this.setupDrone(trackVolume); break;
      case 'crystalline': this.setupCrystalline(trackVolume); break;
      case 'neon': this.setupNeon(trackVolume); break;
      case 'starlight': this.setupStarlight(trackVolume); break;
    }
    
    this.notify();
  }

  togglePause() {
    if (!this.initialized || !this.activeNodes) return;
    
    if (this.isPlaying) {
      // Pause: rapid fade out
      this.activeNodes.volume.volume.rampTo(-Infinity, 0.5);
      setTimeout(() => {
        if (this.activeNodes) {
          this.activeNodes.patterns.forEach(p => p.stop());
        }
      }, 500);
      this.isPlaying = false;
      if (this.ambientDuckingNode) {
        this.ambientDuckingNode.gain.rampTo(1, 1);
      }
    } else {
      // Play: rapid fade in
      if (Tone.Transport.state !== 'started') {
        Tone.Transport.start();
      }
      this.activeNodes.patterns.forEach(p => p.start(0));
      this.activeNodes.volume.volume.rampTo(0, 0.5);
      this.isPlaying = true;
      if (this.ambientDuckingNode) {
        this.ambientDuckingNode.gain.rampTo(0.3, 1);
      }
    }
    this.notify();
  }

  playNext() {
    this.playTrack(this.currentTrackIndex + 1);
  }

  playPrevious() {
    this.playTrack(this.currentTrackIndex - 1);
  }

  // --- TRACK SETUP LOGIC ---
  
  setupDrone(outputNode) {
    // Softer AMSynth with triangle waves to remove harsh FM frequencies
    const droneSynth = new Tone.AMSynth({
      harmonicity: 1.5,
      oscillator: { type: "triangle" },
      envelope: { attack: 4, decay: 2, sustain: 0.8, release: 8 },
      modulation: { type: "sine" },
      modulationEnvelope: { attack: 4, decay: 2, sustain: 0.8, release: 8 }
    });
    
    const filter = new Tone.Filter(300, "lowpass");
    const panner = new Tone.AutoPanner("0.1hz").start();
    
    droneSynth.chain(filter, panner, outputNode);
    
    // Slower, deeper filter sweep
    const lfo = new Tone.LFO(0.05, 100, 400).start();
    lfo.connect(filter.frequency);
    
    // Slowly change the drone note over time
    const pattern = new Tone.Pattern((time, note) => {
        droneSynth.triggerAttack(note, time);
    }, ["C2", "G2", "C3", "F2"], "randomWalk");
    pattern.interval = "4m"; // Change note every 4 measures
    pattern.start(0);

    this.activeNodes.synths.push(droneSynth);
    this.activeNodes.effects.push(filter, lfo, panner);
    this.activeNodes.patterns.push(pattern);
  }

  setupCrystalline(outputNode) {
    const synth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.1, decay: 0.5, sustain: 0.2, release: 2 }
    });
    const delay = new Tone.PingPongDelay("8n", 0.6);
    const reverb = new Tone.Reverb(4);
    
    synth.chain(delay, reverb, outputNode);
    
    const pattern = new Tone.Pattern((time, note) => {
        synth.triggerAttackRelease(note, "8n", time);
    }, ["A3", "C4", "D4", "E4", "G4", "A4"], "randomWalk");
    pattern.interval = "2n";
    pattern.start(0);

    this.activeNodes.synths.push(synth);
    this.activeNodes.patterns.push(pattern);
    this.activeNodes.effects.push(delay, reverb);
  }

  setupNeon(outputNode) {
    // Dark, slow cyberpunk atmospheric pad (Blade Runner style)
    const padSynth = new Tone.Synth({
      oscillator: { type: "sawtooth" },
      envelope: { attack: 3, decay: 1, sustain: 0.8, release: 5 }
    });
    
    // Heavy lowpass filter so it sits quietly in the background
    const filter = new Tone.Filter({
      frequency: 300,
      type: "lowpass",
      rolloff: -24
    });
    
    const chorus = new Tone.Chorus(4, 2.5, 1).start();
    const reverb = new Tone.Reverb(5);
    
    padSynth.chain(chorus, filter, reverb, outputNode);
    
    // Very slow, deep evolving notes
    const pattern = new Tone.Pattern((time, note) => {
      padSynth.triggerAttackRelease(note, "1m", time);
    }, ["C2", "Eb2", "G1", "F1"], "up");
    pattern.interval = "2m"; // One deep swell every 2 measures
    pattern.start(0);

    this.activeNodes.synths.push(padSynth);
    this.activeNodes.patterns.push(pattern);
    this.activeNodes.effects.push(filter, chorus, reverb);
  }

  setupStarlight(outputNode) {
    // Softer sine wave with a dreamy envelope instead of harsh PluckSynth
    const softSynth = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.5, decay: 1, sustain: 0.5, release: 4 }
    });
    
    const delay = new Tone.PingPongDelay("4n", 0.4);
    const reverb = new Tone.Reverb(6); // Lush, long reverb
    
    softSynth.chain(delay, reverb, outputNode);
    
    // Inspiring Major 9th arpeggio
    const pattern = new Tone.Pattern((time, note) => {
      softSynth.triggerAttackRelease(note, "4n", time);
    }, ["C4", "E4", "G4", "B4", "D5", "G4"], "randomWalk");
    pattern.interval = "4n";
    pattern.start(0);

    this.activeNodes.synths.push(softSynth);
    this.activeNodes.patterns.push(pattern);
    this.activeNodes.effects.push(delay, reverb);
  }
}

export const audioManager = new AudioManager();
