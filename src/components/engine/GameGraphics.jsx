import { ChunkManager } from '../ChunkManager';
import { AutoSaveManager } from '../AutoSaveManager';
import { DebugTracker } from '../DebugTracker';
import { DynamicSky } from '../DynamicSky';
import { WeatherSystem } from '../WeatherSystem';
import { FPV } from '../FPV';
import { AudioPoolManager } from '../../audio/AudioPoolManager';
import { useStore } from '../../stores/useStore';

export const GameGraphics = () => {
  const renderDistance = useStore((state) => state.renderDistance);
  return (
    <>
      <ChunkManager />
      <AudioPoolManager />
      <AutoSaveManager />
      <DebugTracker />
      <fogExp2 attach="fog" args={['#301040', 1.0 / (renderDistance * 14)]} />
      <DynamicSky />
      <WeatherSystem />
      <FPV />
    </>
  );
};
