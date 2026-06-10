/* eslint-disable */
import fs from 'fs';
import {
  generateChunkPass1,
  generateChunkPass2,
} from '../src/utils/chunkGenerator.js';
import { buildGreedyArrays } from '../src/utils/greedyMesh.js';

// Setup mock globals
global.window = {};

const cx = 0;
const cz = 0;
const seed = 12345;

try {
  const pass1 = generateChunkPass1(cx, cz, seed);
  console.log(
    'Pass 1 completed. Highest surface block:',
    pass1.getSurfaceHeightMap[0]
  );

  const packedBuffer = new Uint32Array(pass1.buffer);
  const { buffer: newBuffer, overflow } = generateChunkPass2(
    cx,
    cz,
    packedBuffer,
    pass1.getSurfaceHeightMap,
    seed
  );

  console.log('Pass 2 completed. Checking for Flora in buffer...');
  let floraFound = 0;
  for (let i = 0; i < newBuffer.length; i++) {
    const val = newBuffer[i];
    const tex = val & 0xff;
    if (tex === 15 || tex === 16 || tex === 17) {
      floraFound++;
    }
  }
  console.log(`Found ${floraFound} flora blocks in chunk buffer!`);

  console.log('Running Greedy Mesher...');
  const meshArrays = buildGreedyArrays(newBuffer, cx, cz, []);

  const floraArr = meshArrays.__flora;
  console.log(
    `Flora Float32Array length: ${floraArr.length}. Instances: ${floraArr.length / 6}`
  );

  if (floraArr.length > 0) {
    console.log('First Flora Instance Data:');
    console.log(`  X: ${floraArr[0]}`);
    console.log(`  Y: ${floraArr[1]}`);
    console.log(`  Z: ${floraArr[2]}`);
    console.log(`  BlockId: ${floraArr[3]}`);
    console.log(`  SunLight: ${floraArr[4]}`);
    console.log(`  BlockLight: ${floraArr[5]}`);
  }
} catch (e) {
  console.error('Test failed:', e);
}
