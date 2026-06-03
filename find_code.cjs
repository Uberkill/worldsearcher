const fs = require('fs');
const path = require('path');

const brainDir = 'C:\\Users\\oob\\.gemini\\antigravity\\brain';
const convos = ['e3dcd9eb-4358-43c2-bf48-a78e4bec83bb', 'f6c1ef13-fa03-4eb1-96bf-db53748586fa'];

let bestMatch = '';

for (const convo of convos) {
    const logPath = path.join(brainDir, convo, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(logPath)) continue;
    
    const lines = fs.readFileSync(logPath, 'utf-8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (line.includes('export const buildGreedyArrays') || line.includes('export function buildGreedyArrays') || line.includes('greedyMesh')) {
            try {
                const data = JSON.parse(line.replace(/^[^\{]*/, ''));
                if (data.type === 'ACTION' && data.tool_calls) {
                    for (const call of data.tool_calls) {
                        let args = call.arguments;
                        if (typeof args === 'string') args = JSON.parse(args);
                        if (args && args.CodeContent && args.CodeContent.includes('buildGreedyArrays')) {
                            bestMatch = args.CodeContent;
                            break;
                        }
                        if (args && args.ReplacementChunks) {
                             // We don't want partial chunks
                        }
                    }
                } else if (data.output && typeof data.output === 'string') {
                    if (data.output.includes('export const buildGreedyArrays') || data.output.includes('export function buildGreedyArrays')) {
                        // Found in a view_file output!
                        const lines = data.output.split('\n');
                        // strip the line numbers! (e.g. "1: import ...")
                        bestMatch = lines.map(l => l.replace(/^\d+:\s/, '')).join('\n');
                        // also strip the header "Created At..." and "File Path..."
                        const startIdx = bestMatch.indexOf('import');
                        if (startIdx !== -1) bestMatch = bestMatch.substring(startIdx);
                        break;
                    }
                }
            } catch(e) {}
        }
        if (bestMatch) break;
    }
    if (bestMatch) break;
}

if (bestMatch) {
    fs.writeFileSync('src/utils/greedyMesh.js', bestMatch);
    console.log('Restored from older transcript!');
} else {
    console.log('Not found in older logs');
}
