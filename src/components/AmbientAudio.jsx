import { useEffect, useRef } from 'react';
import { useStore } from '../stores/useStore';
import * as Tone from 'tone';
import { audioManager } from '../utils/AudioManager';
import { sfxManager } from '../utils/SFXManager';

export const AmbientAudio = () => {
  const isNightTime = useStore(state => state.isNightTime);
  const isRaining = useStore(state => state.isRaining);
  const isUnderground = useStore(state => state.isUnderground);
  
  const audioInitialized = useRef(false);
  const nodes = useRef({});
  const stingerTimeout = useRef(null);
  const wasNightRef = useRef(false);

  useEffect(() => {
    let isCancelled = false;
    const handleInit = async () => {
      if (audioInitialized.current) return;
      
      // MUST await sfxManager to finish Tone.Offline rendering, 
      // otherwise Tone.context global will be hijacked by the offline context!
      await audioManager.initialize();
      await sfxManager.initialize();
      
      await Tone.start();
      audioInitialized.current = true;
      
      const dest = audioManager.getAmbientDestination();
      
      // Global Occlusion Filter (The Cave Problem fix)
      const occlusionFilter = new Tone.Filter(20000, "lowpass").connect(dest);
      nodes.current.occlusionFilter = occlusionFilter;

      // Master ambient volume
      const masterVolume = new Tone.Volume(-Infinity).connect(occlusionFilter);
      nodes.current.masterVolume = masterVolume;
      
      // Wind (Day)
      const windGain = new Tone.Gain(0).connect(masterVolume);
      const windNoise = new Tone.Noise("pink").start();
      const windFilter = new Tone.Filter(300, "lowpass");
      windNoise.chain(windFilter, windGain);
      
      // Crickets (Night, Clear)
      const cricketsGain = new Tone.Gain(0).connect(masterVolume);
      const cricketOsc = new Tone.Oscillator(4500, "triangle").start();
      const cricketTremolo = new Tone.Tremolo(5, 1).start();
      cricketOsc.chain(cricketTremolo, cricketsGain);
      
      // Rain (EQ3 dipped for music)
      const rainGain = new Tone.Gain(0).connect(masterVolume);
      const rainNoise = new Tone.Noise("pink").start();
      const rainEQ = new Tone.EQ3({ low: 0, mid: -12, high: -2 }); // Dip mids so music cuts through
      rainNoise.chain(rainEQ, rainGain);
      
      // Dread Drone (Night)
      const dreadGain = new Tone.Gain(0).connect(masterVolume);
      const dreadOsc = new Tone.Oscillator(80, "sine").start();
      const dreadChebyshev = new Tone.Chebyshev(50); // Saturation for upper harmonics (laptop speaker psychoacoustics!)
      const dreadLFO = new Tone.LFO(0.1, 0.2, 1).start(); // Pulsing volume
      const dreadLfoGain = new Tone.Gain(1);
      dreadLFO.connect(dreadLfoGain.gain);
      dreadOsc.chain(dreadChebyshev, dreadLfoGain, dreadGain);
      
      nodes.current = {
        ...nodes.current,
        windGain, cricketsGain, rainGain, dreadGain,
        windNoise, windFilter, cricketOsc, cricketTremolo,
        rainNoise, rainEQ, dreadOsc, dreadChebyshev, dreadLFO, dreadLfoGain
      };
      
      updateFades(useStore.getState().isNightTime, useStore.getState().isRaining);
      updateVolume();
      updateOcclusion(useStore.getState().isUnderground);
      
      // Start scary stinger loop
      startStingerLoop();
    };

    const unlockAudio = () => {
      if (Tone.context.state !== 'running') {
        Tone.start().then(handleInit);
      } else {
        handleInit();
      }
    };

    document.addEventListener('pointerlockchange', unlockAudio);
    return () => {
      isCancelled = true;
      document.removeEventListener('pointerlockchange', unlockAudio);
      Object.values(nodes.current).forEach(node => {
        if (node && !node.disposed) node.dispose();
      });
      nodes.current = {};
      audioInitialized.current = false;
      if (stingerTimeout.current) clearTimeout(stingerTimeout.current);
    };
  }, []);
  
  const startStingerLoop = () => {
     if (stingerTimeout.current) clearTimeout(stingerTimeout.current);
     
     const loop = () => {
        const state = useStore.getState();
        if (state.isNightTime) {
           sfxManager.play('scary_stinger');
        }
        // Random interval between 15 and 45 seconds
        stingerTimeout.current = setTimeout(loop, 15000 + Math.random() * 30000);
     };
     
     stingerTimeout.current = setTimeout(loop, 10000); // initial offset
  };

  const updateVolume = () => {
    if (!audioInitialized.current || !nodes.current.masterVolume) return;
    const state = useStore.getState();
    const vol = state.isMuted ? 0 : (state.masterVolume * state.musicVolume);
    
    if (vol <= 0) {
      nodes.current.masterVolume.volume.value = -Infinity;
    } else {
      const amplitude = vol / 100;
      nodes.current.masterVolume.volume.value = 20 * Math.log10(amplitude);
    }
  };

  const updateFades = (night, raining) => {
    if (!audioInitialized.current || !nodes.current.windGain) return;
    
    const { windGain, cricketsGain, rainGain, dreadGain, masterVolume } = nodes.current;
    const fadeTime = 3;
    
    // Wind: active during day
    if (!night && !raining) {
      windGain.gain.rampTo(0.2, fadeTime);
    } else {
      windGain.gain.rampTo(0, fadeTime);
    }
    
    // Crickets: active during night, but ONLY if not raining
    if (night && !raining) {
      cricketsGain.gain.rampTo(0.1, fadeTime);
    } else {
      cricketsGain.gain.rampTo(0, fadeTime);
    }
    
    // Rain: active when raining
    if (raining) {
      rainGain.gain.rampTo(0.5, fadeTime);
    } else {
      rainGain.gain.rampTo(0, fadeTime);
    }
    
    // Dread Drone: active at night
    if (night) {
      dreadGain.gain.rampTo(0.1, fadeTime); // Keep the dread drone low so it's a subconscious hum
    } else {
      dreadGain.gain.rampTo(0, fadeTime);
    }

    // Nightfall Warning Alarm (re-implemented in Tone.js)
    if (night && !wasNightRef.current) {
       // Just transitioned to night!
       const alarmOsc = new Tone.Oscillator(4500, "triangle").start();
       const alarmGain = new Tone.Gain(0).connect(masterVolume);
       alarmOsc.connect(alarmGain);
       
       alarmGain.gain.rampTo(0.001, 1);
       alarmGain.gain.setValueAtTime(0.001, Tone.now() + 4);
       alarmGain.gain.linearRampToValueAtTime(0, Tone.now() + 10);
       
       setTimeout(() => {
          alarmOsc.dispose();
          alarmGain.dispose();
       }, 11000);
    }
    wasNightRef.current = night;
  };
  
  const updateOcclusion = (underground) => {
    if (!audioInitialized.current || !nodes.current.occlusionFilter) return;
    // Hysteresis fix: smooth 1.5s transition
    if (underground) {
       nodes.current.occlusionFilter.frequency.rampTo(400, 1.5);
    } else {
       nodes.current.occlusionFilter.frequency.rampTo(20000, 1.5);
    }
  };

  useEffect(() => {
    const unsubscribe = useStore.subscribe(
      (state) => ({ 
        masterVolume: state.masterVolume, 
        musicVolume: state.musicVolume, 
        isMuted: state.isMuted 
      }),
      () => updateVolume()
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    updateFades(isNightTime, isRaining);
  }, [isNightTime, isRaining]);
  
  useEffect(() => {
    updateOcclusion(isUnderground);
  }, [isUnderground]);

  return null;
};
