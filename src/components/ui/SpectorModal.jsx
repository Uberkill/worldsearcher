import React, { useEffect } from 'react';
import { useStore } from '../../stores/useStore';
import { X, Download, FileJson, FileText } from 'lucide-react';

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
  const drawCalls = (spectorData.commands || []).filter(c => c.name?.startsWith('draw')).length;

  const downloadEngineDump = async () => {
    const state = window.__USE_STORE__?.getState() || {};
    const stats = window.__DEBUG_STATS__ || {};
    const workerStats = window.__workerTelemetry || {};
    
    // Attempt to grab Network Store safely
    let netState = {};
    if (window.useNetworkStore) {
       const rawNet = window.useNetworkStore.getState();
       netState = {
         status: rawNet.connectionStatus,
         isHost: rawNet.isHost,
         roomCode: rawNet.roomCode,
         players: rawNet.players,
         reliablePeers: rawNet.connections?.length || 0,
         unreliablePeers: rawNet.unreliableConnections?.length || 0,
         ping: stats.ping
       };
    }

    // Attempt to grab Storage
    let storageStr = "Unavailable";
    if (navigator.storage && navigator.storage.estimate) {
       try {
         const est = await navigator.storage.estimate();
         storageStr = `${(est.usage / 1024 / 1024).toFixed(2)} MB / ${(est.quota / 1024 / 1024 / 1024).toFixed(2)} GB`;
       } catch (e) {}
    }

    let content = "=== WORLD ENGINE DUMP ===\n";
    content += `Timestamp: ${new Date().toISOString()}\n\n`;

    content += "--- 1. CPU / GPU PERFORMANCE ---\n";
    content += `FPS: ${stats.fps}\n`;
    content += `CPU Time: ${stats.cpuTime?.toFixed(2)} ms\n`;
    content += `GPU Time: ${stats.gpuTime ? stats.gpuTime.toFixed(2) + ' ms' : 'N/A'}\n\n`;

    content += "--- 2. WEBGL RENDERER ---\n";
    content += `Draw Calls: ${stats.drawCalls}\n`;
    content += `Triangles: ${stats.triangles}\n`;
    content += `Vertices: ${stats.vertices}\n`;
    content += `Texture Binds: ${stats.textureBinds}\n`;
    content += `VBO Memory: ${(stats.vboMemoryBytes / 1024 / 1024).toFixed(2)} MB\n`;
    content += `Active Geometries: ${stats.geometries}\n\n`;

    content += "--- 3. SCENE & ENTITIES ---\n";
    content += `Chunks Total: ${Object.keys(state.chunks || {}).length}\n`;
    content += `Chunks Rendered: ${stats.chunksRendered}\n`;
    content += `Entities Total: ${stats.totalEntities}\n`;
    content += `Entities Rendered: ${stats.entitiesRendered}\n\n`;

    content += "--- 4. CHUNK PIPELINE ---\n";
    content += `Target Chunks: ${stats.desiredChunksCount || 0}\n`;
    content += `Network Wait: ${stats.netRequests || 0}\n`;
    content += `Worker Queue: ${workerStats.queueLength || 0}\n`;
    content += `In-Flight Gen: ${stats.inFlightChunks || 0}\n`;
    content += `Mount Queue: ${state.pendingMeshMounts?.length || 0}\n`;
    content += `Pending Unloads: ${stats.pendingUnloads || 0}\n`;
    content += `Async DB Deltas: ${stats.processingDeltas || 0}\n`;
    content += `Failed Chunks: ${stats.failedChunks || 0} ${stats.failedChunks > 0 ? JSON.stringify(stats.failedChunkKeys) : ''}\n\n`;

    content += "--- 5. WORKER THREAD POOL ---\n";
    content += `Pool Size: ${workerStats.poolSize}\n`;
    content += `Active Jobs: ${workerStats.activeJobs}\n`;
    content += `Watchdog Resets: ${workerStats.resets}\n\n`;

    content += "--- 6. PLAYER STATE ---\n";
    content += `Position: ${state.playerPos ? `[${state.playerPos.map(p=>p.toFixed(2)).join(', ')}]` : 'N/A'}\n`;
    content += `Health: ${state.playerHealth}\n`;
    content += `Render Distance: ${state.renderDistance}\n`;
    content += `Shadow Quality: ${state.shadowQuality}\n`;
    content += `Debug Lighting: ${state.debugLighting ? 'ON' : 'OFF'}\n\n`;

    content += "--- 7. NETWORK ---\n";
    content += JSON.stringify(netState, null, 2) + "\n\n";

    content += "--- 8. LOCAL STORAGE ---\n";
    content += `IndexedDB Quota: ${storageStr}\n\n`;

    content += "--- 9. ERROR LOG ---\n";
    content += JSON.stringify(stats.errorLog || [], null, 2) + "\n";
    
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
        <div className="bg-[#111827] border border-[#374151] rounded-xl p-8 max-w-xl w-full text-white shadow-2xl relative text-center">
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
            The native engine dump contains all active chunks, player coordinates, and entity counts, ready to be exported to a `.txt` file.
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

  const downloadFile = (format) => {
    let content = '';
    let filename = `spector_capture_${Date.now()}`;
    let type = '';

    if (format === 'json') {
      // JSON stringification handles cyclical structures poorly if any exist, but Spector returns safe JSON
      content = JSON.stringify(spectorData, null, 2);
      filename += '.json';
      type = 'application/json';
    } else {
      content = "=== SPECTOR.JS RENDER TRACE ===\n\n";
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
          <h3 className="text-cyan-200/80 tracking-[0.3em] text-sm font-light mb-1">SYSTEM DIAGNOSTICS</h3>
          <h3 className="text-cyan-400 tracking-[0.2em] text-2xl font-bold">FRAME CAPTURE</h3>
        </div>
        
        <div className="bg-white/5 border border-white/10 rounded-xl p-6 w-full mb-8 shadow-inner flex justify-around">
          <div className="flex flex-col items-center">
            <span className="text-white/50 text-xs tracking-widest font-bold mb-1">COMMANDS</span>
            <span className="text-white text-3xl font-mono">{totalCommands}</span>
          </div>
          <div className="w-px bg-white/10" />
          <div className="flex flex-col items-center">
            <span className="text-cyan-400/70 text-xs tracking-widest font-bold mb-1">DRAW CALLS</span>
            <span className="text-cyan-400 text-3xl font-mono font-bold drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]">{drawCalls}</span>
          </div>
        </div>

        <div className="flex gap-4 w-full">
          <button 
            onClick={() => downloadFile('json')}
            className="flex-1 bg-cyan-950/40 hover:bg-cyan-900/60 border border-cyan-500/30 hover:border-cyan-400 rounded-lg py-3 flex items-center justify-center gap-2 transition-all group cursor-pointer"
          >
            <FileJson size={18} className="text-cyan-400 group-hover:scale-110 transition-transform" />
            <span className="text-cyan-100 text-sm font-bold tracking-wider">.JSON (AI)</span>
          </button>
          
          <button 
            onClick={() => downloadFile('txt')}
            className="flex-1 bg-slate-900/40 hover:bg-slate-800/60 border border-white/10 hover:border-white/30 rounded-lg py-3 flex items-center justify-center gap-2 transition-all group cursor-pointer"
          >
            <FileText size={18} className="text-white/60 group-hover:text-white group-hover:scale-110 transition-transform" />
            <span className="text-white/70 group-hover:text-white text-sm font-bold tracking-wider">.TXT (RAW)</span>
          </button>
        </div>

      </div>
    </div>
  );
};
