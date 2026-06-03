import json
import re
import sys

with open('C:/Users/oob/.gemini/antigravity/brain/f6c1ef13-fa03-4eb1-96bf-db53748586fa/.system_generated/logs/transcript.jsonl', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for line in reversed(lines):
    if 'Showing lines 1 to 627' in line and 'greedyMesh.js' in line:
        try:
            obj = json.loads(line)
            print(list(obj.keys()))
            if 'tool_calls' in obj:
                print(obj['tool_calls'][0].keys())
                if 'response' in obj['tool_calls'][0]:
                    print(obj['tool_calls'][0]['response'].keys())
                    print('OUTPUT LENGTH:', len(obj['tool_calls'][0]['response'].get('output', '')))
            break
        except Exception as e:
            print(e)
