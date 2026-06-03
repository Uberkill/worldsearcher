const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'src', 'index.css');
let css = fs.readFileSync(cssPath, 'utf8');

// Body background
css = css.replace(/background-color: #87CEEB; \/\* Sky color fallback \*\//, 'background-color: #1a0533; /* Alien sky fallback */');

// Crosshair
css = css.replace(
  /\.crosshair \{[\s\S]*?\}/,
  `.crosshair {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #00ffcc;
  font-size: 2rem;
  z-index: 100;
  pointer-events: none;
  text-shadow: 0 0 8px #00ffcc;
  font-weight: 400;
}`
);

// Active Item Name
css = css.replace(
  /\.active-item-name \{[\s\S]*?\}/,
  `.active-item-name {
  color: #00ffcc;
  font-size: 1.5rem;
  font-weight: 800;
  text-shadow: 0 0 8px rgba(0,255,204,0.8);
  background: rgba(10,15,30,0.6);
  padding: 6px 24px;
  border-radius: 4px;
  backdrop-filter: blur(8px);
  border: 1px solid #00ffcc;
  text-transform: uppercase;
  letter-spacing: 2px;
  box-shadow: 0 0 15px rgba(0,255,204,0.2);
}`
);

// Hotbar Container
css = css.replace(
  /\.hotbar-container \{[\s\S]*?\}/,
  `.hotbar-container {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: rgba(10, 15, 30, 0.6);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(0, 255, 204, 0.4);
  border-radius: 4px;
  box-shadow: 0 0 25px rgba(0, 255, 204, 0.15);
}`
);

// Hotbar groups
css = css.replace(/rgba\(255, 100, 100, 0\.15\)/g, 'rgba(255, 0, 85, 0.15)');
css = css.replace(/rgba\(255, 100, 100, 0\.3\)/g, 'rgba(255, 0, 85, 0.3)');
css = css.replace(/rgba\(100, 255, 100, 0\.15\)/g, 'rgba(0, 255, 204, 0.1)');
css = css.replace(/rgba\(100, 255, 100, 0\.3\)/g, 'rgba(0, 255, 204, 0.3)');
css = css.replace(/border-radius: 16px;/g, 'border-radius: 2px;');
css = css.replace(/border-radius: 12px;/g, 'border-radius: 2px;');
css = css.replace(/border-radius: 20px;/g, 'border-radius: 4px;');
css = css.replace(/border-radius: 24px;/g, 'border-radius: 4px;');
css = css.replace(/border-radius: 8px;/g, 'border-radius: 2px;');
css = css.replace(/border-radius: 6px;/g, 'border-radius: 0px;');

// Hotbar slot active
css = css.replace(
  /\.hotbar-slot\.active \{[\s\S]*?\}/,
  `.hotbar-slot.active {
  border-color: #00ffcc;
  background: rgba(0, 255, 204, 0.2);
  box-shadow: 0 0 15px rgba(0, 255, 204, 0.6), inset 0 0 10px rgba(0, 255, 204, 0.4);
  transform: translateY(-12px) scale(1.15);
}`
);

// Health bar
css = css.replace(
  /\.health-bar-bg \{[\s\S]*?\}/,
  `.health-bar-bg {
  width: 300px;
  height: 20px;
  background: rgba(20, 5, 10, 0.8);
  border-radius: 2px;
  border: 1px solid #ff0055;
  overflow: hidden;
  box-shadow: 0 0 15px rgba(255,0,85,0.4);
}`
);
css = css.replace(/text-shadow: 1px 1px 2px black;/g, 'text-shadow: 0 0 5px currentColor;');

// Menu title
css = css.replace(/color: #add8e6;/g, 'color: #00ffcc; text-shadow: 0 0 15px #00ffcc;');

// Menu container
css = css.replace(
  /\.menu-container \{[\s\S]*?\}/,
  `.menu-container {
  background: rgba(10, 15, 30, 0.85);
  border: 1px solid #00ffcc;
  border-radius: 4px;
  padding: 40px;
  text-align: center;
  box-shadow: 0 0 40px rgba(0,255,204,0.2);
  color: #e0f8ff;
  max-width: 500px;
  backdrop-filter: blur(20px);
}`
);

// Menu buttons
css = css.replace(
  /\.menu-btn \{[\s\S]*?\}/,
  `.menu-btn {
  background: rgba(0, 255, 204, 0.1);
  border: 1px solid #00ffcc;
  color: #00ffcc;
  padding: 12px 24px;
  border-radius: 2px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 2px;
  transition: all 0.2s;
}`
);
css = css.replace(
  /\.menu-btn:hover \{[\s\S]*?\}/,
  `.menu-btn:hover {
  background: rgba(0, 255, 204, 0.3);
  box-shadow: 0 0 15px rgba(0, 255, 204, 0.5);
}`
);
css = css.replace(
  /\.menu-btn\.danger:hover \{[\s\S]*?\}/,
  `.menu-btn.danger:hover {
  background: rgba(255, 0, 85, 0.3);
  border-color: #ff0055;
  color: #ff0055;
  box-shadow: 0 0 15px rgba(255, 0, 85, 0.5);
}`
);

// Clock
css = css.replace(
  /\.clock-container \{[\s\S]*?\}/,
  `.clock-container {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(10, 15, 30, 0.7);
  backdrop-filter: blur(12px);
  padding: 10px 24px;
  border-radius: 2px;
  border: 1px solid #00ffcc;
  display: flex;
  flex-direction: column;
  align-items: center;
  z-index: 1000;
  color: #00ffcc;
  text-shadow: 0 0 8px rgba(0,255,204,0.5);
}`
);

// Shop
css = css.replace(
  /\.shop-modal \{[\s\S]*?\}/,
  `.shop-modal {
  background: rgba(10, 15, 30, 0.95);
  border: 1px solid #ffaa00;
  padding: 32px;
  border-radius: 4px;
  width: 400px;
  color: #e0f8ff;
  box-shadow: 0 0 40px rgba(255, 170, 0, 0.3);
  display: flex;
  flex-direction: column;
  gap: 20px;
}`
);

fs.writeFileSync(cssPath, css);
console.log('CSS updated successfully!');
