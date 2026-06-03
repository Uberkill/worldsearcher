const fs = require('fs');
const lines = fs.readFileSync('C:/Users/oob/.gemini/antigravity/brain/f6c1ef13-fa03-4eb1-96bf-db53748586fa/.system_generated/logs/transcript.jsonl', 'utf-8').split('\n');
for (let i = lines.length - 1; i >= 0; i--) {
  if (!lines[i]) continue;
  if (lines[i].includes('Showing lines 1 to 627') && lines[i].includes('greedyMesh.js')) {
    const startIdx = lines[i].indexOf('1: ');
    const endIdx = lines[i].indexOf('\\nThe above content shows the entire');
    if (startIdx === -1 || endIdx === -1) {
      console.log('Found but indices are wrong');
      continue;
    }
    let text = lines[i].substring(startIdx, endIdx);
    text = text.replace(/\\n/g, '\n');
    text = text.replace(/\\"/g, '"');
    text = text.replace(/^[0-9]+: /gm, '');
    fs.writeFileSync('C:/Users/oob/.gemini/antigravity/scratch/Worldsearchyou/src/utils/greedyMesh.js', text);
    console.log('Fixed greedyMesh.js');
    break;
  }
}
