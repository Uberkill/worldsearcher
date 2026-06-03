const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/components/ui/InGameUI.jsx');
let code = fs.readFileSync(filePath, 'utf-8');

code = code.replace(
  `import { audioManager } from "../../utils/AudioManager";\nimport { audioManager } from "../../utils/AudioManager";`,
  `import { audioManager } from "../../utils/AudioManager";`
);

fs.writeFileSync(filePath, code);
console.log('InGameUI patched!');
