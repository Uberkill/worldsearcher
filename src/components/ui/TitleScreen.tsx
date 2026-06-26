// @ts-nocheck
import { useSettingsStore } from '../../stores/useSettingsStore';

import { useState, useEffect, useRef } from 'react';
import {
  PlaySquare,
  Settings,
  Moon,
  Sun,
  ChevronLeft,
  Volume2,
  VolumeX,
  Plus,
  Clock,
  File,
  Trash2,
  Zap,
  Power,
  Download,
  Upload,
  Cloud,
  UploadCloud,
  DownloadCloud,
  Key
} from 'lucide-react';
import * as THREE from 'three';
import { useStore } from '../../stores/useStore';
import { useAudioStore } from '../../stores/useAudioStore';
import { networkActions } from '../../stores/networkActions';
import { useConnectionStore } from '../../stores/connectionSlice';
import { useAuthStore } from '../../stores/useAuthStore';
import { clearSlotDB, exportSlot, importSlot, exportSlotBlob, importSlotBlob } from '../../utils/db';
import { gameAudio } from '../../audio/GameAudio';

const formatPlaytime = (seconds) => {
  if (!seconds) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

// --- REUSABLE UI COMPONENTS ---
const CustomSlider = ({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  suffix = '%',
  dangerThreshold = Infinity,
}) => {
  const percentage = ((value - min) / (max - min)) * 100;
  const isDanger = value >= dangerThreshold;

  const activeTrackColor = isDanger ? 'bg-red-500' : 'bg-white/80';
  const thumbColor = isDanger
    ? 'bg-red-400 shadow-[0_0_8px_#f87171]'
    : 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.4)]';
  const valueColor = isDanger ? 'text-red-300' : 'text-white/80';

  return (
    <div className="flex justify-between items-center text-sm font-medium text-white/50 group w-full">
      <span className="group-hover:text-white transition-colors w-24">
        {label}
      </span>
      <div className="flex-1 mx-4 relative flex items-center h-4">
        <div className="absolute w-full h-[2px] bg-white/10 rounded-full" />
        <div
          className={`absolute h-[2px] ${activeTrackColor} rounded-full`}
          style={{ width: `${percentage}%` }}
        />
        <div
          className={`absolute w-3 h-3 ${thumbColor} rounded-full cursor-none pointer-events-none`}
          style={{ left: `calc(${percentage}% - 6px)` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          className="absolute w-full opacity-0 cursor-none"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
      <span className={`${valueColor} font-mono text-xs w-10 text-right`}>
        {value}
        {suffix}
      </span>
    </div>
  );
};

const LoadingScreen = ({ isActive, type, onComplete }) => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (isActive) {
      const t = setTimeout(() => {
        setProgress(100);
        onComplete();
      }, 0);
      return () => clearTimeout(t);
    }
  }, [isActive, onComplete]);

  return (
    <div
      className={`fixed inset-0 z-[60] backdrop-blur-[40px] bg-black/20 transition-all duration-1000 flex flex-col items-center justify-center ${isActive ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
    >
      <div
        className={`bg-white/5 border border-white/10 rounded-2xl p-8 w-96 flex flex-col items-center shadow-[0_0_50px_rgba(255,255,255,0.04)] transition-all duration-1000 delay-300 ${isActive ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0'}`}
      >
        <h2 className="text-xl font-medium tracking-[0.3em] text-white/80 mb-6 uppercase text-center">
          {type === 'new' ? 'Scanning Biosphere' : 'Restoring Systems'}
        </h2>
        <div className="w-full h-[2px] bg-white/10 rounded-full mb-2 overflow-hidden relative">
          <div
            className="absolute h-full bg-white shadow-[0_0_15px_rgba(255,255,255,0.5)] transition-all duration-100 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between w-full text-[10px] text-white/50 font-mono mb-8 uppercase tracking-widest">
          <span>Loading Chunks...</span>
          <span className="text-white">{Math.floor(progress)}%</span>
        </div>
        <div className="border-t border-white/10 pt-5 w-full text-center">
          <span className="text-[9px] tracking-[0.4em] text-white/50 font-bold block mb-2">
            SYSTEM TIP
          </span>
          <span className="text-xs text-white/60 italic font-medium">
            "If I can be of any use to you, activate me."
          </span>
        </div>
      </div>
    </div>
  );
};

// --- MAIN APP COMPONENT ---

export default function TitleScreen({ onStartNew, onContinue }) {
  const [isNight, setIsNight] = useState(true);
  const [transitionState, setTransitionState] = useState('idle'); // 'idle', 'new', 'continue'
  const [activeMenu, setActiveMenu] = useState('main'); // 'main', 'save_select', 'settings', 'multiplayer', 'multiplayer_host', 'multiplayer_join', 'auth'
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [playerNameInput, setPlayerNameInput] = useState('');
  const [kickReasonError, setKickReasonError] = useState(null);
  const [isMusicOn, setIsMusicOn] = useState(false);
  const audioCtxRef = useRef(null);
  const windGainRef = useRef(null);
  const lastWindAudioTimeRef = useRef(0);

  // Auth States
  const { isAuthenticated, username: authUsername, login, register, recover, uploadSave, downloadSave, isLoading: isAuthLoading, error: authError } = useAuthStore();
  const [authMode, setAuthMode] = useState('login'); // 'login', 'register', 'recover', 'phrase'
  const [authUsernameInput, setAuthUsernameInput] = useState('');
  const [authPasswordInput, setAuthPasswordInput] = useState('');
  const [authRecoveryInput, setAuthRecoveryInput] = useState('');
  const [recoveryPhrase, setRecoveryPhrase] = useState('');
  const [syncTargetSlot, setSyncTargetSlot] = useState(1);
  const [syncMessage, setSyncMessage] = useState(null);

  // Real audio from settings
  const masterVolume = useAudioStore((state) => state.masterVolume);
  const setMasterVolumeStore = useAudioStore((state) => state.setMasterVolume);
  const musicVolume = useAudioStore((state) => state.musicVolume);
  const setMusicVolumeStore = useAudioStore((state) => state.setMusicVolume);

  const audioMaster = Math.round(masterVolume * 100);
  const audioMusic = Math.round(musicVolume * 100);

  const setAudioMaster = (val) => setMasterVolumeStore(val / 100);
  const setAudioMusic = (val) => setMusicVolumeStore(val / 100);

  // Performance from settings
  const renderDistance = useSettingsStore((state) => state.renderDistance);
  const setRenderDistance = useSettingsStore((state) => state.setRenderDistance);
  const shadowQuality = useSettingsStore((state) => state.shadowQuality);
  const setShadowQuality = useSettingsStore((state) => state.setShadowQuality);

  const [mpLogs, setMpLogs] = useState([]);
  useEffect(() => {
    const handleLogUpdate = () => {
      setMpLogs([...(window.DEBUG_MP_LOG || [])]);
    };
    window.addEventListener('mp_log_update', handleLogUpdate);
    return () => window.removeEventListener('mp_log_update', handleLogUpdate);
  }, []);

  const [, setSelectedSlot] = useState(null);
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
            date: parsed.date || 'Unknown',
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
      setSaves((prev) =>
        prev.map((save) => {
          if (save.id === id) {
            return { id, isEmpty: true };
          }
          return save;
        })
      );
    } catch (_err) {
      console.error('Failed to delete save slot:', _err);
      alert('Failed to delete save slot. Check console.');
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
    } catch (_err) {
      alert('Failed to import save file.');
      setTransitionState('idle');
    }
  };

  const handleAuthSubmit = async () => {
    if (authMode === 'login') {
      const success = await login(authUsernameInput, authPasswordInput);
      if (success) {
        setSyncMessage('Logged in successfully.');
        setTimeout(() => setSyncMessage(null), 3000);
      }
    } else if (authMode === 'register') {
      const phrase = await register(authUsernameInput, authPasswordInput);
      if (phrase) {
        setRecoveryPhrase(phrase);
        setAuthMode('phrase');
      }
    } else if (authMode === 'recover') {
      const success = await recover(authUsernameInput, authRecoveryInput, authPasswordInput);
      if (success) {
        setAuthMode('login');
      }
    }
  };

  const handleCloudUpload = async () => {
    setSyncMessage('Generating .vx payload...');
    try {
      const blob = await exportSlotBlob(`slot${syncTargetSlot}`);
      const success = await uploadSave(blob);
      setSyncMessage(success ? 'Upload successful!' : 'Upload failed.');
      setTimeout(() => setSyncMessage(null), 3000);
    } catch (_err) {
      setSyncMessage('Upload error.');
    }
  };

  const handleCloudDownload = async () => {
    setSyncMessage('Downloading cloud save...');
    try {
      const blob = await downloadSave();
      if (blob) {
        const text = await blob.text();
        const exportData = JSON.parse(text);
        await importSlotBlob(`slot${syncTargetSlot}`, exportData);
        setSyncMessage('Download successful!');
        window.location.reload();
      } else {
        setSyncMessage('Download failed.');
        setTimeout(() => setSyncMessage(null), 3000);
      }
    } catch (_err) {
      setSyncMessage('Download error.');
    }
  };

  const { hostGame, joinGame, setPlayerName } = networkActions();
  const connectionStatus = useConnectionStore(state => state.connectionStatus);

  const handleJoin = async () => {
    if (roomCodeInput.length < 6 || !playerNameInput) return;
    gameAudio.resumeContext();
    gameAudio.resumeContext();
    setPlayerName(playerNameInput);
    setKickReasonError(null);
    await clearSlotDB('multiplayer_guest'); // Wipe old stale chunks before joining new game!
    joinGame(roomCodeInput);
  };

  // Auto-transition to 'continue' once connected as Guest
  useEffect(() => {
    if (
      connectionStatus === 'connected' &&
      !useConnectionStore.getState().isHost
    ) {
      // Connected as guest! Boot into game.
      onContinue('multiplayer_guest');
    }
  }, [connectionStatus, onContinue]);

  useEffect(() => {
    const reason = sessionStorage.getItem('kickReason');
    if (reason) {
      setTimeout(() => {
        setKickReasonError(reason);
        setActiveMenu('multiplayer_join');
      }, 0);
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
        let t = audioCtxRef.current.currentTime;
        if (t <= lastWindAudioTimeRef.current)
          t = lastWindAudioTimeRef.current + 0.01;
        lastWindAudioTimeRef.current = t;
        windGainRef.current.gain.cancelScheduledValues(t);
        windGainRef.current.gain.setTargetAtTime(0, t, 1);
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

    if (windGainRef.current && audioCtxRef.current) {
      let t = audioCtxRef.current.currentTime;
      if (t <= lastWindAudioTimeRef.current)
        t = lastWindAudioTimeRef.current + 0.01;
      lastWindAudioTimeRef.current = t;
      windGainRef.current.gain.cancelScheduledValues(t);
      windGainRef.current.gain.setTargetAtTime(masterVolume * 0.5, t, 2);
    }
  }, [isMusicOn, masterVolume]);

  // Teardown AudioContext when TitleScreen unmounts
  useEffect(() => {
    return () => {
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(console.error);
      }
    };
  }, []);

  // Three.js Background Rendering & Memory Management
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
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

    const terrainMat = new THREE.MeshStandardMaterial({
      color: 0x1a2b3c,
      roughness: 0.8,
    });
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
        const height = Math.floor(
          Math.sin(x * 0.2) * 2 + Math.cos(z * 0.2) * 2
        );
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
    const hullMat = new THREE.MeshStandardMaterial({
      color: 0x445566,
      metalness: 0.8,
      roughness: 0.2,
    });
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

      terrainMat.color.lerp(
        new THREE.Color(state.isNight ? '#1a2b3c' : '#73a961'),
        delta * 2
      );
      scene.fog.color.lerp(
        new THREE.Color(state.isNight ? '#0b0c10' : '#87CEEB'),
        delta * 2
      );
      ambientLight.intensity = THREE.MathUtils.lerp(
        ambientLight.intensity,
        state.isNight ? 0.2 : 0.6,
        delta * 2
      );
      dirLight.intensity = THREE.MathUtils.lerp(
        dirLight.intensity,
        state.isNight ? 0.5 : 1.5,
        delta * 2
      );
      dirLight.color.lerp(
        new THREE.Color(state.isNight ? '#6088c6' : '#ffffff'),
        delta * 2
      );
      dirLight.position.lerp(
        new THREE.Vector3(
          state.isNight ? -10 : 10,
          20,
          state.isNight ? -10 : 10
        ),
        delta * 2
      );

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
        } else if (
          state.activeMenu === 'save_select' ||
          state.activeMenu === 'multiplayer_host'
        ) {
          targetY += 4;
          currentLookAt.lerp(new THREE.Vector3(0, 0, -20), delta * 2.5);
        } else if (
          state.activeMenu === 'multiplayer' ||
          state.activeMenu === 'multiplayer_join'
        ) {
          targetX -= 4;
          targetY += 2;
          currentLookAt.lerp(new THREE.Vector3(-10, 0, -10), delta * 2.5);
        } else {
          currentLookAt.lerp(new THREE.Vector3(0, 0, 0), delta * 3);
        }
        camera.position.lerp(
          new THREE.Vector3(targetX, targetY, 15),
          delta * 3
        );
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
      if (container && renderer.domElement)
        container.removeChild(renderer.domElement);
      scene.traverse((object) => {
        if (!object.isMesh) return;
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          Array.isArray(object.material)
            ? object.material.forEach((m) => m.dispose())
            : object.material.dispose();
        }
      });
    };
  }, []);

  const handleAction = (action, slotId, isHost = false) => {
    if (transitionState !== 'idle') return;
    if (isHost && !playerNameInput) return; // Must have name

    gameAudio.resumeContext();
    gameAudio.resumeContext();

    selectedSlotRef.current = slotId; // Sync ref update â€” always readable in handleLoadingComplete
    setSelectedSlot(slotId);
    setTransitionState(action);
    if (isHost) {
      setPlayerName(playerNameInput);
      hostGame();
    }
  };

  const handleLoadingComplete = () => {
    // Use ref (not state) â€” state may still be stale due to React batching
    const slot = selectedSlotRef.current;
    if (transitionState === 'new' && onStartNew) onStartNew(`slot${slot}`);
    if (transitionState === 'continue' && onContinue) onContinue(`slot${slot}`);
  };

  return (
    <div
      className="w-full h-screen relative overflow-hidden font-sans text-white select-none"
      style={{
        backgroundColor: isNight ? '#0b0c10' : '#87CEEB',
        cursor: 'none',
      }}
    >
      {mpLogs.length > 0 && (
        <div className="absolute top-4 left-4 z-50 p-4 bg-black/80 text-green-400 font-mono text-xs rounded-xl border border-green-500/50 max-w-md w-[400px]">
          <h4 className="text-white mb-2 font-bold uppercase tracking-widest border-b border-white/20 pb-1">Connection Log</h4>
          <div className="space-y-1">
            {mpLogs.map((log, i) => (
              <div key={i}>{log}</div>
            ))}
          </div>
        </div>
      )}
      <div
        className="absolute inset-0 transition-opacity duration-1000"
        style={{ opacity: transitionState !== 'idle' ? 0.2 : 1 }}
      >
        <div ref={containerRef} className="w-full h-full outline-none block" />
      </div>

      <LoadingScreen
        isActive={transitionState !== 'idle'}
        type={transitionState}
        onComplete={handleLoadingComplete}
      />

      <div
        className={`absolute inset-0 bg-[#0b0c10]/20 backdrop-blur-[12px] transition-opacity duration-500 pointer-events-none z-10 ${activeMenu === 'save_select' || activeMenu === 'multiplayer' || activeMenu === 'multiplayer_host' || activeMenu === 'multiplayer_join' ? 'opacity-100' : 'opacity-0'}`}
      />

      {/* MULTIPLAYER ROOT MENU */}
      <div
        className={`absolute inset-0 z-30 flex flex-col items-center justify-center transition-all duration-[600ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${activeMenu === 'multiplayer' ? 'opacity-100 pointer-events-auto scale-100' : 'opacity-0 pointer-events-none scale-105'}`}
      >
        {/* Two huge panels for Host and Join */}
        <div className="flex space-x-12">
          <button
            onClick={() => setActiveMenu('multiplayer_host')}
            className="group w-80 h-96 bg-slate-900/40 backdrop-blur-md border border-white/10 rounded-3xl hover:bg-white/5 hover:border-white/30 transition-all flex flex-col items-center justify-center shadow-2xl hover:shadow-[0_0_50px_rgba(255,255,255,0.05)]"
          >
            <Zap
              className="text-white/50 mb-6 group-hover:text-white group-hover:scale-110 transition-all"
              size={64}
            />
            <span className="text-3xl font-medium tracking-widest text-white mb-2">
              HOST
            </span>
            <span className="text-sm font-bold tracking-[0.2em] text-white/50 group-hover:text-white/80 transition-colors">
              CREATE A SERVER
            </span>
          </button>
          <button
            onClick={() => setActiveMenu('multiplayer_join')}
            className="group w-80 h-96 bg-white/5 backdrop-blur-md border border-white/10 rounded-3xl hover:bg-white/10 hover:border-white/30 transition-all flex flex-col items-center justify-center shadow-2xl"
          >
            <PlaySquare
              className="text-white/50 group-hover:text-white mb-6 group-hover:scale-110 transition-transform"
              size={64}
            />
            <span className="text-3xl font-medium tracking-widest text-white mb-2">
              JOIN
            </span>
            <span className="text-sm font-bold tracking-[0.2em] text-white/50 group-hover:text-white/80">
              CONNECT TO A FRIEND
            </span>
          </button>
        </div>
        <button
          onClick={() => setActiveMenu('main')}
          className="group flex items-center mt-12 p-4 rounded-xl hover:bg-white/5 border border-transparent hover:border-white/10 transition-all cursor-none"
        >
          <ChevronLeft
            className="text-white/50 group-hover:text-white transition-colors mr-2"
            size={20}
          />
          <span className="tracking-widest font-medium text-white/50 group-hover:text-white transition-colors">
            BACK TO MENU
          </span>
        </button>
      </div>

      {/* MULTIPLAYER JOIN MENU */}
      <div
        className={`absolute inset-0 z-30 flex flex-col items-center justify-center transition-all duration-[600ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${activeMenu === 'multiplayer_join' ? 'opacity-100 pointer-events-auto scale-100' : 'opacity-0 pointer-events-none scale-105'}`}
      >
        <div className="bg-slate-900/60 backdrop-blur-md border border-white/10 p-12 rounded-3xl flex flex-col items-center shadow-[0_0_80px_rgba(0,0,0,0.8)] w-[500px]">
          <h2 className="text-3xl font-medium tracking-widest text-white mb-8">
            JOIN SERVER
          </h2>

          <div className="w-full flex flex-col space-y-6">
            <div className="flex flex-col">
              <label className="text-[10px] text-white/50 tracking-[0.2em] font-bold mb-2">
                PLAYER NAME
              </label>
              <input
                type="text"
                maxLength={16}
                value={playerNameInput}
                onChange={(e) =>
                  setPlayerNameInput(
                    e.target.value.replace(/[^a-zA-Z0-9_ ]/g, '')
                  )
                }
                className="bg-black/60 border border-white/10 rounded-lg p-4 text-center tracking-[0.2em] text-white outline-none focus:border-white/20"
                placeholder="ENTER NAME"
              />
            </div>

            <div className="flex flex-col">
              <label className="text-[10px] text-white/50 tracking-[0.2em] font-bold mb-2">
                ROOM CODE
              </label>
              <input
                type="text"
                maxLength={6}
                value={roomCodeInput}
                onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                className="bg-black/60 border border-white/10 rounded-lg p-4 text-center tracking-[0.4em] text-white outline-none focus:border-white/20 uppercase"
                placeholder="6-DIGIT CODE"
              />
            </div>
          </div>

          {kickReasonError && connectionStatus !== 'connecting' && (
            <div className="mt-6 text-red-400 text-xs tracking-widest font-bold text-center max-w-sm">
              {kickReasonError}
            </div>
          )}
          {connectionStatus === 'disconnected' &&
            networkActions.getState().peer &&
            !kickReasonError && (
              <div className="mt-6 text-red-400 text-xs tracking-widest font-bold">
                CONNECTION FAILED
              </div>
            )}
          {connectionStatus === 'connecting' && (
            <div className="mt-6 text-white text-xs tracking-widest font-bold animate-pulse">
              CONNECTING...
            </div>
          )}

          <button
            onClick={handleJoin}
            disabled={
              roomCodeInput.length < 6 ||
              !playerNameInput ||
              connectionStatus === 'connecting'
            }
            className="mt-10 w-full py-4 bg-white/10 text-white border border-white/30 rounded-xl hover:bg-white/20 transition-all tracking-widest font-bold text-lg disabled:opacity-30 disabled:pointer-events-none"
          >
            CONNECT
          </button>
        </div>
        <button
          onClick={() => setActiveMenu('multiplayer')}
          className="group flex items-center mt-8 p-4 rounded-xl hover:bg-white/5 border border-transparent hover:border-white/10 transition-all cursor-none"
        >
          <ChevronLeft
            className="text-white/50 group-hover:text-white transition-colors mr-2"
            size={20}
          />
          <span className="tracking-widest font-medium text-white/50 group-hover:text-white transition-colors">
            BACK TO MULTIPLAYER
          </span>
        </button>
      </div>

      {/* SAVE SELECTION (SINGLE PLAYER & HOST) */}
      <div
        className={`absolute inset-0 z-30 flex flex-col items-center justify-center transition-all duration-[600ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${activeMenu === 'save_select' || activeMenu === 'multiplayer_host' ? 'opacity-100 pointer-events-auto scale-100' : 'opacity-0 pointer-events-none scale-105'}`}
      >
        <div className="w-full max-w-5xl px-8">
          <div className="flex justify-between items-end mb-12">
            <div>
              <h2
                className={`text-4xl font-medium tracking-[0.2em] mb-2 transition-colors duration-700 ${isNight ? 'text-white' : 'text-[#0b0c10]'}`}
              >
                WORLD{' '}
                <span
                  className={`font-bold transition-colors duration-700 ${isNight ? 'text-white' : 'text-slate-800'}`}
                >
                  SEARCHER
                </span>
              </h2>
              <p
                className={`tracking-widest text-sm font-medium uppercase transition-colors duration-700 ${isNight ? 'text-white/50' : 'text-[#0b0c10]/70'}`}
              >
                {activeMenu === 'multiplayer_host'
                  ? 'Enter a Host Name and select a Save Slot to Host.'
                  : 'Select a Save Slot to initialize your visor.'}
              </p>
            </div>
            <div className="flex items-end space-x-8">
              {activeMenu === 'multiplayer_host' && (
                <div className="flex flex-col items-end mr-8">
                  <span className="text-[10px] text-white tracking-[0.2em] font-bold mb-2">
                    YOUR HOST NAME
                  </span>
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      maxLength={16}
                      value={playerNameInput}
                      onChange={(e) =>
                        setPlayerNameInput(
                          e.target.value.replace(/[^a-zA-Z0-9_ ]/g, '')
                        )
                      }
                      className="bg-black/40 border border-white/10 rounded-lg p-2 w-48 text-center tracking-[0.2em] text-white outline-none focus:border-white/50"
                      placeholder="ENTER NAME"
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-col items-end">
                <span className="text-[10px] text-white/50 tracking-[0.2em] font-bold mb-2 flex items-center">
                  <Zap size={12} className="mr-1.5 text-white" /> ENGINE
                  PERFORMANCE
                </span>
                <div className="flex bg-black/40 border border-white/10 rounded-lg p-1 backdrop-blur-md">
                  <button
                    onClick={() => setRenderDistance(4)}
                    className={`px-4 py-1.5 text-xs font-bold tracking-widest rounded-md transition-all ${renderDistance <= 4 ? 'bg-white/10 text-white border border-white/30' : 'text-white/40 hover:text-white/80 border border-transparent hover:bg-white/5'}`}
                  >
                    LOW
                  </button>
                  <button
                    onClick={() => setRenderDistance(8)}
                    className={`px-4 py-1.5 text-xs font-bold tracking-widest rounded-md transition-all ${renderDistance === 8 ? 'bg-white/10 text-white border border-white/30' : 'text-white/40 hover:text-white/80 border border-transparent hover:bg-white/5'}`}
                  >
                    NORMAL
                  </button>
                  <button
                    onClick={() => setRenderDistance(12)}
                    className={`px-4 py-1.5 text-xs font-bold tracking-widest rounded-md transition-all ${renderDistance >= 12 ? 'bg-white/10 text-white border border-white/30' : 'text-white/40 hover:text-white/80 border border-transparent hover:bg-white/5'}`}
                  >
                    FAR
                  </button>
                </div>
              </div>
              <button
                onClick={() =>
                  setActiveMenu(
                    activeMenu === 'multiplayer_host' ? 'multiplayer' : 'main'
                  )
                }
                className="group flex items-center p-4 rounded-xl hover:bg-white/5 border border-transparent hover:border-white/10 transition-all cursor-none mb-0"
              >
                <ChevronLeft
                  className="text-white/50 group-hover:text-white transition-colors mr-2"
                  size={20}
                />
                <span className="tracking-widest font-medium text-white/50 group-hover:text-white transition-colors">
                  BACK
                </span>
              </button>
            </div>
          </div>
          
          {/* CLOUD SYNC HEADER */}
          {activeMenu === 'save_select' && (
            <div className="flex justify-end mb-4">
              <button
                onClick={() => setActiveMenu('auth')}
                className="group flex items-center p-3 rounded-xl bg-white/5 backdrop-blur-md border border-white/10 hover:border-white/30 hover:bg-white/10 transition-all shadow-sm"
              >
                <Cloud className="text-white mr-2 group-hover:scale-110 transition-transform" size={20} />
                <span className="text-sm font-bold tracking-[0.2em] text-white/80">
                  {isAuthenticated ? 'CLOUD SYNC MANAGER' : 'LOGIN TO CLOUD'}
                </span>
              </button>
            </div>
          )}

          <div className="grid grid-cols-3 gap-6">
            {saves.map((save) => (
              <div
                key={save.id}
                onClick={() =>
                  handleAction(
                    save.isEmpty ? 'new' : 'continue',
                    save.id,
                    activeMenu === 'multiplayer_host'
                  )
                }
                className={`group relative overflow-hidden rounded-2xl border transition-all duration-300 text-left cursor-pointer h-64 p-6 flex flex-col justify-between
                  ${save.isEmpty ? 'bg-black/20 border-white/5 hover:border-white/20 hover:bg-white/5 items-center justify-center text-center border-dashed' : 'bg-white/5 border-white/10 hover:border-white/40 hover:bg-white/10 hover:shadow-md backdrop-blur-md'}
                  ${activeMenu === 'multiplayer_host' && !playerNameInput ? 'opacity-50 pointer-events-none grayscale' : ''}
                `}
              >
                <div className="absolute inset-0 bg-gradient-to-b from-white/0 to-white/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

                {!save.isEmpty && (
                  <div className="absolute top-4 right-4 z-20 flex space-x-2 opacity-0 group-hover:opacity-100 transition-all">
                    <button
                      onClick={(e) => handleExportSave(e, save.id)}
                      className="p-2 bg-white/5 hover:bg-white/20 text-white/50 hover:text-white border border-white/10 rounded-lg transition-all"
                      title="Export .vx file"
                    >
                      <Download size={16} />
                    </button>
                    <button
                      onClick={(e) => handleDeleteSave(e, save.id)}
                      className="p-2 bg-white/5 hover:bg-red-500/30 text-white/50 hover:text-red-400 border border-white/10 hover:border-red-500/30 rounded-lg transition-all"
                      title="Delete Save"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}

                {save.isEmpty ? (
                  <>
                    <button
                      onClick={(e) => handleImportClick(e, save.id)}
                      className="absolute top-4 right-4 z-20 p-2 bg-white/5 hover:bg-white/20 text-white/50 hover:text-white border border-white/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                      title="Import .vx file"
                    >
                      <Upload size={16} />
                    </button>
                    <Plus
                      className="text-white/20 group-hover:text-white mb-4 transition-colors pointer-events-none"
                      size={48}
                    />
                    <span className="text-sm font-bold tracking-[0.2em] text-white/50 group-hover:text-white transition-colors pointer-events-none">
                      NEW JOURNEY
                    </span>
                    <span className="text-[10px] text-white/30 tracking-widest mt-2 uppercase pointer-events-none">
                      Empty Slot {save.id}
                    </span>
                  </>
                ) : (
                  <>
                    <div className="pointer-events-none">
                      <div className="flex justify-between items-start mb-4">
                        <span className="px-3 py-1 bg-black/40 rounded-full border border-white/10 text-[10px] font-mono text-white/90 tracking-widest uppercase">
                          Slot {save.id}
                        </span>
                        <File
                          className="text-white/20 transition-all duration-300 group-hover:opacity-0 group-hover:scale-75"
                          size={20}
                        />
                      </div>
                      <h3 className="text-2xl font-medium tracking-wider text-white group-hover:text-white/80 transition-colors">
                        {save.name}
                      </h3>
                      <span className="text-xs text-white/50 font-bold tracking-[0.2em] uppercase block mt-1">
                        {save.mode} Mode
                      </span>
                    </div>
                    <div className="border-t border-white/10 pt-4 flex justify-between items-end pointer-events-none">
                      <div>
                        <span className="flex items-center text-[10px] text-white/40 font-mono mb-1">
                          <Clock size={12} className="mr-1.5" /> PLAYTIME
                        </span>
                        <span className="text-sm text-white/70 font-mono">
                          {save.played}
                        </span>
                      </div>
                      <span className="text-[10px] text-white/30 font-mono">
                        {save.date}
                      </span>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* TITLE MENU Container */}
      <div
        className={`absolute inset-0 w-full p-16 flex flex-col justify-between transition-opacity duration-700 z-20 ${transitionState !== 'idle' ? 'opacity-0 pointer-events-none' : 'opacity-100'} ${activeMenu !== 'main' && activeMenu !== 'settings' ? 'opacity-0 pointer-events-none' : ''}`}
      >
        <div
          className={`flex items-center space-x-8 transition-all duration-700 ${isNight ? 'drop-shadow-2xl' : 'drop-shadow-[0_20px_60px_rgba(0,0,0,0.4)]'}`}
        >
          <div
            className={`w-24 h-24 border-[4px] rounded-xl flex items-center justify-center transition-colors duration-700 ${isNight ? 'border-white/50' : 'border-white/10'}`}
          >
            <div
              className={`w-10 h-10 rotate-45 transition-all duration-700 ${isNight ? 'bg-white shadow-[0_0_20px_#fff]' : 'bg-[#0b0c10] shadow-[0_0_40px_rgba(0,0,0,0.6)]'}`}
            />
          </div>
          <div className="transition-colors duration-700">
            <h1
              className={`text-7xl font-medium tracking-[0.3em] mb-2 transition-colors duration-700 ${isNight ? 'text-white' : 'text-[#0b0c10]'}`}
            >
              WORLD
            </h1>
            <h2
              className={`text-2xl font-bold tracking-[0.5em] transition-colors duration-700 ${isNight ? 'text-white/90' : 'text-slate-800'}`}
            >
              SEARCHER
            </h2>
          </div>
        </div>

        <div className="flex justify-between items-end w-full relative h-full">
          <div className="text-white/30 text-[10px] tracking-[0.3em] font-medium hidden md:block">
            v0.8.4 // ATMOSPHERIC SCANNERS ACTIVE
          </div>

          <div className="relative flex justify-end items-end h-full">
            {/* TITLE MENU MAIN LINKS */}
            <div
              className={`flex flex-col items-end space-y-4 transition-all duration-[600ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${activeMenu === 'main' ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-12 pointer-events-none absolute right-0 bottom-0'}`}
            >
              <div className="flex space-x-4 mb-8">
                <button
                  onClick={() => setIsMusicOn(!isMusicOn)}
                  className="p-3 rounded-full bg-white/5 backdrop-blur-md border border-white/10 hover:bg-white/20 transition-all text-white/80 hover:text-white"
                >
                  {isMusicOn ? <Volume2 size={20} /> : <VolumeX size={20} />}
                </button>
                <button
                  onClick={() => setIsNight(!isNight)}
                  className="p-3 rounded-full bg-white/5 backdrop-blur-md border border-white/10 hover:bg-white/20 transition-all text-white/80 hover:text-white"
                >
                  {isNight ? <Sun size={20} /> : <Moon size={20} />}
                </button>
              </div>
              <button
                onClick={() => setActiveMenu('save_select')}
                className="group relative flex items-center justify-end w-64 p-4 rounded-xl bg-white/10 backdrop-blur-xl border border-white/20 hover:border-white/30/50 hover:bg-white/20 transition-all duration-300"
              >
                <span className="text-lg font-medium tracking-widest mr-4 group-hover:text-white transition-colors">
                  SOLO PLAY
                </span>
                <PlaySquare className="text-white" size={24} />
              </button>

              <button
                onClick={() => setActiveMenu('multiplayer')}
                className="group relative flex items-center justify-end w-64 p-4 rounded-xl bg-black/40 backdrop-blur-xl border border-white/10 hover:border-white/30 hover:bg-white/10 transition-all duration-300"
              >
                <span className="text-lg font-medium tracking-widest mr-4 text-white group-hover:text-white/80 transition-colors">
                  MULTIPLAYER
                </span>
                <Zap className="text-white" size={24} />
              </button>

              <button
                onClick={() => setActiveMenu('settings')}
                className="group relative flex items-center justify-end w-64 p-4 rounded-xl bg-slate-900/40 backdrop-blur-md border border-white/10 hover:border-white/40 hover:bg-white/15 transition-all duration-300"
              >
                <span className="text-lg font-medium tracking-widest mr-4 group-hover:text-white transition-colors">
                  TITLE SETTINGS
                </span>
                <Settings
                  className="text-white/70 group-hover:text-white"
                  size={24}
                />
              </button>

              <button
                onClick={() => window.close()}
                className="group relative flex items-center justify-end w-64 p-4 rounded-xl bg-slate-900/40 backdrop-blur-md border border-white/10 hover:border-red-400/50 hover:bg-red-900/20 transition-all duration-300"
              >
                <span className="text-lg font-medium tracking-widest mr-4 text-red-200 group-hover:text-red-100 transition-colors">
                  QUIT TO DESKTOP
                </span>
                <Power
                  className="text-red-400/70 group-hover:text-red-400"
                  size={24}
                />
              </button>
            </div>

            {/* TITLE SETTINGS MENU */}
            <div
              className={`absolute bottom-0 right-0 w-80 flex flex-col transition-all duration-[600ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${activeMenu === 'settings' ? 'opacity-100 translate-x-0 pointer-events-auto delay-100' : 'opacity-0 translate-x-12 pointer-events-none'}`}
            >
              <div className="bg-slate-900/60 backdrop-blur-md border border-white/10 rounded-2xl p-6 shadow-2xl space-y-8">
                <div className="flex items-center justify-between border-b border-white/10 pb-4">
                  <h3 className="text-xl font-medium tracking-widest text-white">
                    SETTINGS
                  </h3>
                  <Settings className="text-white/50" size={20} />
                </div>
                <div className="space-y-8">
                  <div className="space-y-4">
                    <div className="flex items-center space-x-2 text-white/70">
                      <Volume2 size={16} />
                      <span className="text-sm tracking-widest font-bold">
                        AUDIO
                      </span>
                    </div>
                    <CustomSlider
                      label="MASTER"
                      value={audioMaster}
                      onChange={setAudioMaster}
                    />
                    <CustomSlider
                      label="MUSIC"
                      value={audioMusic}
                      onChange={setAudioMusic}
                    />
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-center space-x-2 text-white/70">
                      <Zap size={16} />
                      <span className="text-sm tracking-widest font-bold">
                        GRAPHICS
                      </span>
                    </div>
                    <CustomSlider
                      label="RENDER DIST."
                      value={renderDistance}
                      onChange={setRenderDistance}
                      min={4}
                      max={16}
                      suffix=" ch"
                      dangerThreshold={16}
                    />
                    <div className="flex justify-between items-center text-sm font-medium text-white/50 w-full">
                      <span className="w-24">SHADOWS</span>
                      <div className="flex bg-black/40 border border-white/10 rounded-lg p-1">
                        <button
                          onClick={() => setShadowQuality('performance')}
                          className={`px-4 py-1 text-xs font-bold tracking-widest rounded-md transition-all ${shadowQuality === 'performance' ? 'bg-white/10 text-white border border-white/30' : 'text-white/40 hover:text-white border border-transparent hover:bg-white/5'}`}
                        >
                          PERF.
                        </button>
                        <button
                          onClick={() => setShadowQuality('visual')}
                          className={`px-4 py-1 text-xs font-bold tracking-widest rounded-md transition-all ${shadowQuality === 'visual' ? 'bg-white/10 text-white border border-white/30' : 'text-white/40 hover:text-white border border-transparent hover:bg-white/5'}`}
                        >
                          VISUAL
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setActiveMenu('main')}
                className="group flex items-center self-end mt-4 p-3 rounded-xl hover:bg-white/5 border border-transparent hover:border-white/10 transition-all cursor-none"
              >
                <ChevronLeft
                  className="text-white/50 group-hover:text-white transition-colors mr-2"
                  size={20}
                />
                <span className="tracking-widest font-medium text-white/50 group-hover:text-white transition-colors">
                  BACK
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* AUTHENTICATION & SYNC UI Overlay */}
      <div
        className={`absolute inset-0 z-50 flex items-center justify-center transition-all duration-[600ms] ${activeMenu === 'auth' ? 'opacity-100 pointer-events-auto backdrop-blur-xl bg-black/60' : 'opacity-0 pointer-events-none'}`}
      >
        <div className="bg-black/40 border border-white/10 p-12 rounded-3xl flex flex-col items-center shadow-[0_0_80px_rgba(0,0,0,0.8)] w-[550px] relative overflow-hidden">
          {isAuthenticated ? (
            /* SYNC MANAGER */
            <div className="w-full flex flex-col items-center">
              <Cloud className="text-white mb-4" size={48} />
              <h2 className="text-2xl font-medium tracking-widest text-white mb-2">CLOUD MANAGER</h2>
              <span className="text-xs font-bold tracking-[0.2em] text-white/80 mb-8 uppercase">LOGGED IN AS {authUsername}</span>
              
              <div className="w-full bg-black/60 border border-white/10 rounded-xl p-6 mb-8 flex flex-col items-center">
                <span className="text-xs font-bold tracking-[0.2em] text-white/50 mb-4">TARGET SLOT</span>
                <div className="flex space-x-4 mb-8">
                  {[1, 2, 3].map(slot => (
                    <button
                      key={slot}
                      onClick={() => setSyncTargetSlot(slot)}
                      className={`w-16 h-16 rounded-lg font-mono text-xl border transition-all ${syncTargetSlot === slot ? 'bg-white/20 border-white/50 text-white shadow-md' : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10'}`}
                    >
                      {slot}
                    </button>
                  ))}
                </div>

                <div className="flex space-x-4">
                  <button onClick={handleCloudUpload} disabled={isAuthLoading} className="flex-1 flex flex-col items-center p-4 rounded-xl bg-white/5 border border-white/10 hover:border-white/30 hover:bg-white/10 transition-all disabled:opacity-50">
                    <UploadCloud className="text-white mb-2" size={24} />
                    <span className="text-sm tracking-widest font-bold text-white/80">UPLOAD</span>
                  </button>
                  <button onClick={handleCloudDownload} disabled={isAuthLoading} className="flex-1 flex flex-col items-center p-4 rounded-xl bg-white/5 border border-white/10 hover:border-white/30 hover:bg-white/10 transition-all disabled:opacity-50">
                    <DownloadCloud className="text-white/70 mb-2" size={24} />
                    <span className="text-sm tracking-widest font-bold text-white/80">DOWNLOAD</span>
                  </button>
                </div>
              </div>

              {syncMessage && <span className="text-white/90 font-mono text-xs tracking-widest mb-4">{syncMessage}</span>}

              <div className="flex justify-between w-full mt-4">
                <button onClick={() => setActiveMenu('save_select')} className="text-xs tracking-widest text-white/50 hover:text-white transition-colors">BACK</button>
                <button onClick={() => useAuthStore.getState().logout()} className="text-xs tracking-widest text-red-400/50 hover:text-red-400 transition-colors">LOG OUT</button>
              </div>
            </div>
          ) : (
            /* AUTH FORMS */
            <div className="w-full flex flex-col items-center">
              {authMode === 'phrase' ? (
                /* RECOVERY PHRASE DISPLAY */
                <>
                  <Key className="text-yellow-400 mb-4" size={48} />
                  <h2 className="text-2xl font-medium tracking-widest text-white mb-2 text-center">RECOVERY PHRASE</h2>
                  <p className="text-xs text-white/50 tracking-widest text-center mb-6 max-w-xs">SAVE THIS 16-CHARACTER CODE. IT IS THE ONLY WAY TO RECOVER YOUR ACCOUNT IF YOU FORGET YOUR PASSWORD.</p>
                  
                  <div className="bg-black/60 border border-yellow-500/30 p-6 rounded-xl w-full text-center mb-8">
                    <span className="font-mono text-xl text-yellow-300 tracking-[0.3em]">{recoveryPhrase}</span>
                  </div>

                  <div className="mt-8 text-center">
                  <button onClick={() => setAuthMode('login')} className="w-full py-4 bg-white/10 text-white border border-white/30 rounded-xl hover:bg-white/20 transition-all tracking-widest font-bold">
                    SIGN IN TO ACCOUNT
                  </button>
                  </div>
                </>
              ) : (
                <>
                  <Cloud className="text-white mb-6" size={48} />
                  <h2 className="text-2xl font-medium tracking-widest text-white mb-8 uppercase">
                    {authMode === 'login' ? 'CLOUD LOGIN' : authMode === 'register' ? 'CREATE ACCOUNT' : 'RECOVER ACCOUNT'}
                  </h2>

                  <div className="w-full space-y-4 mb-8">
                    <input
                      type="text"
                      placeholder="USERNAME"
                      value={authUsernameInput}
                      onChange={(e) => setAuthUsernameInput(e.target.value)}
                      className="w-full bg-black/60 border border-white/10 rounded-lg p-4 text-center tracking-[0.2em] text-white outline-none focus:border-white/20 uppercase"
                    />

                    {authMode === 'recover' ? (
                      <>
                        <input
                          type="text"
                          placeholder="16-CHAR RECOVERY CODE"
                          value={authRecoveryInput}
                          onChange={(e) => setAuthRecoveryInput(e.target.value.toUpperCase())}
                          className="w-full bg-black/60 border border-yellow-500/30 rounded-lg p-4 text-center tracking-[0.2em] text-yellow-300 outline-none focus:border-yellow-400/50 uppercase font-mono"
                        />
                        <input
                          type="password"
                          placeholder="NEW PASSWORD"
                          value={authPasswordInput}
                          onChange={(e) => setAuthPasswordInput(e.target.value)}
                          className="w-full bg-black/60 border border-white/10 rounded-lg p-4 text-center tracking-[0.4em] text-white outline-none focus:border-white/20"
                        />
                      </>
                    ) : (
                      <input
                        type="password"
                        placeholder="PASSWORD"
                        value={authPasswordInput}
                        onChange={(e) => setAuthPasswordInput(e.target.value)}
                        className="w-full bg-black/60 border border-white/10 rounded-lg p-4 text-center tracking-[0.4em] text-white outline-none focus:border-white/20"
                      />
                    )}
                  </div>

                  {authError && <span className="text-red-400 text-xs tracking-widest font-bold mb-4">{authError}</span>}
                  {syncMessage && <span className="text-white/90 font-mono text-xs tracking-widest mb-4">{syncMessage}</span>}

                  <button
                    type="submit" disabled={isAuthLoading}
                    onClick={handleAuthSubmit}
                    className="w-full py-4 bg-white/10 text-white border border-white/30 rounded-xl hover:bg-white/20 transition-all tracking-widest font-bold mb-4 disabled:opacity-30"
                  >
                    {isAuthLoading ? 'CONNECTING...' : authMode === 'login' ? 'LOGIN' : authMode === 'register' ? 'REGISTER' : 'RESET PASSWORD'}
                  </button>

                  <div className="flex justify-between w-full mt-4 text-[10px] tracking-widest font-bold">
                    <button onClick={() => setActiveMenu('save_select')} className="text-white/30 hover:text-white transition-colors">CANCEL</button>
                    {authMode === 'login' && (
                      <div className="flex space-x-4">
                        <button onClick={() => setAuthMode('recover')} className="text-white/30 hover:text-white transition-colors">FORGOT?</button>
                        <button onClick={() => setAuthMode('register')} className="text-white/50 hover:text-white transition-colors">CREATE ACCOUNT</button>
                      </div>
                    )}
                    {authMode === 'register' && <button onClick={() => setAuthMode('login')} className="text-white/50 hover:text-white transition-colors">ALREADY HAVE ACCOUNT?</button>}
                    {authMode === 'recover' && <button onClick={() => setAuthMode('login')} className="text-white/50 hover:text-white transition-colors">BACK TO LOGIN</button>}
                  </div>
                </>
              )}
            </div>
          )}
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

