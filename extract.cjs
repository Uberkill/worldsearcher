const fs = require('fs');
const txt = fs.readFileSync('C:/Users/oob/.gemini/antigravity/brain/e3dcd9eb-4358-43c2-bf48-a78e4bec83bb/.system_generated/logs/transcript.jsonl', 'utf8');
const lines = txt.split('\n');
let best = '';
for (const line of lines) {
  if (!line) continue;
  try {
    const obj = JSON.parse(line);
    // Find where the AI made a tool call or response containing the code
    if (obj.content && obj.content.includes('export const buildGreedyArrays =') && obj.content.length > 5000) {
      best = obj.content;
      console.log('Found in a content block of length', best.length);
    } else if (obj.tool_calls) {
       for (const t of obj.tool_calls) {
          const str = JSON.stringify(t);
          if (str.includes('export const buildGreedyArrays =') && str.length > 5000) {
              best = str;
              console.log('Found in a tool call of length', str.length);
          }
       }
    }
  } catch(e) {}
}

if (best) {
  fs.writeFileSync('C:/Users/oob/.gemini/antigravity/scratch/Worldsearchyou/extracted.txt', best);
  console.log('Wrote extracted.txt');
} else {
  console.log('Not found');
}
