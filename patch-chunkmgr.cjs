const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/components/ChunkManager.jsx');
let code = fs.readFileSync(filePath, 'utf-8');

// Import useFrame
if (!code.includes('useFrame')) {
   code = code.replace(/import { useEffect, useRef } from 'react';/, `import { useEffect, useRef } from 'react';\nimport { useFrame } from '@react-three/fiber';`);
}

// Replace boot logic
const bootRegex = /const bootPromises = bootOffsets\.map[\s\S]*?startLiveTracking\(\);\n      }\);\n\n      return \(\) => \{[\s\S]*?\}\, \[\]\);/m;

const newBoot = `const bootPromises = bootOffsets.map(({ x, z }, i) => {
        const cx       = SPAWN_CX + x;
        const cz       = SPAWN_CZ + z;
        const chunkKey = \`\${cx},\${cz}\`;
        knownChunks.current.add(chunkKey);
  
        return new Promise(resolve => {
          loadChunkAsync(cx, cz).then((success) => {
            if (success === "PRISTINE" || success === true) {
                pass1Chunks.current.add(chunkKey);
            }
            confirmed++;
            setLoadingProgress(Math.floor((confirmed / total) * 100));
            resolve();
          });
        });
      });
  
      Promise.all(bootPromises).then(() => {
        setWorldReady();
        // startLiveTracking is removed, now we rely on useFrame!
      });
  
      return () => {
        for (const [chunkKey, id] of pendingUnloads.current.entries()) {
          clearTimeout(id);
          unloadChunk(chunkKey);
        }
        pendingUnloads.current.clear();
        pass1Chunks.current.clear();
        pass2Chunks.current.clear();
      };
    }, []);`;

code = code.replace(bootRegex, newBoot);

// Replace startLiveTracking with useFrame
const liveRegex = /const sleep = \(ms\) => new Promise\(r => setTimeout\(r, ms\)\);\n\n  const startLiveTracking = \(\) => \{[\s\S]*?  \};\n\n  return null;\n\};/m;

