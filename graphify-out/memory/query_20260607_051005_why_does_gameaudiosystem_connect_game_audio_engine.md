---
type: "query"
date: "2026-06-07T05:10:05.137122+00:00"
question: "Why does GameAudioSystem connect Game Audio Engine to Game Audio & Settings State?"
contributor: "graphify"
source_nodes: ["GameAudioSystem", "GameAudio.js", "useStore", "useStore.js"]
---

# Q: Why does GameAudioSystem connect Game Audio Engine to Game Audio & Settings State?

## Answer

GameAudioSystem acts as the Web Audio API engine. It directly imports useStore from the state store to sync playback volume with the player settings. In initialize(), it sets up a Zustand store subscription for sfxVolume, musicVolume, and isMuted. When these setting values change in the UI, updateVolumes() pulls the new values and dynamically adjusts the sfxGain and musicGain buses. It also retrieves settings during triggerDucking() to ramp music volume down and smoothly recover to the user-defined level.

## Source Nodes

- GameAudioSystem
- GameAudio.js
- useStore
- useStore.js