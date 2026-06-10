import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useStore } from '../stores/useStore';
import { useChunkStore } from '../stores/chunkSlice';
import { useEnvironmentStore } from '../stores/environmentSlice';
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

// ── Time-Sliced Boundary Sweep Generator ──
function* chunkSweep(
  currentCx,
  currentCz,
  renderDistance,
  knownChunks,
  pendingUnloads,
  failedChunks,
  chunksToCheck
) {
  const desiredChunks = new Set();
  const toLoad = [];
  let ops = 0;

  // Step 1: Identify desired chunks and un-cancel them (Render Distance + 1 for boundary padding!)
  const padR = renderDistance + 1;
  for (let x = -padR; x <= padR; x++) {
    for (let z = -padR; z <= padR; z++) {
      const cx = currentCx + x;
      const cz = currentCz + z;
      const chunkKey = `${cx},${cz}`;
      desiredChunks.add(chunkKey);

      // Cancel pending unload if this chunk is back in range
      if (pendingUnloads.has(chunkKey)) {
        clearTimeout(pendingUnloads.get(chunkKey));
        pendingUnloads.delete(chunkKey);
        yield { type: 'RELOAD', cx, cz, chunkKey };
      }

      // Queue for loading if not yet known
      if (!knownChunks.has(chunkKey) && !failedChunks.has(chunkKey)) {
        toLoad.push({ cx, cz, dist: Math.abs(x) + Math.abs(z), chunkKey });
      }

      ops++;
      if (ops >= 30) {
        ops = 0;
        yield { type: 'YIELD' };
      }
    }
  }

  // Sort by distance
  toLoad.sort((a, b) => a.dist - b.dist);

  // Step 2: Issue Load Requests
  ops = 0;
  for (const item of toLoad) {
    yield { type: 'LOAD', ...item };
    ops++;
    if (ops >= 40) {
      // Limit to 40 load requests per frame
      ops = 0;
      yield { type: 'YIELD' };
    }
  }

  // Step 3: Schedule DEFERRED unloads
  ops = 0;
  for (const key of chunksToCheck) {
    if (!desiredChunks.has(key) && !pendingUnloads.has(key)) {
      yield { type: 'UNLOAD', chunkKey: key };
    }
    ops++;
    if (ops >= 30) {
      ops = 0;
      yield { type: 'YIELD' };
    }
  }

  yield { type: 'DONE', desiredChunks };
}

