const fs = require('fs');
const log = fs.readFileSync('C:/Users/oob/.gemini/antigravity/brain/f6c1ef13-fa03-4eb1-96bf-db53748586fa/.system_generated/logs/transcript.jsonl', 'utf-8');
const lines = log.split('\n');
let contentStr = '';
for(let i = lines.length-1; i>=0; i--){
  if(lines[i].includes('Showing lines 1 to 627') && lines[i].includes('greedyMesh.js')) {
     const obj = JSON.parse(lines[i]);
     contentStr = obj.content || (obj.action && obj.action.response && obj.action.response.output);
     break;
  }
}
const outputLines = contentStr.split('\n');
let result = [];
for(let l of outputLines) {
  let m = l.match(/^[0-9]+: (.*)$/);
  if(m) {
     result.push(m[1]);
  } else if (l.match(/^[0-9]+:$/)) {
     result.push('');
  }
}
fs.writeFileSync('C:/Users/oob/.gemini/antigravity/scratch/Worldsearchyou/src/utils/greedyMesh.js', result.join('\n'));
console.log('Fixed', result.length);
