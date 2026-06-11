import { useEffect } from 'react';
import { useStore } from '../../stores/useStore';
import { useChunkStore } from '../../stores/chunkSlice';
import { X, FileJson, FileText } from 'lucide-react';
import { playerPosition, ServerTickMetrics } from '../../globals';

export const SpectorModal = () => {
  const spectorData = useStore((state) => state.spectorData);
  const setSpectorData = useStore((state) => state.setSpectorData);

  useEffect(() => {
    if (spectorData && document.pointerLockElement) {
      document.exitPointerLock();
    }
  }, [spectorData]);

  if (!spectorData) return null;

  const totalCommands = spectorData.commands?.length || 0;
  const drawCalls = (spectorData.commands || []).filter((c) =>
    c.name?.startsWith('draw')
  ).length;

  const getEngineDumpInfo = async () => {
    const state = useStore.getState();
    const stats = window.__DEBUG_STATS__ || {};
    const workerStats = window.__workerTelemetry || {};

    let netState = {};
    if (window.networkActions) {
      const rawNet = window.networkActions.getState();
      netState = {
        status: rawNet.connectionStatus,
        isHost: rawNet.isHost,
        roomCode: rawNet.roomCode,
        players: rawNet.players,
        reliablePeers: rawNet.connections?.length || 0,
        unreliablePeers: rawNet.unreliableConnections?.length || 0,
        ping: stats.ping,
      };
    }

    let storageStr = 'Unavailable';
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const est = await navigator.storage.estimate();
        storageStr = `${(est.usage / 1024 / 1024).toFixed(2)} MB / ${(est.quota / 1024 / 1024 / 1024).toFixed(2)} GB`;
      } catch (_e) {}
    }

    const chunkState = useChunkStore.getState();

    return {
      performance: {
        fps: stats.fps,
        tps: ServerTickMetrics.tps,
        mspt: ServerTickMetrics.mspt,
        cpuTime: stats.cpuTime,
        gpuTime: stats.gpuTime || null,
      },
      renderer: {
        drawCalls: stats.drawCalls,
        triangles: stats.triangles,
        vertices: stats.vertices,
        textureBinds: stats.textureBinds,
        vboMemoryMB: (stats.vboMemoryBytes / 1024 / 1024).toFixed(2),
        geometries: stats.geometries,
      },
      scene: {
        chunksTotal: Object.keys(chunkState.chunks || {}).length,
        chunksRendered: stats.chunksRendered,
        entitiesTotal: stats.totalEntities,
        entitiesRendered: stats.entitiesRendered,
      },
      chunkPipeline: {
        desiredChunksCount: stats.desiredChunksCount || 0,
        netRequests: stats.netRequests || 0,
        workerQueue: workerStats.queueLength || 0,
        activePhysicsChunks: chunkState.activePhysicsChunks?.length || 0,
        pendingMeshMounts: chunkState.pendingMeshMounts?.length || 0,
        pendingUnloads: stats.pendingUnloads || 0,
        processingDeltas: stats.processingDeltas || 0,
        failedChunks: stats.failedChunks || 0,
        failedChunkKeys: stats.failedChunkKeys || [],
      },
      workers: {
        poolSize: workerStats.poolSize,
        activeJobs: workerStats.activeJobs,
        resets: workerStats.resets,
      },
      player: {
        pos: [playerPosition.x, playerPosition.y, playerPosition.z],
        health: state.playerHealth,
        renderDistance: state.renderDistance,
        shadowQuality: state.shadowQuality,
        debugLighting: state.debugLighting,
      },
      network: netState,
      storage: storageStr,
      errors: stats.errorLog || [],
    };
  };

  const compileEngineDumpText = (dump) => {
    let content = '=== WORLD ENGINE DUMP ===\n';
    content += `Timestamp: ${new Date().toISOString()}\n\n`;

    content += '--- 1. CPU / GPU PERFORMANCE ---\n';
    content += `FPS (Visuals): ${dump.performance.fps}\n`;
    content += `TPS (Logic): ${dump.performance.tps.toFixed(1)} / 20\n`;
    content += `MSPT: ${dump.performance.mspt.toFixed(2)} ms (Max 50ms)\n`;
    content += `CPU Time: ${dump.performance.cpuTime?.toFixed(2)} ms\n`;
    content += `GPU Time: ${dump.performance.gpuTime ? dump.performance.gpuTime.toFixed(2) + ' ms' : 'N/A'}\n\n`;

    content += '--- 2. WEBGL RENDERER ---\n';
    content += `Draw Calls: ${dump.renderer.drawCalls}\n`;
    content += `Triangles: ${dump.renderer.triangles}\n`;
    content += `Vertices: ${dump.renderer.vertices}\n`;
    content += `Texture Binds: ${dump.renderer.textureBinds}\n`;
    content += `VBO Memory: ${dump.renderer.vboMemoryMB} MB\n`;
    content += `Active Geometries: ${dump.renderer.geometries}\n\n`;

    content += '--- 3. SCENE & ENTITIES ---\n';
    content += `Chunks Total: ${dump.scene.chunksTotal}\n`;
    content += `Chunks Rendered: ${dump.scene.chunksRendered}\n`;
    content += `Entities Total: ${dump.scene.entitiesTotal}\n`;
    content += `Entities Rendered: ${dump.scene.entitiesRendered}\n\n`;

    content += '--- 4. CHUNK PIPELINE ---\n';
    content += `Target Chunks: ${dump.chunkPipeline.desiredChunksCount}\n`;
    content += `Network Wait: ${dump.chunkPipeline.netRequests}\n`;
    content += `Worker Queue: ${dump.chunkPipeline.workerQueue}\n`;
    content += `Active Physics Chunks: ${dump.chunkPipeline.activePhysicsChunks}\n`;
    content += `Mount Queue: ${dump.chunkPipeline.pendingMeshMounts}\n`;
    content += `Pending Unloads: ${dump.chunkPipeline.pendingUnloads}\n`;
    content += `Async DB Deltas: ${dump.chunkPipeline.processingDeltas}\n`;
    content += `Failed Chunks: ${dump.chunkPipeline.failedChunks} ${dump.chunkPipeline.failedChunks > 0 ? JSON.stringify(dump.chunkPipeline.failedChunkKeys) : ''}\n\n`;

    content += '--- 5. WORKER THREAD POOL ---\n';
    content += `Pool Size: ${dump.workers.poolSize}\n`;
    content += `Active Jobs: ${dump.workers.activeJobs}\n`;
    content += `Watchdog Resets: ${dump.workers.resets}\n\n`;

    content += '--- 6. PLAYER STATE ---\n';
    content += `Position: [${dump.player.pos[0].toFixed(2)}, ${dump.player.pos[1].toFixed(2)}, ${dump.player.pos[2].toFixed(2)}]\n`;
    content += `Health: ${dump.player.health}\n`;
    content += `Render Distance: ${dump.player.renderDistance}\n`;
    content += `Shadow Quality: ${dump.player.shadowQuality}\n`;
    content += `Debug Lighting: ${dump.player.debugLighting ? 'ON' : 'OFF'}\n\n`;

    content += '--- 7. NETWORK ---\n';
    content += JSON.stringify(dump.network, null, 2) + '\n\n';

    content += '--- 8. LOCAL STORAGE ---\n';
    content += `IndexedDB Quota: ${dump.storage}\n\n`;

    content += '--- 9. ERROR LOG ---\n';
    content += JSON.stringify(dump.errors, null, 2) + '\n';

    return content;
  };

  const downloadEngineDump = async () => {
    const dump = await getEngineDumpInfo();
    const content = compileEngineDumpText(dump);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `engine_dump_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (spectorData.isLoading) {
    return (
      <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 pointer-events-auto backdrop-blur-sm">
        <div className="bg-[#111827] border border-[#374151] rounded-xl p-8 max-w-xl w-full max-h-[85dvh] overflow-y-auto text-white shadow-2xl relative text-center">
          <button
            onClick={() => setSpectorData(null)}
            className="absolute top-4 right-4 p-2 hover:bg-white/10 rounded-full transition-colors"
          >
            <X size={20} className="text-gray-400 hover:text-white" />
          </button>

          <h2 className="text-3xl font-black mb-4 text-cyan-400 uppercase tracking-wider">
            Engine Dump Ready
          </h2>
          <p className="text-gray-400 mb-8 leading-relaxed">
            The native engine dump contains all active chunks, player
            coordinates, and entity counts, ready to be exported to a `.txt`
            file.
          </p>

          <div className="flex gap-4 justify-center">
            <button
              onClick={downloadEngineDump}
              className="px-6 py-3 bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 border border-indigo-500/50 rounded-lg font-bold flex items-center gap-2 transition-all"
            >
              <FileText size={18} />
              DOWNLOAD ENGINE DUMP (.TXT)
            </button>
            <button
              onClick={() => setSpectorData(null)}
              className="px-6 py-3 bg-gray-500/20 text-gray-400 hover:bg-gray-500/30 border border-gray-500/50 rounded-lg font-bold transition-all"
            >
              CLOSE
            </button>
          </div>
        </div>
      </div>
    );
  }

  const downloadFile = async (format) => {
    const dump = await getEngineDumpInfo();
    let content = '';
    let filename = `spector_capture_${Date.now()}`;
    let type;

    if (format === 'json') {
      // JSON stringification handles cyclical structures poorly if any exist, but Spector returns safe JSON
      const exportData = {
        ...spectorData,
        engineDump: dump,
      };
      content = JSON.stringify(exportData, null, 2);
      filename += '.json';
      type = 'application/json';
    } else {
      content = compileEngineDumpText(dump);
      content += '\n==================================================\n';
      content += '=== SPECTOR.JS RENDER TRACE ===\n\n';
      content += `Total Commands: ${totalCommands}\n`;
      content += `Draw Calls: ${drawCalls}\n\n`;

      spectorData.commands.forEach((cmd, idx) => {
        content += `[${idx}] ${cmd.name}\n`;
        if (cmd.commandArguments && cmd.commandArguments.length > 0) {
          content += `      Args: ${JSON.stringify(cmd.commandArguments)}\n`;
        }
      });

      filename += '.txt';
      type = 'text/plain';
    }

    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 pointer-events-auto">
      <div className="bg-black/90 backdrop-blur-2xl border border-cyan-400/50 rounded-2xl p-8 shadow-[0_0_50px_rgba(34,211,238,0.15)] flex flex-col items-center min-w-[400px]">
        <button
          onClick={() => setSpectorData(null)}
          className="absolute top-4 right-4 p-2 text-white/40 hover:text-red-400 hover:bg-white/5 rounded-full transition-colors cursor-pointer"
        >
          <X size={20} />
        </button>

        <div className="text-center mb-8">
          <h3 className="text-cyan-200/80 tracking-[0.3em] text-sm font-light mb-1">
            SYSTEM DIAGNOSTICS
          </h3>
          <h3 className="text-cyan-400 tracking-[0.2em] text-2xl font-bold">
            FRAME CAPTURE
          </h3>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl p-6 w-full mb-8 shadow-inner flex justify-around">
          <div className="flex flex-col items-center">
            <span className="text-white/50 text-xs tracking-widest font-bold mb-1">
              COMMANDS
            </span>
            <span className="text-white text-3xl font-mono">
              {totalCommands}
            </span>
          </div>
          <div className="w-px bg-white/10" />
          <div className="flex flex-col items-center">
            <span className="text-cyan-400/70 text-xs tracking-widest font-bold mb-1">
              DRAW CALLS
            </span>
            <span className="text-cyan-400 text-3xl font-mono font-bold drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]">
              {drawCalls}
            </span>
          </div>
        </div>

        <div className="flex gap-4 w-full">
          <button
            onClick={() => downloadFile('json')}
            className="flex-1 bg-cyan-950/40 hover:bg-cyan-900/60 border border-cyan-500/30 hover:border-cyan-400 rounded-lg py-3 flex items-center justify-center gap-2 transition-all group cursor-pointer"
          >
            <FileJson
              size={18}
              className="text-cyan-400 group-hover:scale-110 transition-transform"
            />
            <span className="text-cyan-100 text-sm font-bold tracking-wider">
              .JSON (AI)
            </span>
          </button>

          <button
            onClick={() => downloadFile('txt')}
            className="flex-1 bg-slate-900/40 hover:bg-slate-800/60 border border-white/10 hover:border-white/30 rounded-lg py-3 flex items-center justify-center gap-2 transition-all group cursor-pointer"
          >
            <FileText
              size={18}
              className="text-white/60 group-hover:text-white group-hover:scale-110 transition-transform"
            />
            <span className="text-white/70 group-hover:text-white text-sm font-bold tracking-wider">
              .TXT (RAW)
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