export const ChunkManager = () => {
  const loadChunkAsync = useStore((state) => state.loadChunkAsync);
  const unloadChunk = useStore((state) => state.unloadChunk);
  const setPlayerChunk = useStore((state) => state.setPlayerChunk);
  const setWorldReady = useStore((state) => state.setWorldReady);
  const setLoadingProgress = useStore((state) => state.setLoadingProgress);

  const knownChunks = useRef(new Set());
  const pass1Chunks = useRef(new Set());
  const pass2Chunks = useRef(new Set());
  const pendingUnloads = useRef(new Map());
  const failedChunks = useRef(new Set());
  const lastPlayerCx = useRef(null);
  const lastPlayerCz = useRef(null);
  const booted = useRef(false);

  const sweepGen = useRef(null);
  const liveTracking = useRef(false);
  const frameCount = useRef(0);
  const gateFrameSkip = useRef(0); // Throttle checkPass2Gate to every 3 frames


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
      knownChunks.current.add(chunkKey);
      return loadChunkAsync(cx, cz)
        .then((success) => {
          if (success === 'CANCELLED' || success === false) {
            knownChunks.current.delete(chunkKey);
          } else if (success === 'DECORATED') {
            pass2Chunks.current.add(chunkKey);
          } else if (success === 'PRISTINE' || success === true) {
            pass1Chunks.current.add(chunkKey);
          } else {
            knownChunks.current.delete(chunkKey);
            failedChunks.current.add(chunkKey);
            setTimeout(() => failedChunks.current.delete(chunkKey), 5000);
          }
          confirmed++;
          if (isMounted && (confirmed % 3 === 0 || confirmed === total)) {
            setLoadingProgress(Math.floor((confirmed / total) * 100));
          }
        })
        .catch((err) => {
          console.error(`Chunk load failed during boot for ${chunkKey}:`, err);
          knownChunks.current.delete(chunkKey);
          failedChunks.current.add(chunkKey);
          setTimeout(() => failedChunks.current.delete(chunkKey), 5000);
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

    // Phase 2 — Wait until every chunk key is confirmed in Zustand state
    Promise.all(bootPromises).then(async () => {
      if (!isMounted) return;
      setLoadingProgress(100);
      setPlayerChunk(SPAWN_CX, SPAWN_CZ);
      // Let React mount all Chunk components + physics colliders
      await new Promise((r) => setTimeout(r, 1500));
      if (!isMounted) return;
      setWorldReady();
      liveTracking.current = true;
    });

    const unloads = pendingUnloads.current;
    const p1 = pass1Chunks.current;
    const p2 = pass2Chunks.current;

    return () => {
      isMounted = false;
      booted.current = false;
      console.log(`[ChunkManager] UNMOUNTING! Cleanup running.`);
      // Cancel any pending unload timeouts on unmount and explicitly unload them
      for (const [chunkKey, id] of unloads.entries()) {
        clearTimeout(id);
      }
      unloads.clear();

      // Unload ALL known chunks to prevent memory leaks when switching worlds/disconnecting!
      const store = useStore.getState();
      for (const chunkKey of knownChunks.current) {
        store.unloadChunk(chunkKey);
      }
      knownChunks.current.clear();
      p1.clear();
      p2.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updatePhysicsGrid = (currentCx, currentCz) => {
    const physicsSet = new Set();
    const addGrid = (cx, cz) => {
      for (let x = -2; x <= 2; x++) {
        for (let z = -2; z <= 2; z++) {
          physicsSet.add(`${cx + x},${cz + z}`);
        }
      }
    };

    addGrid(currentCx, currentCz);

    const networkState = networkActions.getState();
    if (networkState.players) {
      for (const pId in networkState.players) {
        const p = networkState.players[pId];
        if (p && p.pos) {
          addGrid(Math.floor(p.pos[0] / 16), Math.floor(p.pos[2] / 16));
        }
      }
    }

    const storeState = useStore.getState();
    if (storeState.enemies) {
      for (const eId in storeState.enemies) {
        const e = storeState.enemies[eId];
        if (e && e.position) {
          addGrid(
            Math.floor(e.position[0] / 16),
            Math.floor(e.position[2] / 16)
          );
        }
      }
    }

    const activePhysicsChunks = Array.from(physicsSet);
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

  const checkPass2Gate = () => {
    // Throttle: run only every 3 frames. Pass2 gate is not time-critical
    // and 200-chunk sets produce ~1600 Set.has() calls per frame without this.
    gateFrameSkip.current++;
    if (gateFrameSkip.current < 3) return;
    gateFrameSkip.current = 0;

    // Cache these outside the loop — was calling getState() once per chunk (O(n) store reads)
    const R = useStore.getState().renderDistance;
    const playerCx = lastPlayerCx.current;
    const playerCz = lastPlayerCz.current;

    for (const chunkKey of pass1Chunks.current) {
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
        pass2Chunks.current.add(chunkKey);
        pass1Chunks.current.delete(chunkKey);
        useStore
          .getState()
          .loadChunkPass2Async(cCx, cCz)
          .then((success) => {
            if (success === false) {
              // Pass2 returned false: fatal worker error
              pass2Chunks.current.delete(chunkKey);
              knownChunks.current.delete(chunkKey);
              failedChunks.current.add(chunkKey);
              setTimeout(() => failedChunks.current.delete(chunkKey), 5000);
              lastPlayerCx.current = null;
            } else if (success === 'CANCELLED') {
              // Pass2 was cancelled mid-flight (chunk unloaded, player moved away)
              // put it back — the gate will retry when neighbors are still ready
              pass2Chunks.current.delete(chunkKey);
              pass1Chunks.current.add(chunkKey);
            } else if (success === 'NO_DATA') {
              // pass1Cache was evicted (worker crash / DataCloneError / context loss).
              // The chunk has NO terrain data to re-mesh. Must fully evict so the
              // sweep re-queues a fresh loadChunkAsync on the next boundary check.
              pass2Chunks.current.delete(chunkKey);
              pass1Chunks.current.delete(chunkKey);
              knownChunks.current.delete(chunkKey);
              // Short cooldown before allowing re-load to avoid hammering crashed workers
              failedChunks.current.add(chunkKey);
              setTimeout(() => {
                failedChunks.current.delete(chunkKey);
                lastPlayerCx.current = null; // Force next-frame sweep to re-check
              }, 2000);
            }
          })
          .catch((err) => {
            console.error(`Pass 2 failed for ${chunkKey}:`, err);
            pass2Chunks.current.delete(chunkKey);
            knownChunks.current.delete(chunkKey);
            failedChunks.current.add(chunkKey);
            setTimeout(() => failedChunks.current.delete(chunkKey), 5000);
            lastPlayerCx.current = null;
          });
      }
    }
  };

  const renderDistance = useStore((state) => state.renderDistance);
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

    // Throttle physics grid update to once every 10 frames
    frameCount.current++;
    if (frameCount.current % 10 === 0) {
      updatePhysicsGrid(currentCx, currentCz);
    }

    // ── Periodic force-sweep to drain the pending-unload backlog ─────────────
    // The sweep only fires on chunk-boundary crossing. If the player stands
    // still, the 59-chunk unload queue never drains and VBO memory accumulates.
    // Force a re-sweep every 120 frames (~2s at 60fps) regardless of movement.
    if (frameCount.current % 120 === 0 && !sweepGen.current) {
      lastPlayerCx.current = null; // Invalidate cache → triggers sweep next frame
    }



    // Only trigger sweep if we cross a chunk boundary and aren't already sweeping
    if (
      (currentCx !== lastPlayerCx.current ||
        currentCz !== lastPlayerCz.current) &&
      !sweepGen.current
    ) {
      lastPlayerCx.current = currentCx;
      lastPlayerCz.current = currentCz;
      setPlayerChunk(currentCx, currentCz);

      const chunksToCheck = new Set([
        ...knownChunks.current,
        ...Object.keys(useChunkStore.getState().chunks || {}),
      ]);

      sweepGen.current = chunkSweep(
        currentCx,
        currentCz,
        useStore.getState().renderDistance,
        knownChunks.current,
        pendingUnloads.current,
        failedChunks.current,
        chunksToCheck
      );
    }

    // Advance the generator by processing chunks per frame.
    // Budget lowered to 2 to prevent flooding IndexedDB with queries per second, which freezes the browser.
    if (sweepGen.current) {
      let steps = 0;
      while (steps < 2) {
        const { value, done } = sweepGen.current.next();
        if (done) {
          if (window.__DEBUG_STATS__) {
            window.__DEBUG_STATS__.pendingUnloads = pendingUnloads.current.size;
            window.__DEBUG_STATS__.failedChunks = failedChunks.current.size;
            window.__DEBUG_STATS__.failedChunkKeys = Array.from(
              failedChunks.current
            );
            window.__DEBUG_STATS__.desiredChunksCount =
              value && value.desiredChunks ? value.desiredChunks.size : 0;
          }
          sweepGen.current = null;
          break;
        }
        if (value.type === 'YIELD') {
          break; // End frame early
        } else if (value.type === 'RELOAD') {
          const { chunkKey, cx, cz } = value;
          loadChunkAsync(cx, cz)
            .then((success) => {
              if (success === 'CANCELLED' || success === false) {
                knownChunks.current.delete(chunkKey);
                if (success === false) lastPlayerCx.current = null;
              } else if (success === 'DECORATED') {
                pass2Chunks.current.add(chunkKey);
              } else if (success === 'PRISTINE' || success === true) {
                pass1Chunks.current.add(chunkKey);
              } else {
                knownChunks.current.delete(chunkKey);
                failedChunks.current.add(chunkKey);
                setTimeout(() => failedChunks.current.delete(chunkKey), 5000);
              }
            })
            .catch(() => {
              knownChunks.current.delete(chunkKey);
              failedChunks.current.add(chunkKey);
              setTimeout(() => failedChunks.current.delete(chunkKey), 5000);
            });
        } else if (value.type === 'LOAD') {
          const { chunkKey, cx, cz } = value;
          knownChunks.current.add(chunkKey);
          loadChunkAsync(cx, cz)
            .then((success) => {
              if (success === 'CANCELLED' || success === false) {
                knownChunks.current.delete(chunkKey);
                if (success === false) lastPlayerCx.current = null; // Force sweep retry!
              } else if (success === 'DECORATED') {
                pass2Chunks.current.add(chunkKey);
              } else if (success === 'PRISTINE' || success === true) {
                pass1Chunks.current.add(chunkKey);
              } else {
                knownChunks.current.delete(chunkKey);
                failedChunks.current.add(chunkKey);
              setTimeout(() => failedChunks.current.delete(chunkKey), 5000);
              }
            })
            .catch((_err) => {
              knownChunks.current.delete(chunkKey);
              failedChunks.current.add(chunkKey);
              setTimeout(() => failedChunks.current.delete(chunkKey), 5000);
            });
        } else if (value.type === 'UNLOAD') {
          const key = value.chunkKey;
          useStore.getState().cancelLoadChunk(key);

          // Calculate distance to determine grace period
          const [ux, uz] = key.split(',').map(Number);
          const dist = Math.max(
            Math.abs(ux - currentCx),
            Math.abs(uz - currentCz)
          );
          const currentR = useStore.getState().renderDistance;

          // If chunk is deeply out of bounds (e.g. user lowered render distance slider), unload instantly!
          // Otherwise use the 15-second grace period for normal walking boundary thrashing.
          const delay = dist > currentR + 2 ? 100 : UNLOAD_GRACE_MS;

          const id = setTimeout(() => {
            knownChunks.current.delete(key);
            pass1Chunks.current.delete(key);
            pass2Chunks.current.delete(key);
            pendingUnloads.current.delete(key);
            unloadChunk(key);
          }, delay);
          pendingUnloads.current.set(key, id);
        }
        steps++;
      }
    }

    // Run Pass 2 Gate check every frame (it's fast)
    checkPass2Gate();
  });

  return null;
};
