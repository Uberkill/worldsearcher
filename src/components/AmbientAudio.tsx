// @ts-nocheck
import { useEffect, useRef, useState } from 'react';
import { useEnvironmentStore } from '../stores/environmentSlice';
import { gameAudio } from '../audio/GameAudio';

export const AmbientAudio = () => {
  const isRaining = useEnvironmentStore((state) => state.isRaining);
  const synthRef = useRef(null);
  const [audioReady, setAudioReady] = useState(false);

  useEffect(() => {
    if (gameAudio.initialized && gameAudio.context) {
      // eslint-disable-next-line
      setAudioReady(true);
      return;
    }
    const interval = setInterval(() => {
      if (gameAudio.initialized && gameAudio.context) {
      setAudioReady(true);
        clearInterval(interval);
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!audioReady) return;

    const ctx = gameAudio.context;

    // Create Rain Synthesizer (White Noise -> Lowpass Filters)
    const bufferSize = ctx.sampleRate * 2; // 2 seconds of noise
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      // White noise from -1 to 1
      output[i] = Math.random() * 2 - 1;
    }

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;

    // Filter 1: Lowpass for the deep rumble of rain
    const lowpass1 = ctx.createBiquadFilter();
    lowpass1.type = 'lowpass';
    lowpass1.frequency.value = 400;

    // Filter 2: Bandpass for the "pitter patter" high-end splash
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 3500;
    bandpass.Q.value = 1.0;

    // Filter 3: High-shelf to soften harsh digital highs
    const highShelf = ctx.createBiquadFilter();
    highShelf.type = 'highshelf';
    highShelf.frequency.value = 6000;
    highShelf.gain.value = -12;

    const rainGain = ctx.createGain();
    rainGain.gain.value = 0; // Start silent

    // Route: Noise -> Filters -> Gain -> SFX Bus
    noiseSource.connect(lowpass1);
    lowpass1.connect(rainGain);

    noiseSource.connect(bandpass);
    bandpass.connect(highShelf);
    highShelf.connect(rainGain);

    if (gameAudio.sfxGain) {
      rainGain.connect(gameAudio.sfxGain);
    } else {
      rainGain.connect(ctx.destination);
    }

    noiseSource.start(0);

    synthRef.current = {
      source: noiseSource,
      gain: rainGain,
      ctx: ctx,
    };

    return () => {
      try {
        noiseSource.stop();
      } catch (_e) {}
      noiseSource.disconnect();
      lowpass1.disconnect();
      bandpass.disconnect();
      highShelf.disconnect();
      rainGain.disconnect();
    };
  }, [audioReady]);

  useEffect(() => {
    if (!synthRef.current) return;
    const { gain, ctx } = synthRef.current;

    // Check state of the WebAudio context (user gesture restriction)
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const now = ctx.currentTime;
    // Fade in/out over 2 seconds
    gain.gain.cancelScheduledValues(now);

    if (isRaining) {
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0.3, now + 2.0); // Rain target volume
    } else {
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0.0, now + 2.0);
    }
  }, [isRaining, audioReady]);

  return null;
};

