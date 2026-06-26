// @ts-nocheck
import { useSettingsStore } from '../stores/useSettingsStore';

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useStore } from '../stores/useStore';
import { useChunkStore } from '../stores/chunkSlice';
import { useSyncStore } from '../stores/syncSlice';

import { networkActions } from '../stores/networkActions';
import { playerPosition } from '../globals';


const UNLOAD_GRACE_MS = 4000; // Reduced from 15s: shorter grace drains GPU memory faster

const buildOffsets = (dist) => {
  const offsets = [];
  for (let x = -dist; x <= dist; x++)
    for (let z = -dist; z <= dist; z++)
      offsets.push({ x, z, d: Math.abs(x) + Math.abs(z) });
  offsets.sort((a, b) => a.d - b.d);
  return offsets;
};

// ── Boundary Sweep Generator ──
function* chunkSweep(
  currentCx,
  currentCz,
  renderDistance,
  knownChunks,
  failedChunks,
  chunksToCheck,
  pendingUnloadsMap
) {
  const desiredChunks = new Set();
  const toLoad = [];

  // Step 1: Identify desired chunks and un-cancel them (Render Distance + 1 for boundary padding!)
  const padR = renderDistance + 1;
  for (let x = -padR; x <= padR; x++) {
    for (let z = -padR; z <= padR; z++) {
      const cx = currentCx + x;
      const cz = currentCz + z;
      const chunkKey = `${cx},${cz}`;
      desiredChunks.add(chunkKey);

      // Queue for loading if not yet known
      if (!knownChunks.has(chunkKey)) {
        const failCount = failedChunks.get(chunkKey) || 0;
        if (failCount < 3) {
          toLoad.push({ cx, cz, dist: Math.abs(x) + Math.abs(z), chunkKey });
        }
      }
    }
  }

  // Step 2: Schedule UNLOAD for out-of-bounds chunks (Prioritized to free memory!)
  // Apply 15-second hysteresis to prevent DB thrashing
  const now = Date.now();
  for (const key of chunksToCheck) {
    if (!desiredChunks.has(key)) {
      if (!pendingUnloadsMap.has(key)) {
        pendingUnloadsMap.set(key, now);
      } else if (now - pendingUnloadsMap.get(key) > UNLOAD_GRACE_MS) {
        yield { type: 'UNLOAD', chunkKey: key };
        pendingUnloadsMap.delete(key);
      }
    } else {
      pendingUnloadsMap.delete(key); // Cancel pending unload if player walks back
    }
  }

  // Sort by distance
  toLoad.sort((a, b) => a.dist - b.dist);

  // Step 3: Issue Load Requests
  for (const item of toLoad) {
    yield { type: 'LOAD', ...item };
  }

  yield { type: 'DONE', desiredChunks };
}

const _sharedPhysicsSet = new Set();

