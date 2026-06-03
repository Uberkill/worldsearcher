import { useState, useEffect, useRef } from 'react';
import { PlaySquare, Settings, Moon, Sun, ChevronLeft, Volume2, VolumeX, Plus, Clock, File, Trash2, Zap, Power, Download, Upload } from 'lucide-react';
import * as THREE from 'three';
import { useStore } from '../../stores/useStore';
import { useNetworkStore } from '../../stores/useNetworkStore';
import { clearSlotDB, exportSlot, importSlot } from '../../utils/db';
import { audioManager } from '../../utils/AudioManager';
import { sfxManager } from '../../utils/SFXManager';

const formatPlaytime = (seconds) => {
  if (!seconds) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

// --- REUSABLE UI COMPONENTS ---
const CustomSlider = ({ label, value, onChange, min = 0, max = 100, suffix = "%" }) => {
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className="flex justify-between items-center text-sm font-light text-white/50 group w-full">
      <span className="group-hover:text-white transition-colors w-24">{label}</span>
      <div className="flex-1 mx-4 relative flex items-center h-4">
        <div className="absolute w-full h-[2px] bg-white/10 rounded-full" />
        <div className="absolute h-[2px] bg-cyan-400 rounded-full" style={{ width: `${percentage}%` }} />
        <div className="absolute w-3 h-3 bg-cyan-300 rounded-full shadow-[0_0_8px_#22d3ee] cursor-none pointer-events-none" style={{ left: `calc(${percentage}% - 6px)` }} />
        <input type="range" min={min} max={max} className="absolute w-full opacity-0 cursor-none" value={value} onChange={(e) => onChange(Number(e.target.value))} />
      </div>
      <span className="text-cyan-200 font-mono text-xs w-10 text-right">{value}{suffix}</span>
    </div>
  );
};

