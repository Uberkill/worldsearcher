import { useEffect, Suspense, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { Player } from './components/Player';
import { FPV } from './components/FPV';
import { Screenshot } from './components/Screenshot';
import { ViewModel } from './components/ViewModel';
import { Cubes } from './components/Cubes';
import { Hotbar } from './components/Hotbar';
import InGameUI from './components/ui/InGameUI';
import { Minimap } from './components/Minimap';
import { AmbientAudio } from './components/AmbientAudio';
import { AudioPoolManager } from './audio/AudioPoolManager';
import { AchievementPopup } from './components/AchievementPopup';
import { Crosshair } from './components/Crosshair';
import { DynamicSky } from './components/DynamicSky';
import { Enemies } from './components/Enemies';
import { Bullets } from './components/Bullets';
import { Lasers } from './components/Lasers';
import { Tether } from './components/Tether';
import * as THREE from 'three';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GhostBlock } from './components/GhostBlock';
import { DroppedItems } from './components/DroppedItems';
import { Tombstones } from './components/Tombstones';
import { HostCombat } from './components/HostCombat';
import { DeathScreen } from './components/DeathScreen';
import { WeatherSystem } from './components/WeatherSystem';
import { ChunkManager } from './components/ChunkManager';
import { AutoSaveManager } from './components/AutoSaveManager';
import { LoadingScreen } from './components/LoadingScreen';
import { PostFX } from './components/PostFX';
import { Lantern } from './components/Flashlight';
import { Flares } from './components/Flares';
import { BlockInteraction } from './components/BlockInteraction';
import { MultiplayerManager } from './components/MultiplayerManager';
import { TransitManager } from './components/TransitManager';
import { ShipPhysics } from './components/ShipPhysics';
import { ShipyardHologram } from './components/ShipyardHologram';
import { useStore } from './stores/useStore';
import { DebugOverlay } from './components/DebugOverlay';
import { DebugTracker } from './components/DebugTracker';
import { SpectorModal } from './components/ui/SpectorModal';
import { Waypoints } from './components/Waypoints';
import { EventBus } from './utils/EventBus';
import { initItemDropSystem } from './systems/ItemDropSystem';
import { initQuestSystem } from './systems/QuestSystem';
import { initPhysicsReactionSystem } from './systems/PhysicsReactionSystem';


const LiquidOverlay = () => {
  const submerged = useStore((state) => state.submergedLiquid);
  if (!submerged) return null;

  if (submerged === 'lava') {
    return (
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background:
            'radial-gradient(circle, rgba(255,100,0,0.85) 0%, rgba(180,20,0,0.95) 60%, rgba(80,0,0,1.0) 100%)',
          opacity: 0.92,
          pointerEvents: 'none',
          zIndex: 40,
        }}
      />
    );
  }

  if (submerged === 'water') {
    return (
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background:
            'linear-gradient(to bottom, rgba(14, 165, 233, 0.4) 0%, rgba(3, 105, 161, 0.7) 100%)',
          pointerEvents: 'none',
          zIndex: 40,
          mixBlendMode: 'color',
        }}
      />
    );
  }
  return null;
};

export default function GameEngine() {
  const isWorldReady = useStore((state) => state.isWorldReady);
  const hasLoadedState = useStore((state) => state.hasLoadedState);
  const loadPlayerState = useStore((state) => state.loadPlayerState);
  const loadShipState = useStore((state) => state.loadShipState);
  const loadAchievements = useStore((state) => state.loadAchievements);
  const initializeQuests = useStore((state) => state.initializeQuests);
  const renderDistance = useStore((state) => state.renderDistance);
  const incrementPlaytime = useStore((state) => state.incrementPlaytime);
  const debugPhysics = useStore((state) => state.debugPhysics);

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
          <DebugOverlay />
          <AchievementPopup />
          <AmbientAudio />
          <Crosshair />
          <Hotbar />

          <InGameUI />
          <DeathScreen />
          <Minimap />
          <LiquidOverlay />
          <SpectorModal />
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
                <ChunkManager />
                <AudioPoolManager />
                <AutoSaveManager />
                <DebugTracker />
                {/* Fog density scales inversely with render distance */}
                <fogExp2
                  attach="fog"
                  args={['#301040', 1.0 / (renderDistance * 14)]}
                />
                <DynamicSky />
                <WeatherSystem />
                <FPV />
                <Physics
                  debug={debugPhysics}
                  gravity={[0, -30, 0]}
                  timeStep="vary"
                >
                  <Player />
                  <Cubes />
                  <Enemies />
                  <Bullets />
                  <Lasers />
                  <Tether />
                  <DroppedItems />
                  <Tombstones />
                  <HostCombat />
                  <MultiplayerManager />
                  <TransitManager />
                  <ShipPhysics />
                  <BlockInteraction />
                </Physics>
                {/* {liveTracking.current && <EnvironmentMap />} */}
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
