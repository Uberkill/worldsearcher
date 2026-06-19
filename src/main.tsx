import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './utils/WebGLTracker.js';
import App from './App.jsx';

// Prevent unhandled promise rejections when UI opens/closes rapidly and hits the 1.25s browser cooldown
const originalRequestPointerLock = Element.prototype.requestPointerLock;
Element.prototype.requestPointerLock = function(...args) {
  const promise = originalRequestPointerLock.apply(this, args);
  if (promise) {
    promise.catch((err) => {
      if (err.name !== 'SecurityError') {
        console.error(err);
      } else {
        console.warn('Pointer lock cooldown active. Click again shortly.');
      }
    });
  }
  return promise;
};

document.addEventListener('contextmenu', (e) => e.preventDefault());

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
