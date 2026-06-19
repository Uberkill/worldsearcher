import { useEffect, useState, useRef } from 'react';
import { useDebugOverlayUpdate } from '../hooks/useDebugOverlayUpdate';
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

const TelemetryPanel = () => (
  <>
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
  </>
);

const PerformancePanel = () => (
  <>
    {/* PERFORMANCE */}
          <div>
            <div className="text-cyan-300 text-sm font-bold mb-3 border-b border-white/10 pb-1">
              PERFORMANCE
            </div>
            <StatRow label="RAM Usage [Chrome]" valueId="dbg-ram" />
            <StatRow label="TPS (Logic)" valueId="dbg-tps" />
            <StatRow label="MSPT (Logic Time)" valueId="dbg-mspt" />
            <StatRow label="FPS (Visual)" valueId="dbg-fps" />
            <StatRow label="CPU Time" valueId="dbg-cpu" />
            <StatRow label="GPU Time" valueId="dbg-gpu" />
          </div>
  </>
);

const RendererPanel = () => (
  <>
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
  </>
);

const ScenePanel = () => (
  <>
    {/* SCENE */}
          <div>
            <div className="text-cyan-300 text-sm font-bold mb-3 border-b border-white/10 pb-1">
              SCENE
            </div>
            <StatRow label="Chunks Total" valueId="dbg-chunks-tot" />
            <StatRow label="Chunks Rendered" valueId="dbg-chunks-rnd" />
            <StatRow label="Flora Chunks" valueId="dbg-flora" />
            <StatRow label="Active Physics" valueId="dbg-physics-chunks" />
            <StatRow label="Active Fluids" valueId="dbg-fluids" />
            <StatRow label="Entities Total" valueId="dbg-ents-tot" />
            <StatRow label="Entities Rendered" valueId="dbg-ents-rnd" />
            <StatRow label="AI Paths Cached" valueId="dbg-ai-paths" />
            <StatRow label="Bullets Active" valueId="dbg-bullets" />
            <StatRow label="Dropped Items" valueId="dbg-dropped-items" />
            <StatRow label="Tombstones" valueId="dbg-tombstones" />
          </div>
  </>
);

const ChunkPipelinePanel = () => (
  <>
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
            <StatRow label="Visual Chunks" valueId="dbg-pipe-visual" />
            <StatRow label="Visual Meshes Mounted" valueId="dbg-visual-meshes" />
            <StatRow label="Pending Unloads" valueId="dbg-pipe-unload" />
            <StatRow label="Async DB Deltas" valueId="dbg-pipe-deltas" />
            <StatRow label="DB Ops Pending" valueId="dbg-db-pending" />
            <StatRow label="DB Avg Read Latency" valueId="dbg-db-read-lat" />
            <StatRow label="DB Avg Write Latency" valueId="dbg-db-write-lat" />
            <StatRow label="Pipeline Status" valueId="dbg-pipe-status" />
            <StatRow label="Failed" valueId="dbg-pipe-failed" />
            <div
              id="dbg-pipe-failed-list"
              className="mt-1 text-xs font-mono break-all"
            ></div>
          </div>
  </>
);

const NetworkPanel = () => (
  <>
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
  </>
);

const WorkersPanel = () => (
  <>
    {/* WORKERS */}
          <div>
            <div className="text-cyan-300 text-sm font-bold mb-3 border-b border-white/10 pb-1">
              OS / WORKERS
            </div>
            <StatRow label="Thread Pool" valueId="dbg-workers" />
            <StatRow label="Avg Latency" valueId="dbg-latency" />
            <StatRow label="Watchdog Resets" valueId="dbg-resets" />
          </div>
  </>
);

const StoragePanel = ({ storageStats }) => (
  <>
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
  </>
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

  useDebugOverlayUpdate(overlayRef, visible, noiseFuncsRef);


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
          <TelemetryPanel  /><PerformancePanel  /><RendererPanel  /><ScenePanel  /></div>

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
        <div className="flex justify-between items-center mb-6 pb-4 border-b border-white/20 shrink-0 pointer-events-none">
          <h3 className="m-0 text-cyan-400 font-bold tracking-widest text-xl">
            SYSTEM MONITOR
          </h3>
          <span className="text-sm text-white/40 ml-6">
            Pipeline & Network
          </span>
        </div>

        <div className="space-y-8 flex-grow overflow-y-auto pr-4 pointer-events-auto custom-scrollbar">
          <ChunkPipelinePanel  /><NetworkPanel  /><WorkersPanel  /><StoragePanel storageStats={storageStats} /></div>
      </div>

      <div
        id="dbg-errs"
        className="absolute bottom-8 left-1/2 -translate-x-1/2 max-w-[600px] break-words bg-black/80 rounded p-6 text-base font-bold pointer-events-none"
      ></div>
    </div>
  );
};
