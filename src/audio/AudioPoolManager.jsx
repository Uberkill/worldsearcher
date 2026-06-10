import { useMemo, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { gameAudio } from './GameAudio';

import { setGlobalAudioPool } from './globalAudioPool';

export const AudioPoolManager = ({ poolSize = 15 }) => {
  const { camera } = useThree();
  
  useEffect(() => {
    // Initialize the GameAudioSystem with the camera so it can mount the AudioListener
    gameAudio.initialize(camera);
  }, [camera]);

  const voices = useMemo(() => {
    return Array.from({ length: poolSize }).map((_, i) => {
      const obj = new THREE.Object3D();
      return { id: i, obj, active: false, playing: false };
    });
  }, [poolSize]);

  useEffect(() => {
    setGlobalAudioPool({
      playSpatial: (
        soundName,
        positionArray,
        volume = 1.0,
        distanceParams = {}
      ) => {
        if (!gameAudio.initialized) return;

        // Prevent audio explosion on click by ignoring spatial requests while suspended
        if (gameAudio.context && gameAudio.context.state === 'suspended') return;

        // 1. Voice Culling (Concurrency)
        if (!gameAudio.canPlayVoice(soundName)) return;

        // 2. Distance Culling
        const distSq = camera.position.distanceToSquared(
          new THREE.Vector3(
            positionArray[0],
            positionArray[1],
            positionArray[2]
          )
        );
        const maxDist = distanceParams.maxDistance || 50;
        if (distSq > maxDist * maxDist) {
          gameAudio.releaseVoice(soundName);
          return;
        }

        // 3. Find available voice
        const voice = voices.find((v) => !v.active);
        if (!voice) {
          gameAudio.releaseVoice(soundName);
          return; // Pool exhausted
        }

        const buffer = gameAudio.getBuffer(soundName);
        if (!buffer) {
          gameAudio.releaseVoice(soundName);
          return;
        }

        voice.active = true;
        voice.soundName = soundName;
        voice.obj.position.set(
          positionArray[0],
          positionArray[1],
          positionArray[2]
        );
        voice.obj.updateMatrixWorld();

        // We create the PositionalAudio imperatively to attach it to the dummy Object3D
        if (!voice.audio) {
          voice.audio = new THREE.PositionalAudio(gameAudio.listener);
          voice.audio.setRefDistance(distanceParams.refDistance || 5);
          voice.audio.setMaxDistance(maxDist);
          voice.audio.setDistanceModel('linear');
          voice.audio.setRolloffFactor(1);
          voice.obj.add(voice.audio);
          
          voice.audio.voiceRef = voice;

          // Cleanup when finished, preserving Three.js internal state updates
          voice.audio.onEnded = function () {
            THREE.PositionalAudio.prototype.onEnded.call(this);
            if (this.voiceRef) {
              this.voiceRef.active = false;
              this.voiceRef.playing = false;
              gameAudio.releaseVoice(this.voiceRef.soundName);
            }
          };
        }

        voice.audio.setPlaybackRate(0.9 + Math.random() * 0.2);
        voice.audio.setVolume(volume);
        voice.audio.setBuffer(buffer);

        voice.audio.play();
        voice.playing = true;

        // Safety fallback to prevent pool leaks if onEnded doesn't fire
        if (voice.timeoutId) clearTimeout(voice.timeoutId);
        const durationMs = (buffer.duration * 1000) / voice.audio.playbackRate;
        voice.timeoutId = setTimeout(() => {
          if (voice.active && voice.playing) {
            voice.active = false;
            voice.playing = false;
            gameAudio.releaseVoice(voice.soundName);
          }
        }, durationMs + 200);

        // Dynamic Ducking for heavy impacts
        if (soundName === 'explosion') {
          gameAudio.triggerDucking();
        }
      },
    });

    return () => {
      setGlobalAudioPool(null);
    };
  }, [voices, camera]);

  return (
    <group>
      {voices.map((v) => (
        <primitive key={v.id} object={v.obj} />
      ))}
    </group>
  );
};
