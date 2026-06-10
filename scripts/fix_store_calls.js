const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'stores', 'worldActions.js');
let content = fs.readFileSync(filePath, 'utf8');

// Replace requestMeshRebuild calls
const updated1 = content.replace(/useChunkStore\.getState\(\)\.requestMeshRebuild/g, 'get().requestMeshRebuild');
// Replace queueBuffersForRecycling calls
const updated2 = updated1.replace(/useChunkStore\.getState\(\)\.queueBuffersForRecycling/g, 'get().queueBuffersForRecycling');

if (content !== updated2) {
  fs.writeFileSync(filePath, updated2, 'utf8');
  console.log('Successfully fixed useChunkStore calls in worldActions.js');
} else {
  console.log('No changes needed or matching strings found.');
}
