const fs = require('fs');
const path = require('path');

const files = [
  'src/components/AmbientAudio.jsx',
  'src/components/BlockInteraction.jsx',
  'src/components/DynamicCube.jsx',
  'src/components/FallingStructure.jsx'
];

for (const rel of files) {
  const fp = path.join(__dirname, rel);
  if (!fs.existsSync(fp)) continue;
  
  let code = fs.readFileSync(fp, 'utf-8');
  
  // Remove import lines
  code = code.replace(/import\s+\{.*useAudio.*\}\s+from\s+['"].*useAudio['"];?\n?/g, '');
  code = code.replace(/import\s+\{.*getAudioContext.*\}\s+from\s+['"].*useAudio['"];?\n?/g, '');
  
  // Replace useAudio() calls with dummy objects if they exist
  code = code.replace(/const\s+\{\s*playSound.*\}\s*=\s*useAudio\(\);/g, 'const playSound = () => {};');
  code = code.replace(/const\s+\{\s*playMusic.*\}\s*=\s*useAudio\(\);/g, 'const playMusic = () => {}; const stopMusic = () => {};');
  code = code.replace(/const\s+audio\s*=\s*useAudio\(\);/g, 'const audio = { playSound: () => {}, playMusic: () => {}, stopMusic: () => {} };');
  
  fs.writeFileSync(fp, code);
}
console.log('Audio imports removed!');
