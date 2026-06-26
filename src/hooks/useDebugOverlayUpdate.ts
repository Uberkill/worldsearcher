import { useEffect, useRef } from 'react';
import { useStore } from '../stores/useStore';
import { useChunkStore } from '../stores/chunkSlice';
import { useInventoryStore } from '../stores/inventorySlice';
import * as THREE from 'three';
import { playerPosition, playerRotation, ServerTickMetrics } from '../globals';
import { getIndex } from '../utils/chunkData';
import { BlockKeyById } from '../registry/BlockRegistry';
import { networkActions } from '../stores/networkActions';
import { getSeed } from '../worldSeed';
import { createNoise2D } from 'simplex-noise';
import { mulberry32 } from '../utils/chunkGenerator';
import { getBiomeAt } from '../utils/biomes';

export function useDebugOverlayUpdate(overlayRef, visible, noiseFuncsRef) {
  // Update DOM via refs (bypass React render loop for performance)
  useEffect(() => {
    if (!visible) return;

    const euler = new THREE.Euler();
    const quat = new THREE.Quaternion();

    let lastTime = performance.now();
    let lastBytesSent = window.__DEBUG_STATS__.bytesSent || 0;
    let lastBytesRecv = window.__DEBUG_STATS__.bytesReceived || 0;
    let upSpeed = 0;
    let downSpeed = 0;

    let lastPacketsSent = {};
    let lastPacketsRecv = {};
    let pktsSentSpeed = {};
    let pktsRecvSpeed = {};

    const interval = setInterval(() => {
      if (!overlayRef.current) return;

      const stats = window.__DEBUG_STATS__;
      if (!stats) return;
      const state = useStore.getState();
      const netState = networkActions.getState();

      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      if (dt >= 1.0) {
        upSpeed = (stats.bytesSent - lastBytesSent) / dt;
        downSpeed = (stats.bytesReceived - lastBytesRecv) / dt;
        lastBytesSent = stats.bytesSent;
        lastBytesRecv = stats.bytesReceived;

        const currentSent = stats.packetStats?.sent || {};
        const currentRecv = stats.packetStats?.recv || {};
        for (const type in currentSent) {
          pktsSentSpeed[type] = Math.round(
            ((currentSent[type] || 0) - (lastPacketsSent[type] || 0)) / dt
          );
          lastPacketsSent[type] = currentSent[type];
        }
        for (const type in currentRecv) {
          pktsRecvSpeed[type] = Math.round(
            ((currentRecv[type] || 0) - (lastPacketsRecv[type] || 0)) / dt
          );
          lastPacketsRecv[type] = currentRecv[type];
        }

        lastTime = now;
      }

      const formatBytes = (bytes) => {
        if (bytes < 1024) return Math.floor(bytes) + ' B/s';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB/s';
        return (bytes / 1024 / 1024).toFixed(2) + ' MB/s';
      };

      // Update basic DOM stats
      stats.totalChunks = Object.keys(useChunkStore.getState().chunks || {}).length;
      let floraChunks = 0;
      for (const key in useChunkStore.getState().chunks) {
        if (useChunkStore.getState().chunks[key]?.meshArrays?.__flora?.length > 0) {
          floraChunks++;
        }
      }

      const write = (id, val, color) => {
        const el = document.getElementById(id);
        if (el) {
          el.innerText = val;
          if (color) el.style.color = color;
        }
      };

      write('dbg-seed', getSeed(), '#a78bfa');
      write('dbg-tps', ServerTickMetrics.tps.toFixed(1), ServerTickMetrics.tps < 15 ? '#ff5555' : '#55ff55');
      write('dbg-mspt', ServerTickMetrics.mspt.toFixed(2) + ' ms', ServerTickMetrics.mspt > 40 ? '#ff5555' : '#ffffff');
      write('dbg-fps', stats.fps, '#55ff55');
      write('dbg-cpu', stats.cpuTime.toFixed(2) + ' ms');
      write(
        'dbg-gpu',
        stats.gpuTime ? stats.gpuTime.toFixed(2) + ' ms' : 'N/A'
      );
      write(
        'dbg-draws',
        stats.drawCalls,
        stats.drawCalls > 2000
          ? '#ff5555'
          : stats.drawCalls > 1000
            ? '#ffff55'
            : '#ffffff'
      );
      write('dbg-tris', stats.triangles);
      write('dbg-verts', stats.vertices);
      write('dbg-tex', stats.textureBinds);
      write('dbg-vbo', stats.geometries);
      write('dbg-chunks-tot', stats.totalChunks);
      write('dbg-chunks-rnd', stats.chunksRendered, '#55ffff');
      write('dbg-flora', floraChunks, floraChunks > 0 ? '#10b981' : '#555555');
      write('dbg-ents-tot', stats.totalEntities);
      write('dbg-ents-rnd', stats.entitiesRendered, '#ff55ff');

      // AI & Entity metrics
      const activePaths = Object.keys(state.resolvedPaths || {}).length;
      const activeBullets = state.bullets?.length || 0;
      const activeItems = useInventoryStore.getState().droppedItems?.length || 0;
      const activeTombstones = useInventoryStore.getState().tombstones?.length || 0;
      const activePhysicsChunks = useChunkStore.getState().activePhysicsChunks?.length || 0;
      const activeFluids = state.activeFluids?.length || 0;
      
      write('dbg-ai-paths', activePaths, activePaths > 100 ? '#ffaa00' : '#ffffff');
      write('dbg-bullets', activeBullets, activeBullets > 50 ? '#ffaa00' : '#ffffff');
      write('dbg-dropped-items', activeItems, activeItems > 200 ? '#ff5555' : '#ffffff');
      write('dbg-tombstones', activeTombstones);
      write('dbg-physics-chunks', activePhysicsChunks);
      write('dbg-fluids', activeFluids, activeFluids > 2000 ? '#ef4444' : activeFluids > 500 ? '#fbbf24' : '#ffffff');

      // V8 Memory Tracking (Chrome only)
      if (performance.memory) {
        const usedJS = (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(1);
        const totalJS = (performance.memory.totalJSHeapSize / 1024 / 1024).toFixed(1);
        const limitJS = (performance.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(1);
        const pct = (performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100;
        
        write('dbg-ram', `${usedJS} MB / ${totalJS} MB (Limit: ${limitJS} MB)`, pct > 80 ? '#ef4444' : '#55ff55');
      } else {
        write('dbg-ram', 'N/A (Chrome Only)', '#555555');
      }

      // DB metrics
      const dbPending = window.__DB_PENDING_REQUESTS__ ? window.__DB_PENDING_REQUESTS__.size : 0;
      write('dbg-db-pending', dbPending, dbPending > 10 ? '#ff5555' : '#ffffff');

      // Telemetry
      const px = playerPosition.x;
      const py = playerPosition.y;
      const pz = playerPosition.z;

      write(
        'dbg-pos',
        `X: ${px.toFixed(2)} Y: ${py.toFixed(2)} Z: ${pz.toFixed(2)}`
      );
      write(
        'dbg-chunk',
        `CX: ${Math.floor(px / 16)} CZ: ${Math.floor(pz / 16)}`
      );

      // Calculate current biome dynamically
      const seedVal = getSeed();
      if (!noiseFuncsRef.current || noiseFuncsRef.current.seed !== seedVal) {
        noiseFuncsRef.current = {
          seed: seedVal,
          tempNoise2D: createNoise2D(mulberry32(seedVal + 10)),
          moistNoise2D: createNoise2D(mulberry32(seedVal + 20)),
        };
      }
      const { tempNoise2D, moistNoise2D } = noiseFuncsRef.current;
      const currentBiome = getBiomeAt(
        px,
        pz,
        tempNoise2D,
        moistNoise2D,
        seedVal
      );
      write('dbg-biome', currentBiome.toUpperCase(), '#ff55ff');

      // Compass Math
      const deg = (-(playerRotation.y * 180) / Math.PI + 360 + 90) % 360; // Standardize 0-360 mapped to Z-forward
      let dir = 'Unknown';
      if (deg >= 315 || deg < 45) dir = 'North (-Z)';
      else if (deg >= 45 && deg < 135) dir = 'East (+X)';
      else if (deg >= 135 && deg < 225) dir = 'South (+Z)';
      else if (deg >= 225 && deg < 315) dir = 'West (-X)';
      write('dbg-facing', `${dir} (${deg.toFixed(1)}°)`);

      // Look Target Math
      const hover = state.hoverTarget;
      if (hover) {
        const [hx, hy, hz] = hover;
        const cx = Math.floor(hx / 16);
        const cz = Math.floor(hz / 16);
        const chunk = useChunkStore.getState().chunks[`${cx},${cz}`];
        let blockName = 'Unknown';
        if (chunk && chunk.buffer) {
          const lx = ((hx % 16) + 16) % 16;
          const lz = ((hz % 16) + 16) % 16;
          const val = chunk.buffer[getIndex(lx, hy, lz)];
          // Extract texture ID (lower 8 bits)
          const tex = val & 0xff;
          if (tex > 0) {
            blockName = BlockKeyById[tex] || 'Unknown';
          }
        }
        write('dbg-target', `${blockName} [${hx}, ${hy}, ${hz}]`, '#ffaa00');
      } else {
        write('dbg-target', 'Air', '#555555');
      }

      // Network
      let mpStatus = 'SINGLEPLAYER (LOCAL HOST)';
      if (netState.connectionStatus === 'connected') {
        mpStatus = `MULTIPLAYER (${netState.isHost ? 'HOST' : 'GUEST'})`;
      } else if (netState.connectionStatus === 'connecting') {
        mpStatus = `MULTIPLAYER (CONNECTING...)`;
      }
      
      const logStr = (window.DEBUG_MP_LOG || []).slice(-3).map(l => `<div class="text-[10px] text-yellow-300 opacity-80 leading-tight truncate">${l}</div>`).join('');
      
      const elNet = document.getElementById('dbg-net');
      if (elNet) {
        elNet.innerHTML = `<span style="color: ${netState.connectionStatus === 'connected' ? '#22d3ee' : '#55ff55'}">${mpStatus}</span>${logStr ? `<div class="mt-1 bg-black/40 p-1 rounded">${logStr}</div>` : ''}`;
      }

      if (netState.connectionStatus === 'connected') {
        write(
          'dbg-ping',
          stats.ping > 0 ? stats.ping + ' ms' : 'N/A',
          stats.ping > 150 ? '#ff5555' : '#55ff55'
        );
        write('dbg-up', formatBytes(upSpeed));
        write('dbg-down', formatBytes(downSpeed));

        const peersEl = document.getElementById('dbg-peers');
        if (peersEl) {
          peersEl.innerHTML = netState.connections
            .map(
              (c) =>
                `<div class="text-white/60 text-xs mt-1">PEER: <span class="text-white">${c.peer ? c.peer.substring(0, 8) : 'Unknown'}</span> [ICE: <span class="${c.peerConnection?.iceConnectionState === 'connected' ? 'text-green-400' : 'text-yellow-400'}">${c.peerConnection?.iceConnectionState || 'unknown'}</span>]</div>`
            )
            .join('');
        }

        const pktsEl = document.getElementById('dbg-pkts');
        if (pktsEl) {
          let html = '<div class="flex space-x-8 mt-2">';
          html +=
            '<div class="flex flex-col"><div class="text-white/40 text-[10px] uppercase mb-1">Sent (msg/s)</div>';
          for (const t in pktsSentSpeed) {
            if (pktsSentSpeed[t] > 0)
              html += `<div class="text-[11px]"><span class="text-white/60">${t}:</span> <span class="text-cyan-300 font-bold">${pktsSentSpeed[t]}</span></div>`;
          }
          html +=
            '</div><div class="flex flex-col"><div class="text-white/40 text-[10px] uppercase mb-1">Recv (msg/s)</div>';
          for (const t in pktsRecvSpeed) {
            if (pktsRecvSpeed[t] > 0)
              html += `<div class="text-[11px]"><span class="text-white/60">${t}:</span> <span class="text-cyan-300 font-bold">${pktsRecvSpeed[t]}</span></div>`;
          }
          html += '</div></div>';
          pktsEl.innerHTML = html;
        }
      } else {
        write('dbg-net', 'SINGLEPLAYER (LOCAL HOST)', '#55ff55');
        write('dbg-ping', '0 ms (Local)', '#55ff55');
        write('dbg-up', '0 B/s', '#aaaaaa');
        write('dbg-down', '0 B/s', '#aaaaaa');

        const peersEl = document.getElementById('dbg-peers');
        if (peersEl) peersEl.innerHTML = '';
        const pktsEl = document.getElementById('dbg-pkts');
        if (pktsEl) pktsEl.innerHTML = '';
      }

      const eventsEl = document.getElementById('dbg-events');
      if (eventsEl) {
        eventsEl.innerText = stats.eventsBroadcast || 0;
      }

      // Worker Telemetry
      const wStats = window.__workerTelemetry || {
        activeJobs: 0,
        resets: 0,
        poolSize: 0,
        queueLength: 0,
        avgLatency: 0,
      };
      write(
        'dbg-workers',
        `${wStats.poolSize} Threads (Active Jobs: ${wStats.activeJobs})`,
        wStats.activeJobs > 0 ? '#55ff55' : '#aaaaaa'
      );
      write(
        'dbg-latency',
        wStats.avgLatency ? `${wStats.avgLatency} ms` : 'N/A',
        wStats.avgLatency > 150 ? '#fbbf24' : '#55ff55'
      );
      write(
        'dbg-resets',
        wStats.resets,
        wStats.resets > 0 ? '#ff5555' : '#55ff55'
      );

      const lightDbgEl = document.getElementById('dbg-light');
      if (lightDbgEl) {
        lightDbgEl.innerText = state.debugLighting ? 'ON' : 'OFF';
        lightDbgEl.style.color = state.debugLighting ? '#ffff55' : '#555555';
      }
      const physDbgEl = document.getElementById('dbg-physics');
      if (physDbgEl) {
        physDbgEl.innerText = state.debugPhysics ? 'ON' : 'OFF';
        physDbgEl.style.color = state.debugPhysics ? '#ff55ff' : '#555555';
      }
      const shadowDbgEl = document.getElementById('dbg-shadows');
      if (shadowDbgEl) {
        shadowDbgEl.innerText = state.debugShadows ? 'ON' : 'OFF';
        shadowDbgEl.style.color = state.debugShadows ? '#ff55ff' : '#555555';
      }

      // --- CHUNK PIPELINE TELEMETRY ---
      const desired = stats.desiredChunksCount || 0;
      const inFlight = stats.inFlightChunks || 0;
      const workerQueue = wStats.queueLength || 0;
      const mountQueue = useChunkStore.getState().pendingMeshMounts?.length || 0;
      const batched = 0;
      const visualCount = useChunkStore.getState().overflowChunks?.length || 0;
      const pendUnloads = Object.keys(state.pendingUnloadList || {}).length;
      const failed = stats.failedChunks || 0;
      const netReqs = stats.netRequests || 0;
      const asyncDeltas = stats.processingDeltas || 0;

      // Progress: how many of the desired chunks are fully loaded into the store?
      const loaded = stats.totalChunks || 0;
      const progressPct =
        desired > 0 ? Math.min(100, Math.round((loaded / desired) * 100)) : 100;
      const isFullyLoaded =
        progressPct >= 100 &&
        inFlight === 0 &&
        workerQueue === 0 &&
        mountQueue === 0;

      // Progress bar DOM update
      const barFill = document.getElementById('dbg-pipe-bar-fill');
      if (barFill) {
        barFill.style.width = `${progressPct}%`;
        barFill.style.background =
          failed > 0 ? '#ef4444' : isFullyLoaded ? '#22c55e' : '#22d3ee';
        barFill.style.boxShadow =
          failed > 0
            ? '0 0 12px #ef4444'
            : isFullyLoaded
              ? '0 0 12px #22c55e'
              : '0 0 12px #22d3ee';
      }

      const barLabel = document.getElementById('dbg-pipe-bar-label');
      if (barLabel) {
        if (failed > 0) {
          barLabel.innerText = `${progressPct}% — ${failed} CRASHED`;
          barLabel.style.color = '#ef4444';
        } else if (isFullyLoaded) {
          barLabel.innerText = '100% — ALL LOADED';
          barLabel.style.color = '#22c55e';
        } else {
          barLabel.innerText = `${progressPct}% — Generating...`;
          barLabel.style.color = '#22d3ee';
        }
      }

      write('dbg-pipe-target', desired);
      write('dbg-pipe-net', netReqs, netReqs > 0 ? '#fbbf24' : '#555555');
      write(
        'dbg-pipe-queue',
        workerQueue,
        workerQueue > 20 ? '#ff5555' : workerQueue > 0 ? '#fbbf24' : '#555555'
      );
      write('dbg-pipe-flight', inFlight, inFlight > 0 ? '#22d3ee' : '#555555');
      write(
        'dbg-pipe-mount',
        mountQueue,
        mountQueue > 10 ? '#fbbf24' : mountQueue > 0 ? '#22d3ee' : '#555555'
      );
      write('dbg-pipe-batched', batched, '#a78bfa');
      write(
        'dbg-pipe-visual',
        visualCount,
        visualCount > 0 ? '#fbbf24' : '#555555'
      );
      write(
        'dbg-pipe-unload',
        pendUnloads,
        pendUnloads > 0 ? '#fbbf24' : '#555555'
      );
      write(
        'dbg-pipe-deltas',
        asyncDeltas,
        asyncDeltas > 0 ? '#fbbf24' : '#555555'
      );
      write('dbg-pipe-failed', failed, failed > 0 ? '#ef4444' : '#22c55e');

      // DB Read/Write Latency
      const dbReadLat = stats.dbLoadLatency ? `${stats.dbLoadLatency.toFixed(1)} ms` : 'N/A';
      const dbWriteLat = stats.dbSaveLatency ? `${stats.dbSaveLatency.toFixed(1)} ms` : 'N/A';
      write('dbg-db-read-lat', dbReadLat, stats.dbLoadLatency > 50 ? '#fbbf24' : '#ffffff');
      write('dbg-db-write-lat', dbWriteLat, stats.dbSaveLatency > 50 ? '#fbbf24' : '#ffffff');

      // Mounted Visual Meshes
      const visualMeshes = stats.totalVisualMeshes || 0;
      write('dbg-visual-meshes', visualMeshes);

      // Pipeline status checks
      let pipeStatus = 'OK';
      let pipeColor = '#22c55e'; // green
      if (failed > 0) {
        pipeStatus = 'CRASHED';
        pipeColor = '#ef4444'; // red
      } else if (loaded > 0 && visualMeshes === 0) {
        if (inFlight > 0 || workerQueue > 0 || mountQueue > 0) {
          pipeStatus = 'LOADING...';
          pipeColor = '#22d3ee'; // cyan
        } else {
          pipeStatus = 'BLOCKED (NO MESHES)';
          pipeColor = '#ef4444'; // red
        }
      } else if (workerQueue > 30) {
        pipeStatus = 'QUEUE BACKLOG';
        pipeColor = '#fbbf24'; // yellow
      }
      write('dbg-pipe-status', pipeStatus, pipeColor);

      // Failed chunks list
      const failedEl = document.getElementById('dbg-pipe-failed-list');
      if (failedEl) {
        const keys = stats.failedChunkKeys || [];
        if (keys.length > 0) {
          failedEl.innerHTML =
            keys
              .slice(0, 8)
              .map(
                (k) =>
                  `<span style="color:#ef4444;margin-right:6px">[${k}]</span>`
              )
              .join('') +
            (keys.length > 8
              ? `<span style="color:#ef4444">+${keys.length - 8} more</span>`
              : '');
        } else {
          failedEl.innerHTML = '';
        }
      }

      const errEl = document.getElementById('dbg-errs');
      if (errEl) {
        errEl.innerHTML = stats.errorLog
          .map(
            (e) => `<div class="text-red-400">[${e.time}] ${e.message}</div>`
          )
          .join('');
      }
    }, 200); // 5 times a second

    return () => clearInterval(interval);
  }, [visible]);
}
