const fs = require('fs');
const lines = fs.readFileSync('C:/Users/oob/.gemini/antigravity/brain/f6c1ef13-fa03-4eb1-96bf-db53748586fa/.system_generated/logs/transcript.jsonl', 'utf-8').split('\n');
for (let i = lines.length - 1; i >= 0; i--) {
  if (!lines[i]) continue;
  try {
    const obj = JSON.parse(lines[i]);
    let content = obj.content || (obj.action && obj.action.response && obj.action.response.output);
    if (content && typeof content === 'string' && content.includes('Showing lines 1 to 627') && content.includes('greedyMesh.js')) {
      const startIdx = content.indexOf('1: ');
      const endString = '\\nThe above content shows the entire';
      let endIdx = content.indexOf(endString);
      if (endIdx === -1) {
         endIdx = content.indexOf('The above content shows the entire');
      }
      if (endIdx === -1) {
         console.log('Cannot find end string. Ending manually.');
         endIdx = content.length;
      }
      let text = content.substring(startIdx, endIdx);
      text = text.replace(/\\n/g, '\n');
      text = text.replace(/\\"/g, '"');
      text = text.replace(/\\\\/g, '\\');
      text = text.replace(/^[0-9]+: /gm, '');
      fs.writeFileSync('C:/Users/oob/.gemini/antigravity/scratch/Worldsearchyou/src/utils/greedyMesh.js', text);
      console.log('Fixed greedyMesh.js, length:', text.length);
      break;
    }
  } catch(e) {}
}
