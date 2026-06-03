const fs = require('fs');
const path = require('path');
const readline = require('readline');

const brainDir = 'C:\\Users\\oob\\.gemini\\antigravity\\brain';

async function getLastModelMessage(transcriptPath) {
  if (!fs.existsSync(transcriptPath)) return "No transcript found";
  
  const fileStream = fs.createReadStream(transcriptPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  
  let lastModelMsg = null;
  
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.source === 'MODEL' && entry.type === 'PLANNER_RESPONSE') {
        lastModelMsg = entry.content;
      }
    } catch(e) {}
  }
  
  return lastModelMsg;
}

const subagents = [
  {name: 'Engine Auditor', id: '65a54536-5a84-43b4-b5d0-c890b5f53b5a'},
  {name: 'Logic Auditor', id: 'ab4d3075-380a-4bf4-bd21-2b2395dd2212'},
  {name: 'UI Auditor', id: '4add88ac-6ca8-44ee-9efd-487f8016aab9'},
  {name: 'Data Auditor', id: 'fb7a4348-423f-4059-bb05-8bf7b224b8e5'},
  {name: 'Generation Auditor', id: '88ee3aa8-fd6a-4fa9-a15e-bbae21426fc9'},
  {name: 'Physics Auditor', id: '28109963-782e-4dae-b0ab-69a7bf737874'},
  {name: 'Network Security Auditor', id: '089e0959-e6aa-4b38-8a63-f9d86cb2058f'},
  {name: 'Database Auditor', id: 'e68bca8d-079c-4465-8389-ec7da1630c23'},
  {name: 'Frontend Architect', id: '477ad1bf-dc71-4143-82b3-7256fc037256'},
  {name: 'Block Sync Auditor', id: '457a4bdb-a5ad-4ab5-9cea-8a855c943732'}
];

async function main() {
  for (const agent of subagents) {
    const p = path.join(brainDir, agent.id, '.system_generated', 'logs', 'transcript.jsonl');
    const msg = await getLastModelMessage(p);
    console.log(`\n\n--- ${agent.name} ---`);
    console.log(msg ? msg.substring(0, 1500) : "None");
  }
}

main();
