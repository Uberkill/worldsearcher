import React, { useState } from 'react';
import TitleScreen from './components/ui/TitleScreen'; 
import GameEngine from './GameEngine'; 
import { ErrorBoundary } from './components/ErrorBoundary';
import CustomCursor from './components/ui/CustomCursor';
import { SpectorModal } from './components/ui/SpectorModal';

import { initWorldSeed } from './worldSeed';

export default function App() {
  const [gameState, setGameState] = useState('menu'); // 'menu' or 'playing'

  const handleStart = (slotId) => {
    sessionStorage.setItem('saveSlotId', slotId);
    initWorldSeed();
    setGameState('playing');
  };

  return (
    <>
      <CustomCursor />
      <ErrorBoundary>
        <SpectorModal />
      </ErrorBoundary>
      {gameState === 'menu' ? (
        <ErrorBoundary>
          <TitleScreen onStartNew={handleStart} onContinue={handleStart} />
        </ErrorBoundary>
      ) : (
        <ErrorBoundary>
          <GameEngine />
        </ErrorBoundary>
      )}
    </>
  );
}
