import json
import re
import sys

with open('C:/Users/oob/.gemini/antigravity/brain/f6c1ef13-fa03-4eb1-96bf-db53748586fa/.system_generated/logs/transcript.jsonl', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for line in reversed(lines):
    if 'Showing lines 1 to 627' in line and 'greedyMesh.js' in line:
        try:
            obj = json.loads(line)
            content = obj.get('content', '')
            if not content:
                content = obj.get('action', {}).get('response', {}).get('output', '')
            if not content:
                print('Found but no content field')
                continue
            
            output_lines = content.split('\n')
            result = []
            for l in output_lines:
                m = re.match(r'^[0-9]+: (.*)$', l)
                if m:
                    result.append(m.group(1))
                elif re.match(r'^[0-9]+:$', l):
                    result.append('')
            
            if len(result) > 500:
                with open('C:/Users/oob/.gemini/antigravity/scratch/Worldsearchyou/src/utils/greedyMesh.js', 'w', encoding='utf-8') as out:
                    out.write('\n'.join(result))
                print('Fixed greedyMesh.js, length:', len(result))
                sys.exit(0)
        except Exception as e:
            print(e)