export const ChunkManager = () => {
  const loadChunkAsync = useStore((state) => state.loadChunkAsync);
  const setPlayerChunk = useStore((state) => state.setPlayerChunk);
  const setWorldReady = useStore((state) => state.setWorldReady);
  const setLoadingProgress = useStore((state) => state.setLoadingProgress);

  const knownChunks = useRef(new Set());
  const pass1Chunks = useRef(new Set());
  const pass2Chunks = useRef(new Set());
  const failedChunks = useRef(new Map());
  const pendingUnloadsMap = useRef(new Map());
  const lastPlayerCx = useRef(null);
  const lastPlayerCz = useRef(null);
  const booted = useRef(false);

  const sweepGen = useRef(null);
  const liveTracking = useRef(false);
  const frameCount = useRef(0);
  const gateFrameSkip = useRef(0); // Throttle checkPass2Gate to every 3 frames

  const worldEpoch = useSyncStore((state) => state.worldEpoch);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__DEBUG_KNOWN_CHUNKS__ = knownChunks.current;
      window.__DEBUG_PASS1_CHUNKS__ = pass1Chunks.current;
      window.__DEBUG_PASS2_CHUNKS__ = pass2Chunks.current;
      window.__DEBUG_FAILED_CHUNKS__ = failedChunks.current;
    }
  });

  const checkPass2Gate = (force = false) => {
    if (!force) {
      gateFrameSkip.current++;
      if (gateFrameSkip.current < 3) return;
      gateFrameSkip.current = 0;
    }

    // Cache these outside the loop — was calling getState() once per chunk (O(n) store reads)
    const R = useSettingsStore.getState().renderDistance;
    const playerCx = lastPlayerCx.current;
    const playerCz = lastPlayerCz.current;

    let dispatchedThisFrame = 0;
    const MAX_PASS2_PER_FRAME = 2;

    for (const chunkKey of pass1Chunks.current) {
      if (dispatchedThisFrame >= MAX_PASS2_PER_FRAME) break;
      if (pass2Chunks.current.has(chunkKey)) continue; // Already DECORATED

      const [sCx, sCz] = chunkKey.split(',');
      const cCx = parseInt(sCx, 10);
      const cCz = parseInt(sCz, 10);

      if (
        playerCx !== null &&
        (Math.abs(cCx - playerCx) > R + 1 || Math.abs(cCz - playerCz) > R + 1)
      ) {
        // Only skip the outermost ring of BUFFER chunks (> R+1).
        // Previously used > R which permanently blocked the padded ring (distance == R+1)
        // from ever reaching Pass 2. Those chunks sat in pass1Cache forever, causing
        // the "17 failed chunks at cz=-9" pattern seen in the diagnostics dump.
        continue;
      }

      let neighborsReady = true;

      for (let nx = -1; nx <= 1; nx++) {
        for (let nz = -1; nz <= 1; nz++) {
          if (nx === 0 && nz === 0) continue;
          const neighborKey = `${cCx + nx},${cCz + nz}`;
          if (
            !pass1Chunks.current.has(neighborKey) &&
            !pass2Chunks.current.has(neighborKey)
          ) {
            neighborsReady = false;
            break;
          }
        }
        if (!neighborsReady) break;
      }

      if (neighborsReady) {
        dispatchedThisFrame++;
        pass2Chunks.current.add(chunkKey);
        pass1Chunks.current.delete(chunkKey);
        useStore
          .getState()
          .loadChunkPass2Async(cCx, cCz)
          .then((success) => {
            if (!knownChunks.current.has(chunkKey)) return;

            if (success === false) {
              // Pass2 returned false: fatal worker error
              pass2Chunks.current.delete(chunkKey);
              knownChunks.current.delete(chunkKey);
              useStore.getState().unloadChunk(chunkKey);
              const fails = failedChunks.current.get(chunkKey) || 0;
              failedChunks.current.set(chunkKey, fails + 1);
              const cooldown = fails + 1 < 3 ? 5000 : 30000;
              setTimeout(() => {
                failedChunks.current.delete(chunkKey);
              }, cooldown);
              lastPlayerCx.current = null;
            } else if (success === 'CANCELLED') {
              // Pass2 was cancelled mid-flight (chunk unloaded, player moved away)
              // put it back — the gate will retry when neighbors are still ready
              pass2Chunks.current.delete(chunkKey);
              if (knownChunks.current.has(chunkKey)) {
                pass1Chunks.current.add(chunkKey);
              }
            } else if (success === 'NO_DATA') {
              // pass1Cache was evicted (worker crash / DataCloneError / context loss).
              // The chunk has NO terrain data to re-mesh. Must fully evict so the
              // sweep re-queues a fresh loadChunkAsync on the next boundary check.
              pass2Chunks.current.delete(chunkKey);
              pass1Chunks.current.delete(chunkKey);
              knownChunks.current.delete(chunkKey);
              useStore.getState().unloadChunk(chunkKey);
              // Short cooldown before allowing re-load to avoid hammering crashed workers
              const fails = failedChunks.current.get(chunkKey) || 0;
              failedChunks.current.set(chunkKey, fails + 1);
              const cooldown = fails + 1 < 3 ? 2000 : 30000;
              setTimeout(() => {
                failedChunks.current.delete(chunkKey);
                lastPlayerCx.current = null; // Force next-frame sweep to re-check
              }, cooldown);
            }
          })
          .catch((err) => {
            console.error(`Pass 2 failed for ${chunkKey}:`, err);
            pass2Chunks.current.delete(chunkKey);
            knownChunks.current.delete(chunkKey);
            useStore.getState().unloadChunk(chunkKey);
            const fails = failedChunks.current.get(chunkKey) || 0;
            failedChunks.current.set(chunkKey, fails + 1);
            const cooldown = fails + 1 < 3 ? 5000 : 30000;
            setTimeout(() => {
              failedChunks.current.delete(chunkKey);
            }, cooldown);
            lastPlayerCx.current = null;
          });
      }
    }
  };

  useEffect(() => {
    console.log('[ChunkManager] MOUNTED! Starting chunk generation...');
  }, []);

  useEffect(() => {
    knownChunks.current.clear();
    pass1Chunks.current.clear();
    pass2Chunks.current.clear();
    failedChunks.current.clear();
    lastPlayerCx.current = null;
    lastPlayerCz.current = null;
    booted.current = false;
    sweepGen.current = null;
    liveTracking.current = false;
  }, [worldEpoch]);

  useEffect(() => {
    let isMounted = true;
    if (booted.current) return;
    booted.current = true;

    const BOOT_DISTANCE = 2; // Progressive boot: only load immediate vicinity (5x5 grid)
    // Max concurrent worker jobs during boot. Restored to 25 to allow all boot chunks to fetch
    // from the host/DB simultaneously, significantly speeding up the initial load screen!
    const BOOT_CONCURRENCY = 25;

    const initialPos = [playerPosition.x, playerPosition.y, playerPosition.z];
    const SPAWN_CX = Math.floor(initialPos[0] / 16);
    const SPAWN_CZ = Math.floor(initialPos[2] / 16);

    const bootOffsets = buildOffsets(BOOT_DISTANCE);
    const total = bootOffsets.length;
    let confirmed = 0;

    // Phase 1 — Load boot chunks in concurrency-limited batches.
    // Firing all 25 at once fills the worker queue and makes the loading
    // screen stall at 0% while the JS microtask queue drains.
    const runBootChunk = ({ x, z }) => {
      const cx = SPAWN_CX + x;
      const cz = SPAWN_CZ + z;
      const chunkKey = `${cx},${cz}`;

      if (!isMounted) return Promise.resolve('CANCELLED');

      knownChunks.current.add(chunkKey);
      return loadChunkAsync(cx, cz)
        .then((success) => {
          if (!isMounted) return 'CANCELLED';
          if (success === 'CANCELLED' || success === false) {
            knownChunks.current.delete(chunkKey);
            failedChunks.current.set(chunkKey, (failedChunks.current.get(chunkKey) || 0) + 1);
            if (failedChunks.current.get(chunkKey) < 3) {
              return new Promise(resolve => setTimeout(() => resolve(runBootChunk({ x, z })), 500));
            }
          } else if (success === 'DECORATED') {
            pass2Chunks.current.add(chunkKey);
          } else if (success === 'PRISTINE' || success === true) {
            pass1Chunks.current.add(chunkKey);
          } else {
            console.error(`[ChunkManager] Chunk ${chunkKey} failed to load! success=`, success);
            knownChunks.current.delete(chunkKey);
            useStore.getState().unloadChunk(chunkKey);
            const fails = failedChunks.current.get(chunkKey) || 0;
            failedChunks.current.set(chunkKey, fails + 1);
            const cooldown = fails + 1 < 3 ? 5000 : 30000;
            if (fails + 1 < 3 && isMounted) {
              setTimeout(() => {
                if (!isMounted) return;
                lastPlayerCx.current = null; // Force sweep retry after cooldown!
              }, cooldown);
            }
          }
          confirmed++;
          if (isMounted && (confirmed % 3 === 0 || confirmed === total)) {
            setLoadingProgress(Math.floor((confirmed / total) * 100));
          }
        })
        .catch((err) => {
          console.error(`Chunk load failed during boot for ${chunkKey}:`, err);
          knownChunks.current.delete(chunkKey);
          useStore.getState().unloadChunk(chunkKey);
          const fails = failedChunks.current.get(chunkKey) || 0;
          failedChunks.current.set(chunkKey, fails + 1);
          const cooldown = fails + 1 < 3 ? 5000 : 30000;
          setTimeout(() => {
            failedChunks.current.delete(chunkKey);
          }, cooldown);
          confirmed++;
          if (isMounted && (confirmed % 3 === 0 || confirmed === total)) {
            setLoadingProgress(Math.floor((confirmed / total) * 100));
          }
        });
    };

    // Semaphore: run at most BOOT_CONCURRENCY loads at a time
    const bootQueue = [...bootOffsets];
    const bootPromises = [];
    const runNext = () => {
      if (bootQueue.length === 0) return Promise.resolve();
      const item = bootQueue.shift();
      return runBootChunk(item).then(runNext);
    };
    for (let i = 0; i < Math.min(BOOT_CONCURRENCY, bootOffsets.length); i++) {
      bootPromises.push(runNext());
    }

    // Phase 2 — Wait until every chunk key is confirmed in Zustand state, and physically mounted
    Promise.all(bootPromises).then(() => {
      if (!isMounted) return;
      setLoadingProgress(100);
      setPlayerChunk(SPAWN_CX, SPAWN_CZ);
      
      const verifyOffsets = buildOffsets(BOOT_DISTANCE - 1);
      const keysToVerify = verifyOffsets.map(({ x: dx, z: dz }) => `${SPAWN_CX + dx},${SPAWN_CZ + dz}`);
      
      let verifyCount = 0;
      const verifyVisuals = () => {
        if (!isMounted) return;

        // Force Pass 2 processing during the boot sequence
        checkPass2Gate(true);

        const chunkState = useChunkStore.getState();
        const chunks = chunkState.chunks;
        verifyCount++;
        const missingChunks = [];
        
        const allMounted = keysToVerify.every(k => {
          const c = chunks[k];
          if (failedChunks.current.get(k) >= 3) return true;
          const mounted = c && c.meshArrays && c.meshArrays._isMounted === true;
          if (!mounted) missingChunks.push({
             key: k,
             hasC: !!c,
             inPass1: pass1Chunks.current.has(k),
             inPass2: pass2Chunks.current.has(k),
             inFlight: useChunkStore.getState().inFlightChunks?.has(k) || false,
             failedCount: failedChunks.current.get(k) || 0
          });
          return mounted;
        });

        if (!allMounted && verifyCount % 20 === 0) {
          console.log('[DEBUG] Missing:', JSON.stringify(missingChunks));
          console.log('[DEBUG] Queue states: inFlight:', useChunkStore.getState().inFlightChunks?.size);
        }

        if (allMounted) {
          // Wait for WASM physics BVH ingestion (approx 3 frames at 60fps ~ 50ms)
          setTimeout(() => {
            if (!isMounted) return;
            setWorldReady();
            liveTracking.current = true;
          }, 100);
        } else {
          setTimeout(verifyVisuals, 50);
        }
      };
      
      verifyVisuals();
    }).catch(err => {
      console.error("[ChunkManager] Boot sequence failed:", err);
      if (!isMounted) return;
      setLoadingProgress(100);
      setWorldReady();
      liveTracking.current = true;
    });

    const p1 = pass1Chunks.current;
    const p2 = pass2Chunks.current;

    return () => {
      isMounted = false;
      booted.current = false;


      // Unload ALL known chunks to prevent memory leaks when switching worlds/disconnecting!
      const store = useStore.getState();
      for (const chunkKey of knownChunks.current) {
        store.unloadChunk(chunkKey);
      }
      knownChunks.current.clear();
      p1.clear();
      p2.clear();
    };
    
    }, [worldEpoch]);

  const updatePhysicsGrid = (currentCx, currentCz) => {
    _sharedPhysicsSet.clear();
    const addGrid = (cx, cz) => {
      if (!Number.isFinite(cx) || !Number.isFinite(cz)) return;
      for (let x = -2; x <= 2; x++) {
        for (let z = -2; z <= 2; z++) {
          _sharedPhysicsSet.add(`${cx + x},${cz + z}`);
        }
      }
    };

    addGrid(currentCx, currentCz);

    const networkState = networkActions.getState();
    if (networkState.players) {
      for (const pId in networkState.players) {
        const p = networkState.players[pId];
        if (p && p.pos) {
          const px = p.pos[0];
          const pz = p.pos[2];
          if (Number.isFinite(px) && Number.isFinite(pz)) {
            addGrid(Math.floor(px / 16), Math.floor(pz / 16));
          }
        }
      }
    }

    const storeState = useStore.getState();
    if (storeState.enemies) {
      for (const eId in storeState.enemies) {
        const e = storeState.enemies[eId];
        if (e && e.position) {
          const ex = e.position[0];
          const ez = e.position[2];
          if (Number.isFinite(ex) && Number.isFinite(ez)) {
            addGrid(Math.floor(ex / 16), Math.floor(ez / 16));
          }
        }
      }
    }

    const activePhysicsChunks = Array.from(_sharedPhysicsSet).sort();
    const prevPhysics = useChunkStore.getState().activePhysicsChunks || [];
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
    if (physicsChanged) {
      useChunkStore.getState().shadowSetActivePhysics(activePhysicsChunks);
    }
  };

  // checkPass2Gate has been moved above the useEffect hook to be in scope for verifyVisuals

  const renderDistance = useSettingsStore((state) => state.renderDistance);
  useEffect(() => {
    // Force a new sweep immediately if the user changes Render Distance in settings
    lastPlayerCx.current = null;
  }, [renderDistance]);

  useFrame(() => {
    if (!liveTracking.current) return;

    // Catch NaN glitches from physics bugs to prevent requesting chunk_NaN,NaN
    if (Number.isNaN(playerPosition.x) || Number.isNaN(playerPosition.z))
      return;

    const currentCx = Math.floor(playerPosition.x / 16);
    const currentCz = Math.floor(playerPosition.z / 16);

    // Throttle physics grid update to once every 3 frames
    frameCount.current++;
    if (frameCount.current % 3 === 0) {
      updatePhysicsGrid(currentCx, currentCz);
    }

    // ── Periodic force-sweep to drain the pending-unload backlog ─────────────
    // The sweep only fires on chunk-boundary crossing. If the player stands
    // still, the 59-chunk unload queue never drains and VBO memory accumulates.
    // Force a re-sweep every 120 frames (~2s at 60fps) regardless of movement.
    if (frameCount.current % 120 === 0 && !sweepGen.current) {
      lastPlayerCx.current = null; // Invalidate cache → triggers sweep next frame
    }



    // Only trigger sweep if we cross a chunk boundary
    if (
      currentCx !== lastPlayerCx.current ||
      currentCz !== lastPlayerCz.current
    ) {
      lastPlayerCx.current = currentCx;
      lastPlayerCz.current = currentCz;
      setPlayerChunk(currentCx, currentCz);

      const chunksToCheck = new Set(knownChunks.current);

      sweepGen.current = chunkSweep(
        currentCx,
        currentCz,
        useSettingsStore.getState().renderDistance || 8,
        knownChunks.current,
        failedChunks.current,
        chunksToCheck,
        pendingUnloadsMap.current
      );
    }

    // Advance the generator by processing chunks per frame.
    if (sweepGen.current) {
      let loadSteps = 0;
      let totalSteps = 0;
      const MAX_LOADS_PER_FRAME = 6;
      while (totalSteps < 50) {
        const { value, done } = sweepGen.current.next();
        if (done) {
          if (window.__DEBUG_STATS__) {
            window.__DEBUG_STATS__.failedChunks = failedChunks.current.size;
            window.__DEBUG_STATS__.failedChunkKeys = Array.from(
              failedChunks.current.keys()
            );
            window.__DEBUG_STATS__.desiredChunksCount =
              value && value.desiredChunks ? value.desiredChunks.size : 0;
          }
          sweepGen.current = null;
          break;
        }

        totalSteps++;

        if (value.type === 'LOAD') {
          const { chunkKey, cx, cz } = value;
          knownChunks.current.add(chunkKey);
          loadChunkAsync(cx, cz)
            .then((success) => {
              if (!knownChunks.current.has(chunkKey)) return;

              if (success === 'CANCELLED') {
                knownChunks.current.delete(chunkKey);
              } else if (success === 'DECORATED') {
                pass2Chunks.current.add(chunkKey);
              } else if (success === 'PRISTINE' || success === true) {
                if (knownChunks.current.has(chunkKey)) {
                  pass1Chunks.current.add(chunkKey);
                }
              } else {
                // success === false or NO_DATA
                knownChunks.current.delete(chunkKey);
                useStore.getState().unloadChunk(chunkKey);
                const fails = failedChunks.current.get(chunkKey) || 0;
                failedChunks.current.set(chunkKey, fails + 1);
                const cooldown = fails + 1 < 3 ? 5000 : 30000;
                setTimeout(() => {
                  failedChunks.current.delete(chunkKey);
                  lastPlayerCx.current = null; // Force sweep retry after cooldown!
                }, cooldown);
              }
            })
            .catch((_err) => {
              knownChunks.current.delete(chunkKey);
              useStore.getState().unloadChunk(chunkKey);
              const fails = failedChunks.current.get(chunkKey) || 0;
              failedChunks.current.set(chunkKey, fails + 1);
              const cooldown = fails + 1 < 3 ? 5000 : 30000;
              setTimeout(() => {
                failedChunks.current.delete(chunkKey);
              }, cooldown);
            });

          loadSteps++;
          if (loadSteps >= MAX_LOADS_PER_FRAME) {
            break;
          }
        } else if (value.type === 'UNLOAD') {
          const key = value.chunkKey;
          useStore.getState().unloadChunk(key);
          
          // IMMEDIATE FORGET: 
          // Drop it from React's internal arrays to hand over control to Engine GC natively.
          knownChunks.current.delete(key);
          pass1Chunks.current.delete(key);
          pass2Chunks.current.delete(key);
        }
      }
    }

    // Run Pass 2 Gate check every frame (it's fast)
    checkPass2Gate();
  });

  return null;
};

