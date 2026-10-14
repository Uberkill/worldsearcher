import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './utils/WebGLTracker.js';
import App from './App.jsx';

// Prevent unhandled promise rejections when UI opens/closes rapidly and hits the 1.25s browser cooldown
const originalRequestPointerLock = Element.prototype.requestPointerLock;
Element.prototype.requestPointerLock = function(this: Element, ...args: [options?: PointerLockOptions]): Promise<void> {
  try {
    const promise = originalRequestPointerLock.apply(this, args);
    if (promise && typeof promise.catch === 'function') {
      promise.catch((err: Error) => {
        if (err.name === 'SecurityError') {
          console.warn('Pointer lock cooldown active. Click again shortly.');
        } else if (err.name === 'NotAllowedError') {
          console.warn('Pointer lock not allowed. Check iframe allow="pointer-lock" attribute.');
        } else {
          console.error(err);
        }
      });
    }
    return promise;
  } catch (err) {
    console.warn('Failed to request pointer lock (likely iframe cross-origin restriction):', err);
    return Promise.reject(err);
  }
};

document.addEventListener('contextmenu', (e) => e.preventDefault());

// Ensure iframe captures focus for keyboard input when hovered
window.addEventListener('mouseenter', () => window.focus());
window.addEventListener('click', () => window.focus());

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
