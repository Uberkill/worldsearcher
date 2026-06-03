const fs = require('fs');

const path = 'C:\\Users\\oob\\.gemini\\antigravity\\brain\\4d4fc9eb-d63a-497a-a295-b74aedca85ad\\.system_generated\\logs\\transcript.jsonl';
const lines = fs.readFileSync(path, 'utf-8').split('\n');

let latestCode = null;

for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    try {
        const data = JSON.parse(line);
        if (data.type === 'ACTION' && data.tool_calls) {
            for (const call of data.tool_calls) {
                if (call.name === 'write_to_file' || call.name === 'multi_replace_file_content' || call.name === 'replace_file_content') {
                    let args = call.arguments;
                    if (typeof args === 'string') {
                        try { args = JSON.parse(args); } catch(e) {}
                    }
                    if (args && args.TargetFile && args.TargetFile.includes('greedyMesh.js')) {
                        if (call.name === 'write_to_file') {
                            latestCode = args.CodeContent;
                            break;
                        } else if (call.name === 'replace_file_content' || call.name === 'multi_replace_file_content') {
                             console.log("Found an edit to greedyMesh.js at index " + i + ", we need the full file!");
                             // If it's an edit, we still need the original write_to_file
                        }
                    }
                }
            }
        }
    } catch(e) {}
    if (latestCode) break;
}

if (latestCode) {
    fs.writeFileSync('src/utils/greedyMesh.js', latestCode);
    console.log("Restored greedyMesh.js from write_to_file! Length: " + latestCode.length);
} else {
    console.log("Could not find write_to_file for greedyMesh.js");
}