const newLive = `const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  
  // Phase 7: Chunk Boundary Trigger (O(1) execution instead of static interval)
  useFrame(() => {
      if (!booted.current) return;
      
      const currentCx = Math.floor(playerPosition.x / 16);
      const currentCz = Math.floor(playerPosition.z / 16);
      
      // ONLY run the heavy GC and Load logic if the player crossed a chunk boundary!
      if (currentCx === lastPlayerCx.current && currentCz === lastPlayerCz.current) {
          return; 
      }
      
      lastPlayerCx.current = currentCx;
      lastPlayerCz.current = currentCz;
      setPlayerChunk(currentCx, currentCz);

      // --- Compute Entity-Aware Physics Grid ---
      const physicsSet = new Set();
      const addPhysicsGrid = (cx, cz) => {
        for (let x = -1; x <= 1; x++) {
          for (let z = -1; z <= 1; z++) {
            physicsSet.add(\`\${cx + x},\${cz + z}\`);
          }
        }
      };

      // 1. Local Player
      addPhysicsGrid(currentCx, currentCz);

      // 2. Network Players
      const networkState = useNetworkStore.getState();
      if (networkState.players) {
          for (const pId in networkState.players) {
            const p = networkState.players[pId];
            if (p && p.pos) {
                addPhysicsGrid(Math.floor(p.pos[0] / 16), Math.floor(p.pos[2] / 16));
            }
          }
      }

      // 3. Enemies
      const storeState = useStore.getState();
      if (storeState.enemies) {
          for (const eId in storeState.enemies) {
            const e = storeState.enemies[eId];
            if (e && e.position) {
                addPhysicsGrid(Math.floor(e.position[0] / 16), Math.floor(e.position[2] / 16));
            }
          }
      }
      
      // Update physics chunks if changed
      const activePhysicsChunks = Array.from(physicsSet);
      const prevPhysics = storeState.activePhysicsChunks;
      let physicsChanged = false;
      if (prevPhysics.length !== activePhysicsChunks.length) {
          physicsChanged = true;
      } else {
          for (let i = 0; i < activePhysicsChunks.length; i++) {
            if (activePhysicsChunks[i] !== prevPhysics[i]) {
                physicsChanged = true;
                break;
            }
          }
      }
      if (physicsChanged && storeState.setActivePhysicsChunks) {
          storeState.setActivePhysicsChunks(activePhysicsChunks);
      }
      // ----------------------------------------

      const RENDER_DISTANCE = storeState.renderDistance;
      const GC_BUFFER = 4; // Phase 7: explicit GC horizon buffer
      const MAX_DIST = RENDER_DISTANCE + GC_BUFFER;
      
      const desiredChunks = new Set();
      const toLoad        = [];

      // Step 1 - Compute desired set + cancel any pending unloads for chunks
      for (let x = -RENDER_DISTANCE; x <= RENDER_DISTANCE; x++) {
        for (let z = -RENDER_DISTANCE; z <= RENDER_DISTANCE; z++) {
          const cx       = currentCx + x;
          const cz       = currentCz + z;
          const chunkKey = \`\${cx},\${cz}\`;
          desiredChunks.add(chunkKey);

          if (pendingUnloads.current.has(chunkKey)) {
            clearTimeout(pendingUnloads.current.get(chunkKey));
            pendingUnloads.current.delete(chunkKey);
            loadChunkAsync(cx, cz).catch(() => {});
          }

          if (!knownChunks.current.has(chunkKey) && !failedChunks.current.has(chunkKey)) {
            toLoad.push({ cx, cz, dist: Math.abs(x) + Math.abs(z), chunkKey });
          }
        }
      }

      // Step 2 - Load new chunks FIRST (Pass 1)
      if (toLoad.length > 0) {
        toLoad.sort((a, b) => a.dist - b.dist);
        toLoad.forEach(({ chunkKey, cx, cz, dist }) => {
          knownChunks.current.add(chunkKey);
          loadChunkAsync(cx, cz)
            .then((success) => {
               if (success === "CANCELLED") {
                   knownChunks.current.delete(chunkKey);
               } else if (success === "DECORATED") {
                   pass1Chunks.current.add(chunkKey);
                   pass2Chunks.current.add(chunkKey);
               } else if (success === "PRISTINE" || success === true) {
                   pass1Chunks.current.add(chunkKey);
               } else {
                   knownChunks.current.delete(chunkKey);
                   failedChunks.current.add(chunkKey);
               }
            })
            .catch((err) => {
               knownChunks.current.delete(chunkKey);
               failedChunks.current.add(chunkKey);
            });
        });
      }
      
      // Step 2.5 - The Pass 2 Gate (Decorators)
      for (const chunkKey of pass1Chunks.current) {
         if (pass2Chunks.current.has(chunkKey)) continue;
         
         const [sCx, sCz] = chunkKey.split(',');
         const cCx = parseInt(sCx, 10);
         const cCz = parseInt(sCz, 10);
         
         let neighborsReady = true;
         for (let nx = -1; nx <= 1; nx++) {
           for (let nz = -1; nz <= 1; nz++) {
             if (nx === 0 && nz === 0) continue;
             const neighborKey = \`\${cCx + nx},\${cCz + nz}\`;
             if (!pass1Chunks.current.has(neighborKey) && !pass2Chunks.current.has(neighborKey)) {
                neighborsReady = false;
                break;
             }
           }
           if (!neighborsReady) break;
         }
         
         if (neighborsReady) {
            pass2Chunks.current.add(chunkKey);
            useStore.getState().loadChunkPass2Async(cCx, cCz).catch(() => pass2Chunks.current.delete(chunkKey));
         }
      }

      // Step 3 - Schedule DEFERRED unloads for chunks that left the desired range.
      const chunksToCheck = new Set([...knownChunks.current, ...Object.keys(storeState.chunks)]);
      for (const key of chunksToCheck) {
        if (!desiredChunks.has(key) && !pendingUnloads.current.has(key)) {
          // Check if it exceeds GC Horizon
          const [cx, cz] = key.split(',').map(Number);
          const currentDistance = Math.max(Math.abs(cx - currentCx), Math.abs(cz - currentCz));
          
          if (currentDistance > MAX_DIST) {
              useStore.getState().cancelLoadChunk(key);
    
              const id = setTimeout(() => {
                knownChunks.current.delete(key);
                pass1Chunks.current.delete(key);
                pass2Chunks.current.delete(key);
                pendingUnloads.current.delete(key);
                // Phase 7: Async Unload with validation lock!
                unloadChunk(key, currentCx, currentCz, MAX_DIST);
              }, UNLOAD_GRACE_MS);
              pendingUnloads.current.set(key, id);
          }
        }
      }

      // Step 4 - Export Telemetry
      if (window.__DEBUG_STATS__) {
          window.__DEBUG_STATS__.pendingUnloads = pendingUnloads.current.size;
          window.__DEBUG_STATS__.failedChunks = failedChunks.current.size;
          window.__DEBUG_STATS__.desiredChunksCount = desiredChunks.size;
      }
  });

  return null;
};`;

code = code.replace(liveRegex, newLive);

fs.writeFileSync(filePath, code);
console.log('ChunkManager patched for useFrame GC trigger!');
