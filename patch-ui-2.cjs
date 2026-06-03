const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/components/ui/InGameUI.jsx');
let code = fs.readFileSync(filePath, 'utf-8');

code = `import { audioManager } from "../../utils/AudioManager";\n` + code;

fs.writeFileSync(filePath, code);
console.log('InGameUI patched!');
