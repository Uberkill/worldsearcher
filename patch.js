const fs = require('fs');

let p = fs.readFileSync('src/stores/createPlayerSlice.js', 'utf8');
p = p.replace(/import \{ getGameStore \} from '\.\/gameSlice';\r?\n/g, '');
p = p.replace(/import \{ addLaser, spawnVisualProjectile, destroyVisualProjectile \} from '\.\/combatActions';\r?\n/g, '');
p = p.replace(/const ns = getNetworkStore\(\)\.getState\(\);/g, '// const ns = getNetworkStore().getState();');
p = p.replace(/catch \(e\)/g, 'catch (_e)');
// Undo if it broke console.error
p = p.replace(/console\.error\(_e\)/g, 'console.error(_e)');
p = p.replace(/let spawnY = 260;/g, 'let spawnY;');
p = p.replace(/const lx = \(spawnX % 16 \+ 16\) % 16;/g, '// const lx = (spawnX % 16 + 16) % 16;');
p = p.replace(/const lz = \(spawnZ % 16 \+ 16\) % 16;/g, '// const lz = (spawnZ % 16 + 16) % 16;');
p = p.replace(/spawnY = 262;/g, '// spawnY = 262;');
fs.writeFileSync('src/stores/createPlayerSlice.js', p);

let w = fs.readFileSync('src/workers/dbWorker.js', 'utf8');
w = w.replace(/import \{ get, set, del \} from 'idb-keyval';/g, "import { get, del } from 'idb-keyval';");
fs.writeFileSync('src/workers/dbWorker.js', w);
