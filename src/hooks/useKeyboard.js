import { useCallback, useEffect, useState } from 'react';

function actionByKey(key) {
  const keyActionMap = {
    KeyW: 'moveForward',
    KeyS: 'moveBackward',
    KeyA: 'moveLeft',
    KeyD: 'moveRight',
    Space: 'jump',
    ShiftLeft: 'sprint',
    ShiftRight: 'sprint',
    Digit1: 'slot1',
    Digit2: 'slot2',
    Digit3: 'slot3',
    Digit4: 'slot4',
    Digit5: 'slot5',
    Digit6: 'slot6',
    Digit7: 'slot7',
    Digit8: 'slot8',
    Digit9: 'slot9',
    KeyE: 'inventory',
    KeyQ: 'dropItem',
  };
  return keyActionMap[key];
}

export const useKeyboard = () => {
  const [actions, setActions] = useState({
    moveForward: false,
    moveBackward: false,
    moveLeft: false,
    moveRight: false,
    jump: false,
    slot1: false,
    slot2: false,
    slot3: false,
    slot4: false,
    slot5: false,
    slot6: false,
    slot7: false,
    slot8: false,
    slot9: false,
    inventory: false,
    sprint: false,
    dropItem: false,
  });

  const handleKeyDown = useCallback((e) => {
    if (e.repeat) return; // Prevent OS key repeat from causing constant React re-renders

    // Ignore all inputs if user is typing in a text field
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const action = actionByKey(e.code);
    if (action) {
      // Prevent movement if the game isn't capturing the mouse
      if (
        !document.pointerLockElement &&
        [
          'moveForward',
          'moveBackward',
          'moveLeft',
          'moveRight',
          'jump',
          'sprint',
        ].includes(action)
      ) {
        return;
      }
      setActions((prev) => ({
        ...prev,
        [action]: true,
      }));
    }
  }, []);

  const handleKeyUp = useCallback((e) => {
    const action = actionByKey(e.code);
    if (action) {
      setActions((prev) => ({
        ...prev,
        [action]: false,
      }));
    }
  }, []);

  useEffect(() => {
    const handlePointerLockChange = () => {
      if (!document.pointerLockElement) {
        setActions((prev) => ({
          ...prev,
          moveForward: false,
          moveBackward: false,
          moveLeft: false,
          moveRight: false,
          jump: false,
          sprint: false,
        }));
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('pointerlockchange', handlePointerLockChange);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener(
        'pointerlockchange',
        handlePointerLockChange
      );
    };
  }, [handleKeyDown, handleKeyUp]);

  return actions;
};