const LoadingScreen = ({ isActive, type, onComplete }) => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (isActive) {
      setProgress(100);
      onComplete();
    }
  }, [isActive, onComplete]);

  return (
    <div className={`fixed inset-0 z-[60] backdrop-blur-[40px] bg-black/20 transition-all duration-1000 flex flex-col items-center justify-center ${isActive ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
      <div className={`bg-white/5 border border-white/10 rounded-2xl p-8 w-96 flex flex-col items-center shadow-[0_0_50px_rgba(34,211,238,0.05)] transition-all duration-1000 delay-300 ${isActive ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0'}`}>
         <h2 className="text-xl font-light tracking-[0.3em] text-cyan-400 mb-6 uppercase text-center">
            {type === 'new' ? 'Scanning Biosphere' : 'Restoring Systems'}
         </h2>
         <div className="w-full h-[2px] bg-white/10 rounded-full mb-2 overflow-hidden relative">
            <div className="absolute h-full bg-cyan-400 shadow-[0_0_15px_#22d3ee] transition-all duration-100 ease-out" style={{ width: `${progress}%` }} />
         </div>
         <div className="flex justify-between w-full text-[10px] text-white/50 font-mono mb-8 uppercase tracking-widest">
            <span>Loading Chunks...</span>
            <span className="text-cyan-300">{Math.floor(progress)}%</span>
         </div>
         <div className="border-t border-white/10 pt-5 w-full text-center">
            <span className="text-[9px] tracking-[0.4em] text-cyan-400/50 font-bold block mb-2">SYSTEM TIP</span>
            <span className="text-xs text-white/60 italic font-light">"If I can be of any use to you, activate me."</span>
         </div>
      </div>
    </div>
  );
};


// --- MAIN APP COMPONENT ---

export default function TitleScreen({ onStartNew, onContinue }) {
  const [isNight, setIsNight] = useState(true);
  const [transitionState, setTransitionState] = useState('idle'); // 'idle', 'new', 'continue'
  const [activeMenu, setActiveMenu] = useState('main'); // 'main', 'save_select', 'settings', 'multiplayer', 'multiplayer_host', 'multiplayer_join'
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [playerNameInput, setPlayerNameInput] = useState('');
  const [kickReasonError, setKickReasonError] = useState(null);
  const [isMusicOn, setIsMusicOn] = useState(false);
  const audioCtxRef = useRef(null);
  const windGainRef = useRef(null);

  // Real audio from settings
  const masterVolume = useStore(state => state.masterVolume);
  const setMasterVolumeStore = useStore(state => state.setMasterVolume);
  const musicVolume = useStore(state => state.musicVolume);
  const setMusicVolumeStore = useStore(state => state.setMusicVolume);

  const audioMaster = Math.round(masterVolume * 100);
  const audioMusic = Math.round(musicVolume * 100);

  const setAudioMaster = (val) => setMasterVolumeStore(val / 100);
  const setAudioMusic = (val) => setMusicVolumeStore(val / 100);
  
  // Performance from settings
  const renderDistance = useStore(state => state.renderDistance);
  const setRenderDistance = useStore(state => state.setRenderDistance);
  const shadowQuality = useStore(state => state.shadowQuality);
  const setShadowQuality = useStore(state => state.setShadowQuality);
  
  const [selectedSlot, setSelectedSlot] = useState(null);
  const selectedSlotRef = useRef(null); // Ref so handleLoadingComplete always reads the latest value
  
  const containerRef = useRef(null);
  const stateRef = useRef({ isNight, transitionState, activeMenu });

  const [saves, setSaves] = useState(() => {
    const newSaves = [];
    for (let i = 1; i <= 3; i++) {
      const meta = localStorage.getItem(`saveMetadata_slot${i}`);
      if (meta) {
        try {
          const parsed = JSON.parse(meta);
          newSaves.push({
            id: i,
            isEmpty: false,
            name: parsed.name || `Sector ${i}`,
            mode: parsed.mode || 'Survival',
            played: formatPlaytime(parsed.played),
            date: parsed.date || 'Unknown'
          });
        } catch {
          newSaves.push({ id: i, isEmpty: true });
        }
      } else {
        newSaves.push({ id: i, isEmpty: true });
      }
    }
    return newSaves;
  });

  const handleDeleteSave = async (e, id) => {
    e.stopPropagation();
    try {
      // The chunks are saved in IDB using just the ID as a string prefix
      await clearSlotDB(`slot${id}`);
      localStorage.removeItem(`saveMetadata_slot${id}`);
      
      // Update the UI seamlessly instead of a hard reload
      setSaves(prev => prev.map(save => {
        if (save.id === id) {
          return { id, isEmpty: true };
        }
        return save;
      }));
    } catch (err) {
      console.error("Failed to delete save slot:", err);
      alert("Failed to delete save slot. Check console.");
    }
  };
  
  const fileInputRef = useRef(null);
  const [importTargetSlot, setImportTargetSlot] = useState(null);

  const handleExportSave = async (e, id) => {
    e.stopPropagation();
    await exportSlot(`slot${id}`);
  };

  const handleImportClick = (e, id) => {
    e.stopPropagation();
    setImportTargetSlot(id);
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file || !importTargetSlot) return;
    
    setTransitionState('new'); // show loading screen
    try {
      await importSlot(importTargetSlot, file);
      window.location.reload();
    } catch (err) {
      alert("Failed to import save file.");
      setTransitionState('idle');
    }
  };
  
  const { hostGame, joinGame, connectionStatus, roomCode, setPlayerName } = useNetworkStore();
  
  const handleJoin = async () => {
     if (roomCodeInput.length < 6 || !playerNameInput) return;
     audioManager.initialize();
     sfxManager.initialize();
     setPlayerName(playerNameInput);
     setKickReasonError(null);
     await clearSlotDB('multiplayer_guest'); // Wipe old stale chunks before joining new game!
     joinGame(roomCodeInput);
  };
  
  // Auto-transition to 'continue' once connected as Guest
  useEffect(() => {
     if (connectionStatus === 'connected' && !useNetworkStore.getState().isHost) {
        // Connected as guest! Boot into game.
        onContinue('multiplayer_guest');
     }
  }, [connectionStatus, onContinue]);

  useEffect(() => {
     const reason = sessionStorage.getItem('kickReason');
     if (reason) {
        setKickReasonError(reason);
        setActiveMenu('multiplayer_join');
        sessionStorage.removeItem('kickReason');
     }
  }, []);

  useEffect(() => {
    stateRef.current = { isNight, transitionState, activeMenu };
  }, [isNight, transitionState, activeMenu]);

  // Procedural Wind Audio
  useEffect(() => {
    if (!isMusicOn) {
      if (windGainRef.current && audioCtxRef.current) {
        windGainRef.current.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 1);
      }
      return;
    }

    if (!audioCtxRef.current) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;

      const bufferSize = ctx.sampleRate * 2;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
      
      const windNoise = ctx.createBufferSource();
      windNoise.buffer = buffer;
      windNoise.loop = true;
      
      const windFilter = ctx.createBiquadFilter();
      windFilter.type = 'lowpass';
      windFilter.frequency.value = 250;
      
      const windGain = ctx.createGain();
      windGain.gain.value = 0; 
      
      windNoise.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(ctx.destination);
      windNoise.start();
      
      windGainRef.current = windGain;
    }

    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    
    if (windGainRef.current) {
      windGainRef.current.gain.setTargetAtTime(masterVolume * 0.5, audioCtxRef.current.currentTime, 2);
    }
    
  }, [isMusicOn, masterVolume]);

  // Three.js Background Rendering & Memory Management
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    
    // Explicit styling to ensure canvas fills container
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.left = '0';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';

    container.appendChild(renderer.domElement);

    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        camera.aspect = entry.contentRect.width / entry.contentRect.height;
        camera.updateProjectionMatrix();
        renderer.setSize(entry.contentRect.width, entry.contentRect.height);
      }
    });
    resizeObserver.observe(container);

    const terrainMat = new THREE.MeshStandardMaterial({ color: 0x1a2b3c, roughness: 0.8 });
    const gridSize = 40;
    const count = gridSize * gridSize;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const instancedMesh = new THREE.InstancedMesh(geometry, terrainMat, count);
    instancedMesh.receiveShadow = true;
    instancedMesh.castShadow = true;

    const dummy = new THREE.Object3D();
    let i = 0;
    for (let x = 0; x < gridSize; x++) {
      for (let z = 0; z < gridSize; z++) {
        const height = Math.floor(Math.sin(x * 0.2) * 2 + Math.cos(z * 0.2) * 2);
        dummy.position.set(x - gridSize / 2, height, z - gridSize / 2);
        dummy.updateMatrix();
        instancedMesh.setMatrixAt(i, dummy.matrix);
        i++;
      }
    }
    scene.add(instancedMesh);

    const shipGroup = new THREE.Group();
    shipGroup.position.set(15, 5, -25);
    shipGroup.rotation.set(0.2, -0.5, 0.1);

    const hullGeo = new THREE.BoxGeometry(4, 2, 8);
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x445566, metalness: 0.8, roughness: 0.2 });
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.castShadow = true;
    hull.receiveShadow = true;
    shipGroup.add(hull);

    const coreGeo = new THREE.PlaneGeometry(2, 1);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.set(0, 0, 4.1);
    shipGroup.add(core);

    const pointLight = new THREE.PointLight(0x00ffff, 2, 10);
    pointLight.position.set(0, 0, 5);
    shipGroup.add(pointLight);
    scene.add(shipGroup);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0x6088c6, 0.5);
    dirLight.position.set(-10, 20, -10);
    dirLight.castShadow = true;
    scene.add(dirLight);

    scene.fog = new THREE.Fog(0x0b0c10, 10, 40);

    let animationFrameId;
    let lastTime = performance.now();
    const currentLookAt = new THREE.Vector3(0, 0, 0); 

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      
      const currentTime = performance.now();
      const delta = Math.min((currentTime - lastTime) / 1000, 0.1);
      lastTime = currentTime;
      const elapsed = currentTime / 1000;
      const state = stateRef.current;

      terrainMat.color.lerp(new THREE.Color(state.isNight ? '#1a2b3c' : '#73a961'), delta * 2);
      scene.fog.color.lerp(new THREE.Color(state.isNight ? '#0b0c10' : '#87CEEB'), delta * 2);
      ambientLight.intensity = THREE.MathUtils.lerp(ambientLight.intensity, state.isNight ? 0.2 : 0.6, delta * 2);
      dirLight.intensity = THREE.MathUtils.lerp(dirLight.intensity, state.isNight ? 0.5 : 1.5, delta * 2);
      dirLight.color.lerp(new THREE.Color(state.isNight ? '#6088c6' : '#ffffff'), delta * 2);
      dirLight.position.lerp(new THREE.Vector3(state.isNight ? -10 : 10, 20, state.isNight ? -10 : 10), delta * 2);

      shipGroup.position.y = 5 + Math.sin(elapsed) * 0.2;

      // Camera State Logic
      if (state.transitionState === 'continue') {
        camera.position.lerp(new THREE.Vector3(10, 8, -15), delta * 2);
        currentLookAt.lerp(new THREE.Vector3(15, 5, -25), delta * 2.5);
      } else if (state.transitionState === 'new') {
        camera.position.lerp(new THREE.Vector3(0, 5, 20), delta * 2); 
        currentLookAt.lerp(new THREE.Vector3(0, 200, 0), delta * 3); 
      } else {
        let targetX = Math.sin(elapsed * 0.2) * 2;
        let targetY = 8 + Math.cos(elapsed * 0.3) * 0.5;
        
        if (state.activeMenu === 'settings') {
          targetX += 6; 
          currentLookAt.lerp(new THREE.Vector3(5, 0, 0), delta * 2.5);
        } else if (state.activeMenu === 'save_select' || state.activeMenu === 'multiplayer_host') {
           targetY += 4; 
           currentLookAt.lerp(new THREE.Vector3(0, 0, -20), delta * 2.5);
        } else if (state.activeMenu === 'multiplayer' || state.activeMenu === 'multiplayer_join') {
           targetX -= 4;
           targetY += 2;
           currentLookAt.lerp(new THREE.Vector3(-10, 0, -10), delta * 2.5);
        } else {
          currentLookAt.lerp(new THREE.Vector3(0, 0, 0), delta * 3);
        }
        camera.position.lerp(new THREE.Vector3(targetX, targetY, 15), delta * 3);
      }
      
      camera.lookAt(currentLookAt);
      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      renderer.forceContextLoss();
      renderer.dispose();
      if (container && renderer.domElement) container.removeChild(renderer.domElement);
      scene.traverse((object) => {
        if (!object.isMesh) return;
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          Array.isArray(object.material) ? object.material.forEach(m => m.dispose()) : object.material.dispose();
        }
      });
    };
  }, []);

  const handleAction = (action, slotId, isHost = false) => {
    if (transitionState !== 'idle') return;
    if (isHost && !playerNameInput) return; // Must have name
    
    audioManager.initialize();
    sfxManager.initialize();
    
    selectedSlotRef.current = slotId; // Sync ref update — always readable in handleLoadingComplete
    setSelectedSlot(slotId);
    setTransitionState(action);
    if (isHost) {
       setPlayerName(playerNameInput);
       hostGame();
    }
  };

  const handleLoadingComplete = () => {
    // Use ref (not state) — state may still be stale due to React batching
    const slot = selectedSlotRef.current;
    if (transitionState === 'new' && onStartNew) onStartNew(`slot${slot}`);
    if (transitionState === 'continue' && onContinue) onContinue(`slot${slot}`);
  };

  return (
    <div className="w-full h-screen relative overflow-hidden font-sans text-white select-none" style={{ backgroundColor: isNight ? '#0b0c10' : '#87CEEB', cursor: 'none' }}>
      
      <div className="absolute inset-0 transition-opacity duration-1000" style={{ opacity: transitionState !== 'idle' ? 0.2 : 1 }}>
        <div ref={containerRef} className="w-full h-full outline-none block" />
      </div>

      <LoadingScreen isActive={transitionState !== 'idle'} type={transitionState} onComplete={handleLoadingComplete} />

      <div className={`absolute inset-0 bg-[#0b0c10]/20 backdrop-blur-[12px] transition-opacity duration-500 pointer-events-none z-10 ${activeMenu === 'save_select' || activeMenu === 'multiplayer' || activeMenu === 'multiplayer_host' || activeMenu === 'multiplayer_join' ? 'opacity-100' : 'opacity-0'}`} />

      {/* MULTIPLAYER ROOT MENU */}
      <div className={`absolute inset-0 z-30 flex flex-col items-center justify-center transition-all duration-[600ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${(activeMenu === 'multiplayer') ? 'opacity-100 pointer-events-auto scale-100' : 'opacity-0 pointer-events-none scale-105'}`}>
         {/* Two huge panels for Host and Join */}
         <div className="flex space-x-12">
            <button onClick={() => setActiveMenu('multiplayer_host')} className="group w-80 h-96 bg-cyan-900/20 backdrop-blur-md border border-cyan-500/30 rounded-3xl hover:bg-cyan-800/40 hover:border-cyan-400 transition-all flex flex-col items-center justify-center shadow-2xl hover:shadow-[0_0_50px_rgba(34,211,238,0.2)]">
               <Zap className="text-cyan-400 mb-6 group-hover:scale-110 transition-transform" size={64} />
               <span className="text-3xl font-light tracking-widest text-white mb-2">HOST</span>
               <span className="text-sm font-bold tracking-[0.2em] text-cyan-200">CREATE A SERVER</span>
            </button>
            <button onClick={() => setActiveMenu('multiplayer_join')} className="group w-80 h-96 bg-white/5 backdrop-blur-md border border-white/10 rounded-3xl hover:bg-white/10 hover:border-white/30 transition-all flex flex-col items-center justify-center shadow-2xl">
               <PlaySquare className="text-white/50 group-hover:text-white mb-6 group-hover:scale-110 transition-transform" size={64} />
               <span className="text-3xl font-light tracking-widest text-white mb-2">JOIN</span>
               <span className="text-sm font-bold tracking-[0.2em] text-white/50 group-hover:text-white/80">CONNECT TO A FRIEND</span>
            </button>
         </div>
         <button onClick={() => setActiveMenu('main')} className="group flex items-center mt-12 p-4 rounded-xl hover:bg-white/5 border border-transparent hover:border-white/10 transition-all cursor-none">
            <ChevronLeft className="text-white/50 group-hover:text-cyan-400 transition-colors mr-2" size={20} />
            <span className="tracking-widest font-light text-white/50 group-hover:text-white transition-colors">BACK TO MENU</span>
         </button>
      </div>

      {/* MULTIPLAYER JOIN MENU */}
      <div className={`absolute inset-0 z-30 flex flex-col items-center justify-center transition-all duration-[600ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${(activeMenu === 'multiplayer_join') ? 'opacity-100 pointer-events-auto scale-100' : 'opacity-0 pointer-events-none scale-105'}`}>
         <div className="bg-black/40 backdrop-blur-xl border border-white/10 p-12 rounded-3xl flex flex-col items-center shadow-[0_0_80px_rgba(0,0,0,0.8)] w-[500px]">
            <h2 className="text-3xl font-light tracking-widest text-white mb-8">JOIN SERVER</h2>
            
            <div className="w-full flex flex-col space-y-6">
               <div className="flex flex-col">
                  <label className="text-[10px] text-white/50 tracking-[0.2em] font-bold mb-2">PLAYER NAME</label>
                  <input 
                    type="text" 
                    maxLength={16}
                    value={playerNameInput}
                    onChange={e => setPlayerNameInput(e.target.value.replace(/[^a-zA-Z0-9_ ]/g, ''))}
                    className="bg-black/60 border border-white/10 rounded-lg p-4 text-center tracking-[0.2em] text-white outline-none focus:border-cyan-400/50" 
                    placeholder="ENTER NAME"
                  />
               </div>
               
               <div className="flex flex-col">
                  <label className="text-[10px] text-white/50 tracking-[0.2em] font-bold mb-2">ROOM CODE</label>
                  <input 
                    type="text" 
                    maxLength={6}
                    value={roomCodeInput}
                    onChange={e => setRoomCodeInput(e.target.value.toUpperCase())}
                    className="bg-black/60 border border-white/10 rounded-lg p-4 text-center tracking-[0.4em] text-white outline-none focus:border-cyan-400/50 uppercase" 
                    placeholder="6-DIGIT CODE"
                  />
               </div>
            </div>

            {kickReasonError && connectionStatus !== 'connecting' && (
               <div className="mt-6 text-red-400 text-xs tracking-widest font-bold text-center max-w-sm">{kickReasonError}</div>
            )}
            {connectionStatus === 'disconnected' && useNetworkStore.getState().peer && !kickReasonError && (
               <div className="mt-6 text-red-400 text-xs tracking-widest font-bold">CONNECTION FAILED</div>
            )}
            {connectionStatus === 'connecting' && (
               <div className="mt-6 text-cyan-400 text-xs tracking-widest font-bold animate-pulse">CONNECTING...</div>
            )}

            <button 
              onClick={handleJoin}
              disabled={roomCodeInput.length < 6 || !playerNameInput || connectionStatus === 'connecting'}
              className="mt-10 w-full py-4 bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 rounded-xl hover:bg-cyan-500/40 transition-all tracking-widest font-bold text-lg disabled:opacity-30 disabled:pointer-events-none"
            >
              CONNECT
            </button>
         </div>
         <button onClick={() => setActiveMenu('multiplayer')} className="group flex items-center mt-8 p-4 rounded-xl hover:bg-white/5 border border-transparent hover:border-white/10 transition-all cursor-none">
            <ChevronLeft className="text-white/50 group-hover:text-cyan-400 transition-colors mr-2" size={20} />
            <span className="tracking-widest font-light text-white/50 group-hover:text-white transition-colors">BACK TO MULTIPLAYER</span>
         </button>
      </div>

      {/* SAVE SELECTION (SINGLE PLAYER & HOST) */}
      <div className={`absolute inset-0 z-30 flex flex-col items-center justify-center transition-all duration-[600ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${(activeMenu === 'save_select' || activeMenu === 'multiplayer_host') ? 'opacity-100 pointer-events-auto scale-100' : 'opacity-0 pointer-events-none scale-105'}`}>
        <div className="w-full max-w-5xl px-8">
          <div className="flex justify-between items-end mb-12">
              <div>
                <h2 className={`text-4xl font-light tracking-[0.2em] mb-2 transition-colors duration-700 ${isNight ? 'text-white' : 'text-[#0b0c10]'}`}>WORLD <span className={`font-bold transition-colors duration-700 ${isNight ? 'text-cyan-400' : 'text-cyan-800'}`}>SEARCHER</span></h2>
                <p className={`tracking-widest text-sm font-light uppercase transition-colors duration-700 ${isNight ? 'text-white/50' : 'text-[#0b0c10]/70'}`}>
                   {activeMenu === 'multiplayer_host' ? 'Enter a Host Name and select a Save Slot to Host.' : 'Select a Save Slot to initialize your visor.'}
                </p>
              </div>
            <div className="flex items-end space-x-8">
              
              {activeMenu === 'multiplayer_host' && (
                <div className="flex flex-col items-end mr-8">
                  <span className="text-[10px] text-cyan-400 tracking-[0.2em] font-bold mb-2">YOUR HOST NAME</span>
                  <div className="flex space-x-2">
                    <input 
                      type="text" 
                      maxLength={16}
                      value={playerNameInput}
                      onChange={e => setPlayerNameInput(e.target.value.replace(/[^a-zA-Z0-9_ ]/g, ''))}
                      className="bg-black/40 border border-cyan-500/30 rounded-lg p-2 w-48 text-center tracking-[0.2em] text-cyan-100 outline-none focus:border-cyan-400/80" 
                      placeholder="ENTER NAME"
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-col items-end">
                <span className="text-[10px] text-white/50 tracking-[0.2em] font-bold mb-2 flex items-center">
                  <Zap size={12} className="mr-1.5 text-cyan-400" /> ENGINE PERFORMANCE
                </span>
                <div className="flex bg-black/40 border border-white/10 rounded-lg p-1 backdrop-blur-md">
                  <button onClick={() => setRenderDistance(4)} className={`px-4 py-1.5 text-xs font-bold tracking-widest rounded-md transition-all ${renderDistance <= 4 ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50' : 'text-white/40 hover:text-white/80 border border-transparent hover:bg-white/5'}`}>LOW</button>
                  <button onClick={() => setRenderDistance(8)} className={`px-4 py-1.5 text-xs font-bold tracking-widest rounded-md transition-all ${renderDistance === 8 ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50' : 'text-white/40 hover:text-white/80 border border-transparent hover:bg-white/5'}`}>MID</button>
                  <button onClick={() => setRenderDistance(12)} className={`px-4 py-1.5 text-xs font-bold tracking-widest rounded-md transition-all ${renderDistance >= 12 ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50' : 'text-white/40 hover:text-white/80 border border-transparent hover:bg-white/5'}`}>ULTRA</button>
                </div>
              </div>
              <button onClick={() => setActiveMenu(activeMenu === 'multiplayer_host' ? 'multiplayer' : 'main')} className="group flex items-center p-4 rounded-xl hover:bg-white/5 border border-transparent hover:border-white/10 transition-all cursor-none mb-0">
                <ChevronLeft className="text-white/50 group-hover:text-cyan-400 transition-colors mr-2" size={20} />
                <span className="tracking-widest font-light text-white/50 group-hover:text-white transition-colors">BACK</span>
              </button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-6">
            {saves.map((save) => (
              <div 
                key={save.id} onClick={() => handleAction(save.isEmpty ? 'new' : 'continue', save.id, activeMenu === 'multiplayer_host')}
                className={`group relative overflow-hidden rounded-2xl border transition-all duration-300 text-left cursor-pointer h-64 p-6 flex flex-col justify-between
                  ${save.isEmpty ? 'bg-black/20 border-white/5 hover:border-white/20 hover:bg-white/5 items-center justify-center text-center border-dashed' : 'bg-white/5 border-white/10 hover:border-cyan-400 hover:bg-cyan-900/20 hover:shadow-[0_0_30px_rgba(34,211,238,0.15)] backdrop-blur-md'}
                  ${(activeMenu === 'multiplayer_host' && !playerNameInput) ? 'opacity-50 pointer-events-none grayscale' : ''}
                `}
              >
                <div className="absolute inset-0 bg-gradient-to-b from-cyan-400/0 to-cyan-400/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                
                {!save.isEmpty && (
                  <div className="absolute top-4 right-4 z-20 flex space-x-2 opacity-0 group-hover:opacity-100 transition-all">
                    <button onClick={(e) => handleExportSave(e, save.id)} className="p-2 bg-cyan-500/10 hover:bg-cyan-500/30 text-cyan-400/50 hover:text-cyan-400 border border-cyan-500/20 rounded-lg transition-all" title="Export .vx file">
                      <Download size={16} />
                    </button>
                    <button onClick={(e) => handleDeleteSave(e, save.id)} className="p-2 bg-red-500/10 hover:bg-red-500/30 text-red-400/50 hover:text-red-400 border border-red-500/20 rounded-lg transition-all" title="Delete Save">
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}

                {save.isEmpty ? (
                  <>
                    <button onClick={(e) => handleImportClick(e, save.id)} className="absolute top-4 right-4 z-20 p-2 bg-cyan-500/10 hover:bg-cyan-500/30 text-cyan-400/50 hover:text-cyan-400 border border-cyan-500/20 rounded-lg transition-all opacity-0 group-hover:opacity-100" title="Import .vx file">
                       <Upload size={16} />
                    </button>
                    <Plus className="text-white/20 group-hover:text-cyan-400 mb-4 transition-colors pointer-events-none" size={48} />
                    <span className="text-sm font-bold tracking-[0.2em] text-white/50 group-hover:text-white transition-colors pointer-events-none">NEW JOURNEY</span>
                    <span className="text-[10px] text-white/30 tracking-widest mt-2 uppercase pointer-events-none">Empty Slot {save.id}</span>
                  </>
                ) : (
                  <>
                    <div className="pointer-events-none">
                      <div className="flex justify-between items-start mb-4">
                        <span className="px-3 py-1 bg-black/40 rounded-full border border-white/10 text-[10px] font-mono text-cyan-300 tracking-widest uppercase">Slot {save.id}</span>
                        <File className="text-white/20 transition-all duration-300 group-hover:opacity-0 group-hover:scale-75" size={20} />
                      </div>
                      <h3 className="text-2xl font-light tracking-wider text-white group-hover:text-cyan-200 transition-colors">{save.name}</h3>
                      <span className="text-xs text-white/50 font-bold tracking-[0.2em] uppercase block mt-1">{save.mode} Mode</span>
                    </div>
                    <div className="border-t border-white/10 pt-4 flex justify-between items-end pointer-events-none">
                      <div>
                        <span className="flex items-center text-[10px] text-white/40 font-mono mb-1"><Clock size={12} className="mr-1.5"/> PLAYTIME</span>
                        <span className="text-sm text-white/70 font-mono">{save.played}</span>
                      </div>
                      <span className="text-[10px] text-white/30 font-mono">{save.date}</span>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* TITLE MENU Container */}
      <div className={`absolute inset-0 w-full p-16 flex flex-col justify-between transition-opacity duration-700 z-20 ${transitionState !== 'idle' ? 'opacity-0 pointer-events-none' : 'opacity-100'} ${(activeMenu !== 'main' && activeMenu !== 'settings') ? 'opacity-0 pointer-events-none' : ''}`}>
        
        <div className={`flex items-center space-x-8 transition-all duration-700 ${isNight ? 'drop-shadow-2xl' : 'drop-shadow-[0_20px_60px_rgba(0,0,0,0.4)]'}`}>
          <div className={`w-24 h-24 border-[4px] rounded-xl flex items-center justify-center transition-colors duration-700 ${isNight ? 'border-cyan-400' : 'border-cyan-700'}`}>
            <div className={`w-10 h-10 rotate-45 transition-all duration-700 ${isNight ? 'bg-white shadow-[0_0_20px_#fff]' : 'bg-[#0b0c10] shadow-[0_0_40px_rgba(0,0,0,0.6)]'}`} />
          </div>
          <div className="transition-colors duration-700">
            <h1 className={`text-7xl font-light tracking-[0.3em] mb-2 transition-colors duration-700 ${isNight ? 'text-white' : 'text-[#0b0c10]'}`}>WORLD</h1>
            <h2 className={`text-2xl font-bold tracking-[0.5em] transition-colors duration-700 ${isNight ? 'text-cyan-300' : 'text-cyan-800'}`}>SEARCHER</h2>
          </div>
        </div>

        <div className="flex justify-between items-end w-full relative h-full">
          <div className="text-white/30 text-[10px] tracking-[0.3em] font-light hidden md:block">v0.8.4 // ATMOSPHERIC SCANNERS ACTIVE</div>

          <div className="relative flex justify-end items-end h-full">
            
            {/* TITLE MENU MAIN LINKS */}
            <div className={`flex flex-col items-end space-y-4 transition-all duration-[600ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${activeMenu === 'main' ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-12 pointer-events-none absolute right-0 bottom-0'}`}>
              <div className="flex space-x-4 mb-8">
                <button onClick={() => setIsMusicOn(!isMusicOn)} className="p-3 rounded-full bg-white/5 backdrop-blur-md border border-white/10 hover:bg-white/20 transition-all text-white/80 hover:text-white">
                  {isMusicOn ? <Volume2 size={20} /> : <VolumeX size={20} />}
                </button>
                <button onClick={() => setIsNight(!isNight)} className="p-3 rounded-full bg-white/5 backdrop-blur-md border border-white/10 hover:bg-white/20 transition-all text-white/80 hover:text-white">
                  {isNight ? <Sun size={20} /> : <Moon size={20} />}
                </button>
              </div>
              <button onClick={() => setActiveMenu('save_select')} className="group relative flex items-center justify-end w-64 p-4 rounded-xl bg-white/10 backdrop-blur-xl border border-white/20 hover:border-cyan-400/50 hover:bg-white/20 transition-all duration-300">
                <span className="text-lg font-light tracking-widest mr-4 group-hover:text-cyan-200 transition-colors">SOLO PLAY</span>
                <PlaySquare className="text-cyan-400" size={24} />
              </button>

              <button onClick={() => setActiveMenu('multiplayer')} className="group relative flex items-center justify-end w-64 p-4 rounded-xl bg-cyan-900/30 backdrop-blur-xl border border-cyan-500/30 hover:border-cyan-400 hover:bg-cyan-800/40 transition-all duration-300">
                <span className="text-lg font-light tracking-widest mr-4 text-cyan-200 group-hover:text-cyan-100 transition-colors">MULTIPLAYER</span>
                <Zap className="text-cyan-400" size={24} />
              </button>

              <button onClick={() => setActiveMenu('settings')} className="group relative flex items-center justify-end w-64 p-4 rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 hover:border-white/40 hover:bg-white/15 transition-all duration-300">
                <span className="text-lg font-light tracking-widest mr-4 group-hover:text-white transition-colors">TITLE SETTINGS</span>
                <Settings className="text-white/70 group-hover:text-white" size={24} />
              </button>
              
              <button onClick={() => window.close()} className="group relative flex items-center justify-end w-64 p-4 rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 hover:border-red-400 hover:bg-red-900/20 hover:shadow-[0_0_30px_rgba(248,113,113,0.2)] transition-all duration-300">
                <span className="text-lg font-light tracking-widest mr-4 text-red-200 group-hover:text-red-100 transition-colors">QUIT TO DESKTOP</span>
                <Power className="text-red-400/70 group-hover:text-red-400" size={24} />
              </button>
            </div>

            {/* TITLE SETTINGS MENU */}
            <div className={`absolute bottom-0 right-0 w-80 flex flex-col transition-all duration-[600ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${activeMenu === 'settings' ? 'opacity-100 translate-x-0 pointer-events-auto delay-100' : 'opacity-0 translate-x-12 pointer-events-none'}`}>
              <div className="bg-white/5 backdrop-blur-2xl border border-white/10 rounded-2xl p-6 shadow-2xl space-y-8">
                <div className="flex items-center justify-between border-b border-white/10 pb-4">
                   <h3 className="text-xl font-light tracking-widest text-white">SETTINGS</h3>
                   <Settings className="text-cyan-400" size={20} />
                </div>
                <div className="space-y-8">
                    <div className="space-y-4">
                      <div className="flex items-center space-x-2 text-white/70">
                        <Volume2 size={16} />
                        <span className="text-sm tracking-widest font-bold">AUDIO</span>
                      </div>
                      <CustomSlider label="MASTER" value={audioMaster} onChange={setAudioMaster} />
                      <CustomSlider label="MUSIC" value={audioMusic} onChange={setAudioMusic} />
                    </div>
                    <div className="space-y-4">
                      <div className="flex items-center space-x-2 text-white/70">
                        <Zap size={16} />
                        <span className="text-sm tracking-widest font-bold">GRAPHICS</span>
                      </div>
                      <CustomSlider label="RENDER DIST." value={renderDistance} onChange={setRenderDistance} min={4} max={16} suffix=" ch" />
                      <div className="flex justify-between items-center text-sm font-light text-white/50 w-full">
                        <span className="w-24">SHADOWS</span>
                        <div className="flex bg-black/40 border border-white/10 rounded-lg p-1">
                          <button onClick={() => setShadowQuality('performance')} className={`px-4 py-1 text-xs font-bold tracking-widest rounded-md transition-all ${shadowQuality === 'performance' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50' : 'text-white/40 hover:text-white border border-transparent hover:bg-white/5'}`}>PERF.</button>
                          <button onClick={() => setShadowQuality('visual')} className={`px-4 py-1 text-xs font-bold tracking-widest rounded-md transition-all ${shadowQuality === 'visual' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50' : 'text-white/40 hover:text-white border border-transparent hover:bg-white/5'}`}>VISUAL</button>
                        </div>
                      </div>
                    </div>
                </div>
              </div>
              <button onClick={() => setActiveMenu('main')} className="group flex items-center self-end mt-4 p-3 rounded-xl hover:bg-white/5 border border-transparent hover:border-white/10 transition-all cursor-none">
                <ChevronLeft className="text-white/50 group-hover:text-cyan-400 transition-colors mr-2" size={20} />
                <span className="tracking-widest font-light text-white/50 group-hover:text-white transition-colors">BACK</span>
              </button>
            </div>

          </div>
        </div>
      </div>
      
      {/* Hidden file input for import */}
      <input 
        type="file" 
        ref={fileInputRef} 
        style={{ display: 'none' }} 
        accept=".vx" 
        onChange={handleFileChange} 
      />
    </div>
  );
}
