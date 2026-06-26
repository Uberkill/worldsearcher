// @ts-nocheck
import { useEffect, Suspense, useRef } from 'react';
import { useSettingsStore } from './stores/useSettingsStore';
import { Canvas } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { ViewModel } from './components/ViewModel';
import { GhostBlock } from './components/GhostBlock';
import { ShipyardHologram } from './components/ShipyardHologram';
import { Flares } from './components/Flares';
import { Waypoints } from './components/Waypoints';
import { Lantern } from './components/Flashlight';
import { PostFX } from './components/PostFX';
import { Screenshot } from './components/Screenshot';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoadingScreen } from './components/LoadingScreen';
import { useStore } from './stores/useStore';
import { EventBus } from './utils/EventBus';
import { initItemDropSystem } from './systems/ItemDropSystem';
import { initQuestSystem } from './systems/QuestSystem';
import { initPhysicsReactionSystem } from './systems/PhysicsReactionSystem';
import { initCommandSystem } from './systems/CommandSystem';
import * as THREE from 'three';

import { GameUI } from './components/engine/GameUI';
import { GameGraphics } from './components/engine/GameGraphics';
import { GamePhysicsEntities } from './components/engine/GamePhysicsEntities';

export default function GameEngine() {
  const isWorldReady = useStore((state) => state.isWorldReady);
  const hasLoadedState = useStore((state) => state.hasLoadedState);
  const loadPlayerState = useStore((state) => state.loadPlayerState);
  const loadShipState = useStore((state) => state.loadShipState);
  const loadAchievements = useStore((state) => state.loadAchievements);
  const initializeQuests = useStore((state) => state.initializeQuests);
  const incrementPlaytime = useStore((state) => state.incrementPlaytime);
  const debugPhysics = useSettingsStore((state) => state.debugPhysics);

  const initRef = useRef(false);

  useEffect(() => {
    if (!initRef.current) {
      initRef.current = true;
      loadPlayerState();
      loadShipState();
      loadAchievements();
      initializeQuests();
      import('./systems/MachineTickSystem').then(({ initMachineTickSystem }) => {
        initMachineTickSystem();
      });
      window.__DEBUG_STORE__ = useStore;
    }
    
    // Initialize gameplay systems
    initItemDropSystem();
    initQuestSystem();
    initPhysicsReactionSystem();
    initCommandSystem();

    return () => {
      // Clear event bus listeners when game engine unmounts
      EventBus.clear();
    };
  }, []); // Run on mount

  useEffect(() => {
    if (hasLoadedState && isWorldReady) {
      const interval = setInterval(() => {
        incrementPlaytime();
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [hasLoadedState, isWorldReady, incrementPlaytime]);

  return (
    <>
      {(!isWorldReady || !hasLoadedState) && <LoadingScreen />}
      {hasLoadedState && (
        <>
          <GameUI />
          <ErrorBoundary>
            <Canvas
              id="main-webgl-canvas"
              shadows={{ type: THREE.PCFShadowMap }}
              dpr={[1, 1]}
              gl={{ antialias: false, powerPreference: 'high-performance' }}
              camera={{ fov: 75, near: 0.1, far: 600 }}
              onCreated={({ gl }) => {
                gl.domElement.addEventListener(
                  'webglcontextlost',
                  (e) => {
                    e.preventDefault();
                    console.error(
                      '[GameEngine] WebGL Context Lost! The GPU driver crashed or the browser suspended the tab.'
                    );
                    alert(
                      'Graphics Engine crashed (WebGL Context Lost). The browser suspended the tab or ran out of VRAM. Press OK to restart the game.'
                    );
                    window.location.reload();
                  },
                  false
                );
              }}
            >
              <Suspense fallback={null}>
                <GameGraphics />
                <Physics
                  debug={debugPhysics}
                  gravity={[0, -30, 0]}
                  timeStep="vary"
                >
                  <GamePhysicsEntities />
                </Physics>
              </Suspense>
              <ViewModel />
              <GhostBlock />
              <ShipyardHologram />
              <Flares />
              <Waypoints />
              <Lantern />
              <PostFX />
              <Screenshot />
            </Canvas>
          </ErrorBoundary>
        </>
      )}
    </>
  );
}

