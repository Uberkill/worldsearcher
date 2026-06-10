import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './utils/WebGLTracker.js';
import App from './App.jsx';

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
