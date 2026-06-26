import { ChunkManager } from '../ChunkManager';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { AutoSaveManager } from '../AutoSaveManager';
import { DebugTracker } from '../DebugTracker';
import { DynamicSky } from '../DynamicSky';
import { WeatherSystem } from '../WeatherSystem';
import { FPV } from '../FPV';
import { AudioPoolManager } from '../../audio/AudioPoolManager';
import { useStore } from '../../stores/useStore';

export const GameGraphics = () => {
  const renderDistance = useSettingsStore((state) => state.renderDistance);
  return (
    <>
      <ChunkManager />
      <AudioPoolManager />
      <AutoSaveManager />
      <DebugTracker />
      <fog attach="fog" args={['#301040', renderDistance * 16 * 0.4, renderDistance * 16 * 0.95]} />
      <DynamicSky />
      <WeatherSystem />
      <FPV />
    </>
  );
};
