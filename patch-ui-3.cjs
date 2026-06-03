const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/components/ui/InGameUI.jsx');
let code = fs.readFileSync(filePath, 'utf-8');

code = code.replace(/import\s+\{\s*audioManager\s*\}\s*from\s*['"].*AudioManager['"];?/g, '');
code = `import { audioManager } from "../../utils/AudioManager";\n` + code;

fs.writeFileSync(filePath, code);
console.log('InGameUI patched for real!');
