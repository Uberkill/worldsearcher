// @ts-nocheck
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './utils/WebGLTracker.js';
import App from './App.jsx';

// Prevent unhandled promise rejections when UI opens/closes rapidly and hits the 1.25s browser cooldown
const originalRequestPointerLock = Element.prototype.requestPointerLock;
Element.prototype.requestPointerLock = function(...args) {
  try {
    const promise = originalRequestPointerLock.apply(this, args);
    if (promise) {
      promise.catch((err) => {
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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
window.addEventListener('error', (e) => {
  console.error('GLOBAL ERROR CAPTURED:', e.error?.stack || e.message);
});
window.addEventListener('error', (e) => {
  fetch('http://localhost:5174/', { method: 'POST', body: e.error?.stack || e.message }).catch(()=>{});
});

