const fs = require('fs');

const lines = fs.readFileSync('greedyMesh_log.txt', 'utf-8').split('\n');

for (let i = lines.length - 1; i >= 0; i--) {
    try {
        const lineStr = lines[i].replace(/^[^\{]*/, ''); // strip prefix if any
        if (!lineStr) continue;
        const data = JSON.parse(lineStr);
        // Find write_to_file or multi_replace_file_content that touches greedyMesh.js
        if (data.type === 'ACTION' && data.tool_calls) {
            for (const call of data.tool_calls) {
                if (call.name === 'write_to_file' || call.name === 'multi_replace_file_content') {
                    const args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments;
                    if (args.TargetFile && args.TargetFile.includes('greedyMesh.js')) {
                        if (args.CodeContent) {
                            fs.writeFileSync('src/utils/greedyMesh.js', args.CodeContent);
                            console.log("Restored from CodeContent");
                            process.exit(0);
                        }
                    }
                }
            }
        }
    } catch(e) {
    }
}
console.log("Not found");
