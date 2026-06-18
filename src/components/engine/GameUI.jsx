import { DebugOverlay } from '../DebugOverlay';
import { AchievementPopup } from '../AchievementPopup';
import { AmbientAudio } from '../AmbientAudio';
import { Crosshair } from '../Crosshair';
import { Hotbar } from '../Hotbar';
import InGameUI from '../ui/InGameUI';
import { DeathScreen } from '../DeathScreen';
import { Minimap } from '../Minimap';
import { SpectorModal } from '../ui/SpectorModal';
import { useStore } from '../../stores/useStore';

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

export const GameUI = () => (
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
  </>
);
