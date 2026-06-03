import json
import re

with open('C:/Users/oob/.gemini/antigravity/brain/65a54536-5a84-43b4-b5d0-c890b5f53b5a/.system_generated/logs/transcript.jsonl', 'r', encoding='utf-8') as f:
    for line in f:
        try:
            obj = json.loads(line)
            if obj.get('type') == 'VIEW_FILE' and obj.get('status') == 'DONE':
                content = obj.get('content', '')
                if 'greedyMesh.js' in content and 'Showing lines 1 to 627' in content:
                    lines = content.split('\n')
                    result = []
                    started = False
                    for l in lines:
                        if l.startswith('1: '):
                            started = True
                        if started:
                            if 'The above content shows the entire' in l:
                                break
                            m = re.match(r'^[0-9]+: (.*)$', l)
                            if m:
                                result.append(m.group(1))
                            elif re.match(r'^[0-9]+:$', l):
                                result.append('')
                    
                    if len(result) > 500:
                        with open('C:/Users/oob/.gemini/antigravity/scratch/Worldsearchyou/src/utils/greedyMesh.js', 'w', encoding='utf-8') as out:
                            out.write('\n'.join(result))
                        print('Successfully restored greedyMesh.js, length:', len(result))
                        exit(0)
        except Exception as e:
            pass
print('Failed to find file.')
