import { useEffect, useState, useRef } from 'react';
import { useStore } from '../stores/useStore';
import { useChunkStore } from '../stores/chunkSlice';
import { useEnvironmentStore } from '../stores/environmentSlice';
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

// Initialize global debug stats
window.__DEBUG_STATS__ = window.__DEBUG_STATS__ || {
  fps: 0,
  cpuTime: 0,
  gpuTime: 0,
  drawCalls: 0,
  vertices: 0,
  textureBinds: 0,
  vboMemoryBytes: 0,
  totalChunks: 0,
  chunksRendered: 0,
  totalEntities: 0,
  entitiesRendered: 0,
  bytesSent: 0,
  bytesReceived: 0,
  ping: 0,
  packetStats: { sent: {}, recv: {} },
  errorLog: [],
};

const StatRow = ({ label, valueId, color = 'text-white' }) => (
  <div className="flex justify-between w-full space-x-8">
    <span className="text-white/60">{label}:</span>
    <span id={valueId} className={`font-bold ${color}`}>
      -
    </span>
  </div>
);

export const DebugOverlay = () => {
  const [visible, setVisible] = useState(false);
  const [storageStats, setStorageStats] = useState({ usage: 0, quota: 1 });
  const overlayRef = useRef(null);

  // Memoize noise generators so we don't recreate them every frame
  const noiseFuncsRef = useRef(null);

  // Storage Polling
  useEffect(() => {
    if (!visible) return;
    let mounted = true;
    const fetchStorage = async () => {
      if (navigator.storage && navigator.storage.estimate) {
        try {
          const estimate = await navigator.storage.estimate();
          if (mounted)
            setStorageStats({
              usage: estimate.usage || 0,
              quota: estimate.quota || 1,
            });
        } catch (_e) {}
      }
    };
    fetchStorage();
    const interval = setInterval(fetchStorage, 10000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [visible]);

  // Global Error Trapping
  useEffect(() => {
    const handleError = (event) => {
      window.__DEBUG_STATS__.errorLog.push({
        time: new Date().toLocaleTimeString(),
        message: event.message || event.reason?.message || 'Unknown error',
        source: event.filename || 'Runtime',
      });
      if (window.__DEBUG_STATS__.errorLog.length > 5) {
        window.__DEBUG_STATS__.errorLog.shift();
      }
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleError);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleError);
    };
  }, []);

  const triggerDump = () => {
    window.__USE_STORE__.getState().setSpectorData({ isLoading: true });
  };

  // Keybindings for F3 or Tilde, F4 for Lighting Debug
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'F3' || e.code === 'Backquote') {
        e.preventDefault();
        setVisible((v) => !v);
      }
      if (e.code === 'F8') {
        e.preventDefault();
        useStore.getState().toggleDebugLighting();
      }
      if (e.code === 'F9') {
        e.preventDefault();
        useStore.getState().toggleDebugPhysics();
      }
      if (e.code === 'F10') {
        e.preventDefault();
        useStore.getState().toggleDebugShadows();
      }
      if (e.key === 'F12') {
        e.preventDefault();
        triggerDump();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
      let totalGeos = 0;
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
      write(
        'dbg-flora-attempt',
        window.__CHUNK_FLORA_RENDER_ATTEMPT__ ? 'YES' : 'NO',
        '#ffaa00'
      );
      write(
        'dbg-flora-coord',
        window.__FIRST_FLORA_COORD__ || 'None',
        '#ffaa00'
      );

      // Debug: Scan the first loaded chunk's buffer for block ID 15
      let bufferGrassCount = 0;
      const firstChunkKey = Object.keys(useChunkStore.getState().chunks)[0];
      if (firstChunkKey) {
        const buf = useChunkStore.getState().chunks[firstChunkKey].buffer;
        if (buf) {
          for (let i = 0; i < buf.length; i++) {
            if ((buf[i] & 0xff) === 15) bufferGrassCount++;
          }
        }
      }
      write(
        'dbg-ents-tot',
        stats.totalEntities + ' | Grass in Buffer: ' + bufferGrassCount
      );
      write('dbg-ents-rnd', stats.entitiesRendered, '#ff55ff');

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
      quat.set(
        playerRotation.x,
        playerRotation.y,
        playerRotation.z,
        playerRotation.w
      );
      euler.setFromQuaternion(quat, 'YXZ');
      const deg = (-(euler.y * 180) / Math.PI + 360 + 90) % 360; // Standardize 0-360 mapped to Z-forward
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
      const overflows = useChunkStore.getState().overflowChunks?.length || 0;
      const pendUnloads = stats.pendingUnloads || 0;
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
        'dbg-pipe-overflow',
        overflows,
        overflows > 0 ? '#fbbf24' : '#555555'
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

  if (!visible) return null;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 pointer-events-none z-[9999] p-8 font-mono text-base text-white select-none flex justify-between drop-shadow-md h-screen"
    >
      {/* LEFT PANEL */}
      <div className="bg-black/80 p-8 rounded-lg border border-white/10 min-w-[400px] shadow-2xl h-full flex flex-col pointer-events-auto">
        <div className="flex justify-between items-center mb-6 pb-4 border-b border-white/20 shrink-0 pointer-events-none">
          <h3 className="m-0 text-cyan-400 font-bold tracking-widest text-xl">
            ENGINE DEBUG
          </h3>
          <span className="text-sm text-white/40 ml-6">
            [F3] Close | [F8] Dump
          </span>
        </div>

        <div className="space-y-8 flex-grow overflow-y-auto pr-4 pointer-events-auto custom-scrollbar">
          {/* TELEMETRY */}
          <div>
            <div className="text-cyan-300 text-sm font-bold mb-3 border-b border-white/10 pb-1">
              TELEMETRY
            </div>
            <StatRow label="Position" valueId="dbg-pos" />
            <StatRow label="Chunk" valueId="dbg-chunk" />
            <StatRow label="Facing" valueId="dbg-facing" />
            <StatRow label="Target" valueId="dbg-target" />
            <StatRow label="Biome" valueId="dbg-biome" />
            <StatRow label="World Seed" valueId="dbg-seed" />
          </div>

          {/* PERFORMANCE */}
          <div>
            <div className="text-cyan-300 text-sm font-bold mb-3 border-b border-white/10 pb-1">
              PERFORMANCE
            </div>
            <StatRow label="TPS (Logic)" valueId="dbg-tps" />
            <StatRow label="MSPT (Logic Time)" valueId="dbg-mspt" />
            <StatRow label="FPS (Visual)" valueId="dbg-fps" />
            <StatRow label="CPU Time" valueId="dbg-cpu" />
            <StatRow label="GPU Time" valueId="dbg-gpu" />
          </div>

          {/* RENDERER */}
          <div>
            <div className="text-cyan-300 text-sm font-bold mb-3 border-b border-white/10 pb-1">
              RENDERER
            </div>
            <StatRow label="Draw Calls" valueId="dbg-draws" />
            <StatRow label="Triangles" valueId="dbg-tris" />
            <StatRow label="Vertices" valueId="dbg-verts" />
            <StatRow label="Tex Binds" valueId="dbg-tex" />
            <StatRow label="Geometries" valueId="dbg-vbo" />
            <StatRow label="Debug Light [F8]" valueId="dbg-light" />
            <StatRow label="Debug Physics [F9]" valueId="dbg-physics" />
            <StatRow label="Debug Shadows [F10]" valueId="dbg-shadows" />
          </div>

          {/* SCENE */}
          <div>
            <div className="text-cyan-300 text-sm font-bold mb-3 border-b border-white/10 pb-1">
              SCENE
            </div>
            <StatRow label="Chunks Total" valueId="dbg-chunks-tot" />
            <StatRow label="Chunks Rendered" valueId="dbg-chunks-rnd" />
            <StatRow label="Flora Chunks" valueId="dbg-flora" />
            <StatRow label="Chunk Render Attempt" valueId="dbg-flora-attempt" />
            <StatRow label="First Flora Coord" valueId="dbg-flora-coord" />
            <StatRow label="Entities Total" valueId="dbg-ents-tot" />
            <StatRow label="Entities Rendered" valueId="dbg-ents-rnd" />
          </div>

          {/* CHUNK PIPELINE */}
          <div>
            <div className="text-cyan-300 text-sm font-bold mb-3 border-b border-white/10 pb-1">
              CHUNK PIPELINE
            </div>
            {/* Live Progress Bar */}
            <div className="w-full mb-3">
              <div className="w-full h-[6px] bg-white/10 rounded-full overflow-hidden">
                <div
                  id="dbg-pipe-bar-fill"
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: '0%',
                    background: '#22d3ee',
                    boxShadow: '0 0 12px #22d3ee',
                  }}
                />
              </div>
              <div className="text-right mt-1">
                <span
                  id="dbg-pipe-bar-label"
                  className="text-xs font-bold"
                  style={{ color: '#22d3ee' }}
                >
                  0%
                </span>
              </div>
            </div>
            <StatRow label="Target" valueId="dbg-pipe-target" />
            <StatRow label="Net Wait (WebRTC)" valueId="dbg-pipe-net" />
            <StatRow label="Queued (Worker)" valueId="dbg-pipe-queue" />
            <StatRow label="In-Flight (Gen)" valueId="dbg-pipe-flight" />
            <StatRow label="Mount Queue" valueId="dbg-pipe-mount" />
            <StatRow label="Batched (WebGL)" valueId="dbg-pipe-batched" />
            <StatRow label="Overflows" valueId="dbg-pipe-overflow" />
            <StatRow label="Pending Unloads" valueId="dbg-pipe-unload" />
            <StatRow label="Async DB Deltas" valueId="dbg-pipe-deltas" />
            <StatRow label="Failed" valueId="dbg-pipe-failed" />
            <div
              id="dbg-pipe-failed-list"
              className="mt-1 text-xs font-mono break-all"
            ></div>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              triggerDump();
            }}
            className="flex-1 mt-6 py-2 px-4 bg-cyan-900/50 hover:bg-cyan-800/80 text-cyan-200 border border-cyan-700/50 rounded transition-colors text-sm font-bold uppercase tracking-wider"
          >
            Trigger Spector Dump
          </button>
          <button
            onClick={async (e) => {
              e.stopPropagation();
              const { clearDB } = await import('../utils/db');
              if (
                window.confirm(
                  'Are you sure you want to clear your world data? All built structures will be lost.'
                )
              ) {
                await clearDB();
                window.location.reload();
              }
            }}
            className="flex-1 mt-6 py-2 px-4 bg-red-900/50 hover:bg-red-800/80 text-red-200 border border-red-700/50 rounded transition-colors text-sm font-bold uppercase tracking-wider"
          >
            Clear World DB
          </button>
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div className="bg-black/80 p-8 rounded-lg border border-white/10 min-w-[400px] shadow-2xl h-full flex flex-col pointer-events-auto">
        <div className="space-y-8 flex-grow overflow-y-auto pr-4 custom-scrollbar">
          {/* NETWORK */}
          <div>
            <div className="text-cyan-300 text-sm font-bold mb-3 border-b border-white/10 pb-1">
              NETWORK
            </div>
            <StatRow label="Status" valueId="dbg-net" />
            <StatRow label="Ping" valueId="dbg-ping" />
            <StatRow label="Up Speed" valueId="dbg-up" />
            <StatRow label="Down Speed" valueId="dbg-down" />
            <StatRow label="Intents Broadcast" valueId="dbg-events" />
            <div id="dbg-peers" className="mt-2"></div>
            <div id="dbg-pkts" className="mt-2"></div>
          </div>

          {/* WORKERS */}
          <div>
            <div className="text-cyan-300 text-sm font-bold mb-3 border-b border-white/10 pb-1">
              OS / WORKERS
            </div>
            <StatRow label="Thread Pool" valueId="dbg-workers" />
            <StatRow label="Avg Latency" valueId="dbg-latency" />
            <StatRow label="Watchdog Resets" valueId="dbg-resets" />
          </div>

          {/* STORAGE */}
          <div>
            <div className="text-cyan-300 text-sm font-bold mb-3 border-b border-white/10 pb-1">
              STORAGE
            </div>
            <div className="flex justify-between w-full space-x-8">
              <span className="text-white/60">Quota:</span>
              <span
                className={`font-bold ${storageStats.usage / storageStats.quota > 0.9 ? 'text-red-400' : 'text-green-400'}`}
              >
                {(storageStats.usage / 1024 / 1024).toFixed(2)} MB /{' '}
                {(storageStats.quota / 1024 / 1024 / 1024).toFixed(2)} GB (
                {((storageStats.usage / storageStats.quota) * 100).toFixed(1)}%)
              </span>
            </div>
          </div>
        </div>
      </div>

      <div
        id="dbg-errs"
        className="absolute bottom-8 left-1/2 -translate-x-1/2 max-w-[600px] break-words bg-black/80 rounded p-6 text-base font-bold pointer-events-none"
      ></div>
    </div>
  );
};
