import fs from 'fs';
const path = 'src/components/Player.jsx';
let content = fs.readFileSync(path, 'utf8');

const replacements = [
  '{ x: 0, y: 0, z: 0 }, true',
  '{ x: 0, y: 0, z: 0 }, true',
  '{ x: linvel.x * 0.5, y: Math.max(linvel.y * 0.5, 12), z: linvel.z * 0.5 }, true',
  '{ x: 0, y: 0, z: 0 }, true',
  '{ x: 0, y: 0, z: 0 }, true',
  '{ x: 0, y: 0, z: 0 }, true',
  '{ x: 0, y: 0, z: 0 }, true',
  '{ x: 0, y: 0, z: 0 }, true',
  '{ x: 0, y: 0, z: 0 }, true',
  '{ x: 0, y: linvel.y, z: 0 }, true',
  '{ x: finalVel.x, y: finalVel.y, z: finalVel.z }, true',
  '{ x: _direction.x, y: flyY, z: _direction.z }, true',
  '{ x: _direction.x, y: linvel.y, z: _direction.z }, true',
  '{ x: linvel.x, y: 3, z: linvel.z }, true',
  '{ x: linvel.x, y: JUMP_FORCE * playerJumpMult, z: linvel.z }, true',
  '{ x: currentLinvel.x, y: -2, z: currentLinvel.z }, true',
  '{ x: currentLinvel.x, y: -35, z: currentLinvel.z }, true',
  '{ x: finalLinvel.x, y: Math.max(safeVelocityY, finalVelY), z: finalLinvel.z }, true',
];

let i = 0;
content = content.replace(
  /safeSetLinvel\(playerRef\.current, \{\}, \);/g,
  () => {
    if (i >= replacements.length)
      return 'safeSetLinvel(playerRef.current, { x: 0, y: 0, z: 0 }, true);';
    const replacement =
      'safeSetLinvel(playerRef.current, ' + replacements[i] + ');';
    i++;
    return replacement;
  }
);

fs.writeFileSync(path, content);
console.log('Restored Player.jsx linvels. Replaced: ' + i);
