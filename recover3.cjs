const fs = require('fs');
const lines = fs.readFileSync('C:/Users/oob/.gemini/antigravity/brain/f6c1ef13-fa03-4eb1-96bf-db53748586fa/.system_generated/logs/transcript.jsonl', 'utf-8').split('\n');
for (let i = lines.length - 1; i >= 0; i--) {
  if (!lines[i]) continue;
  try {
    const obj = JSON.parse(lines[i]);
    let content = obj.content || (obj.action && obj.action.response && obj.action.response.output);
    if (content && typeof content === 'string' && content.includes('Showing lines 1 to 627') && content.includes('greedyMesh.js')) {
      let result = [];
      const contentLines = content.split('\n');
      for (const line of contentLines) {
        if (/^[0-9]+: /.test(line)) {
          result.push(line.replace(/^[0-9]+: /, ''));
        }
      }
      fs.writeFileSync('C:/Users/oob/.gemini/antigravity/scratch/Worldsearchyou/src/utils/greedyMesh.js', result.join('\n'));
      console.log('Fixed greedyMesh.js, length:', result.join('\n').length);
      break;
    }
  } catch(e) {}
}
