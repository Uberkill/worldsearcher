import { audioManager } from "../../utils/AudioManager";

﻿import { useState, useEffect, useCallback, useRef } from 'react';
import { Settings, Power, X, AlertTriangle, Download, Upload, Volume2, Play, Heart, Sun, Moon, Music, Square } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../../stores/useStore';
import { useNetworkStore } from '../../stores/useNetworkStore';
import { clearDB, flushWAL, setSkipAutoSave } from '../../utils/db';
import { GlobalRegistry } from '../../registry/Registry';
import { playerPosition, playerRotation } from '../../globals';
import { InventoryOverlay } from './InventoryOverlay';
import { ChestOverlay } from './ChestOverlay';
import { ShopOverlay } from './ShopOverlay';
import { ChatFeed } from './ChatFeed';
import { Scoreboard } from './Scoreboard';

import { sfxManager } from '../../utils/SFXManager';
import { MusicPlayerWidget } from './MusicPlayerWidget';

// Reusable Key UI
const KeyUI = ({ children }) => (
  <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded bg-black/40 border border-white/10 shadow-[inset_0_-2px_0_rgba(255,255,255,0.05)] text-white/70 font-mono text-[10px] uppercase font-bold tracking-wider mr-1">
    {children}
  </span>
);

const CustomSlider = ({ label, value, onChange, min = 0, max = 100, suffix = "%" }) => {
  const percentage = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex justify-between items-center text-sm font-light text-white/50 group w-full">
      <span className="group-hover:text-white transition-colors w-24">{label}</span>
      <div className="flex-1 mx-4 relative flex items-center h-4">
        <div className="absolute w-full h-[2px] bg-white/10 rounded-full" />
        <div className="absolute h-[2px] bg-cyan-400 rounded-full" style={{ width: `${percentage}%` }} />
        <div className="absolute w-3 h-3 bg-cyan-300 rounded-full shadow-[0_0_8px_#22d3ee] pointer-events-none" style={{ left: `calc(${percentage}% - 6px)` }} />
        <input type="range" min={min} max={max} className="absolute w-full opacity-0 cursor-pointer" value={value} onChange={(e) => onChange(Number(e.target.value))} />
      </div>
      <span className="text-cyan-200 font-mono text-xs w-10 text-right">{value}{suffix}</span>
    </div>
  );
};

const GameModeCard = ({ title, desc, isActive, onClick }) => (
  <button 
    onClick={onClick}
    className={`flex flex-col items-center p-4 rounded-xl border transition-all duration-300 cursor-pointer flex-1
      ${isActive ? 'bg-cyan-900/30 border-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.15)]' : 'bg-black/20 border-white/5 hover:border-white/20 hover:bg-white/5'}
    `}
  >
    <span className={`text-sm font-bold tracking-widest mb-2 ${isActive ? 'text-cyan-300' : 'text-white/70'}`}>{title}</span>
    <span className="text-[10px] text-white/40 leading-relaxed text-center font-light">{desc}</span>
  </button>
);

const PickupFeedItem = ({ item, onRemove }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onRemove(item.id);
    }, 3000);
    return () => clearTimeout(timer);
  }, [item.id, item.count, onRemove]); // Reset timer if count updates!

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.5 } }}
      className="flex items-center space-x-3 bg-black/80 backdrop-blur-xl border border-white/20 px-5 py-3 rounded-lg mb-2 shadow-2xl"
    >
      <div 
        className="w-6 h-6 rounded-sm shadow-[inset_0_2px_4px_rgba(255,255,255,0.3)] border border-black/20" 
        style={{ backgroundColor: GlobalRegistry[item.texture]?.color || '#fff' }}
      />
      <motion.span 
        key={item.count} // force re-render pop
        initial={{ scale: 1.5, color: '#22d3ee' }}
        animate={{ scale: 1, color: '#ffffff' }}
        className="text-white font-mono text-base font-bold drop-shadow-md"
      >
        +{item.count}
      </motion.span>
    </motion.div>
  );
};

export default function InGameUI() {
  const menuOpen = useStore(state => state.isMenuOpen);
  const inventoryOpen = useStore(state => state.isInventoryOpen);
  const settingsOpen = useStore(state => state.isSettingsOpen);
  const shopOpen = useStore(state => state.isShopOpen);
    
  const toggleMenu = useStore(state => state.toggleMenu);
  const toggleInventory = useStore(state => state.toggleInventory);
  const toggleShop = useStore(state => state.toggleShop);
  const saveWorld = useStore(state => state.saveWorld);
  const savePlayerState = useStore(state => state.savePlayerState);
  
  // Settings use open/close in slice
  const openSettings = useStore(state => state.openSettings);
  const closeSettings = useStore(state => state.closeSettings);
  
  const setSettingsOpen = useCallback((val) => val ? openSettings() : closeSettings(), [openSettings, closeSettings]);

  const inventory = useStore(state => state.inventory);
  
  // HUD variables
  const playerHealth = useStore(state => state.playerHealth);
  const playerMaxHealth = useStore(state => state.playerMaxHealth);
  const pickupFeed = useStore(state => state.pickupFeed);
  const removePickupFeedItem = useStore(state => state.removePickupFeedItem);
  const worldTime = useStore(state => state.worldTime);
  const isNightTime = useStore(state => state.isNightTime);
  const hotbarSize = 9; // Hardcoded in standard
  const hotbarItems = inventory.slice(0, hotbarSize);
  const mainInventoryItems = inventory.slice(hotbarSize);

  // Pad the arrays so the UI grid always looks full
  const paddedMain = [...mainInventoryItems];
  while (paddedMain.length < 27) paddedMain.push(null);
  const paddedHotbar = [...hotbarItems];
  while (paddedHotbar.length < 9) paddedHotbar.push(null);

  const renderDistance = useStore(state => state.renderDistance);
  const setRenderDistance = useStore(state => state.setRenderDistance);
  const shadowQuality = useStore(state => state.shadowQuality);
  const setShadowQuality = useStore(state => state.setShadowQuality);

  // Local state for transitions within the InGameUI (like deleting world)
  const [internalMenu, setInternalMenu] = useState(null); 
  const [toastMessage, setToastMessage] = useState(null);
  const toastTimeoutRef = useRef(null);
  const [quotaError, setQuotaError] = useState(false);
  const [showScoreboard, setShowScoreboard] = useState(false);
  
  useEffect(() => {
    const handleQuota = () => {
      setQuotaError(true);
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
    };
    window.addEventListener('storage_quota_exceeded', handleQuota);
    return () => window.removeEventListener('storage_quota_exceeded', handleQuota);
  }, []);

  // Real game mode from settings
  const gameMode = useStore(state => state.gameMode);
  const setGameMode = useStore(state => state.setGameMode);

  // Real audio from settings
  const masterVolume = useStore(state => state.masterVolume);
  const setMasterVolumeStore = useStore(state => state.setMasterVolume);
  const sfxVolume = useStore(state => state.sfxVolume);
  const setSfxVolumeStore = useStore(state => state.setSfxVolume);
  const musicVolume = useStore(state => state.musicVolume);
  const setMusicVolumeStore = useStore(state => state.setMusicVolume);

  // Convert 0.0-1.0 to 0-100 for sliders
  const audioMaster = Math.round(masterVolume * 100);
  const audioSfx = Math.round(sfxVolume * 100);
  const audioMusic = Math.round(musicVolume * 100);

  const setAudioMaster = (val) => setMasterVolumeStore(val / 100);
  const setAudioSfx = (val) => setSfxVolumeStore(val / 100);
  const setAudioMusic = (val) => setMusicVolumeStore(val / 100);

  // Network State
  const roomCode = useNetworkStore(state => state.roomCode);
  const isHost = useNetworkStore(state => state.isHost);
  const connectionStatus = useNetworkStore(state => state.connectionStatus);
  const isGuest = connectionStatus === 'connected' && !isHost;
  const players = useNetworkStore(state => state.players);
  const playerCount = Object.keys(players).length + 1;
  const isTyping = useNetworkStore(state => state.isTyping);
  const setTyping = useNetworkStore(state => state.setTyping);

  // KEYBOARD HANDLER
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (internalMenu) return; 

      if (isTyping) {
         if (e.key === 'Escape') {
            setTyping(false);
         }
         return; // Don't process other game keys while typing
      }

      if (e.key === 'Enter' || e.key.toLowerCase() === 't') {
         if (!menuOpen && !settingsOpen && !shopOpen && !inventoryOpen) {
            e.preventDefault();
            setTyping(true);
            return;
         }
      }

      if (e.key === 'Tab') {
         if (!menuOpen && !settingsOpen && !shopOpen && !inventoryOpen) {
            e.preventDefault();
            setShowScoreboard(true);
            return;
         }
      }

      if (e.key === 'Escape') {
        if (inventoryOpen) toggleInventory();
        else if (shopOpen) toggleShop();
        else if (settingsOpen) setSettingsOpen(false);
        else toggleMenu();
      }
      if (e.key.toLowerCase() === 'e') {
        if (!menuOpen && !settingsOpen && !shopOpen) toggleInventory();
      }
      if (e.key.toLowerCase() === 'k') {
        if (!menuOpen && !settingsOpen && !inventoryOpen) toggleShop();
      }
    };

    const handleKeyUp = (e) => {
      if (e.key === 'Tab') {
         e.preventDefault();
         setShowScoreboard(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
       window.removeEventListener('keydown', handleKeyDown);
       window.removeEventListener('keyup', handleKeyUp);
    };
  }, [inventoryOpen, settingsOpen, shopOpen, menuOpen, internalMenu, toggleInventory, toggleShop, toggleMenu, openSettings, closeSettings, setSettingsOpen, isTyping]);

  const showToast = (msg) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(msg);
    toastTimeoutRef.current = setTimeout(() => setToastMessage(null), 3000);
  };

  // Compute the active overlay
  let activeOverlay = null;
  if (internalMenu) {
    activeOverlay = internalMenu; // 'delete_confirm'
  } else if (inventoryOpen) {
    activeOverlay = 'inventory';
  } else if (shopOpen) {
    activeOverlay = 'shop';
  } else if (settingsOpen) {
    activeOverlay = 'ingame_settings';
  } else if (menuOpen) {
    activeOverlay = 'ingame_esc';
  }

  const handleDeleteWorld = async () => {
    const slot = sessionStorage.getItem('saveSlotId');
    setSkipAutoSave(true);
    if (slot) {
      await clearDB(); // Uses the DB prefix logic internally
      sessionStorage.removeItem('saveSlotId');
      localStorage.removeItem(`saveMetadata_${slot}`);
      window.location.reload();
    } else {
      window.location.reload();
    }
  };

  const handleSaveAndExit = async () => {
    if (isGuest) {
      showToast('SAVING TO HOST...');
      
      // Gather final state to send to Host
      const state = useStore.getState();
      const pos = [playerPosition.x, playerPosition.y, playerPosition.z];
      const rot = [playerRotation.x, playerRotation.y, playerRotation.z, playerRotation.w];
      const dataToSave = {
         version: state.version || 1,
         inventory: state.inventory,
         activeHotbarIndex: state.activeHotbarIndex,
         texture: state.texture,
         coins: state.coins,
         playerHealth: state.playerHealth,
         playerMaxHealth: state.playerMaxHealth,
         playerDamageMult: state.playerDamageMult,
         playerJumpMult: state.playerJumpMult,
         playerPos: pos,
         playerRot: rot,
         isDead: state.isDead,
         playtime: state.playtime || 0
      };
      useNetworkStore.getState().syncGuestStateToHost(dataToSave);
      
      // Artificial delay to guarantee WebRTC packet fires before browser tears down connection
      await new Promise(r => setTimeout(r, 500));
      
      showToast('DISCONNECTING...');
      useNetworkStore.getState().disconnect(true);
      sessionStorage.removeItem('saveSlotId');
      window.location.reload();
      return;
    }
    showToast('SAVING WORLD DATA...');
    await saveWorld();
    await savePlayerState([playerPosition.x, playerPosition.y, playerPosition.z], [playerRotation.x, playerRotation.y, playerRotation.z]);
    await flushWAL(); // ENSURE DB WRITE COMPLETES BEFORE RELOAD!
    sessionStorage.removeItem('saveSlotId');
    window.location.reload();
  };

  return (
    <div className="fixed inset-0 z-50 pointer-events-none font-sans text-white select-none">
      
      {/* QUOTA ERROR BANNER */}
      <AnimatePresence>
        {quotaError && (
          <motion.div 
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -100, opacity: 0 }}
            className="absolute top-0 left-0 w-full bg-red-600 border-b-4 border-red-800 text-white text-center py-3 px-6 shadow-[0_10px_30px_rgba(220,38,38,0.5)] z-[9999] pointer-events-auto flex items-center justify-center space-x-4"
          >
            <AlertTriangle className="text-white animate-pulse" size={24} />
            <div className="flex flex-col text-left">
              <span className="font-bold text-sm tracking-widest uppercase">âš ï¸ Save Failed: Browser Storage Full</span>
              <span className="text-xs font-light text-red-100">You must press ESC to exit and free up space (Export/Delete old saves, or clear C: drive space) to prevent progress loss!</span>
            </div>
            <button onClick={() => setQuotaError(false)} className="ml-8 px-4 py-1.5 bg-black/30 hover:bg-black/50 border border-white/20 rounded text-xs font-bold transition-all cursor-pointer">Dismiss</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* HUD - ALWAYS RENDERED EXCEPT WHEN MENUS OVERLAY IT */}
      <div className={`absolute inset-0 transition-opacity duration-300 ${activeOverlay ? 'opacity-0' : 'opacity-100'}`}>
        
        {/* HEALTH BAR (Bottom Left) */}
        <div className="absolute bottom-8 left-8 flex items-center space-x-4 bg-black/80 backdrop-blur-xl border border-white/20 px-6 py-4 rounded-2xl shadow-2xl">
          <div className="relative">
            <Heart size={32} className={playerHealth < 30 && gameMode?.toLowerCase() !== 'creative' ? "text-red-500 animate-pulse drop-shadow-[0_0_8px_red]" : "text-cyan-400 drop-shadow-[0_0_8px_#22d3ee]"} />
          </div>
          <div className="w-64 h-4 bg-black/60 rounded-full border border-white/10 overflow-hidden shadow-inner">
            <div 
              className={`h-full transition-all duration-300 ${playerHealth < 30 && gameMode?.toLowerCase() !== 'creative' ? "bg-red-500/60 backdrop-blur-md shadow-[0_0_15px_rgba(239,68,68,0.4)] border-r border-red-400" : "bg-cyan-400/50 backdrop-blur-md shadow-[0_0_15px_rgba(34,211,238,0.3)] border-r border-cyan-300/80"}`} 
              style={{ width: gameMode?.toLowerCase() === 'creative' ? '100%' : `${Math.max(0, (playerHealth / playerMaxHealth) * 100)}%` }} 
            />
          </div>
          <span className="font-mono text-lg font-bold tracking-widest text-white drop-shadow-md">
            {gameMode?.toLowerCase() === 'creative' ? 'âˆž' : `${Math.ceil(playerHealth)}/${playerMaxHealth}`}
          </span>
        </div>

        {/* SOLAR CYCLE (Top Center) */}
        <div className="absolute top-8 left-1/2 -translate-x-1/2 flex items-center space-x-4 bg-black/80 backdrop-blur-xl border border-white/20 px-6 py-3 rounded-full shadow-2xl">
          {isNightTime ? <Moon size={24} className="text-indigo-400 drop-shadow-[0_0_8px_#818cf8]" /> : <Sun size={24} className="text-yellow-400 animate-[spin_10s_linear_infinite] drop-shadow-[0_0_8px_#facc15]" />}
          <span className="font-mono text-base font-bold tracking-widest text-white drop-shadow-md">
            {Math.floor(worldTime).toString().padStart(2, '0')}:00
          </span>
        </div>

        {/* PICKUP FEED (Bottom Right) */}
        <div className="absolute bottom-8 right-8 flex flex-col items-end pointer-events-none">
          <AnimatePresence>
            {pickupFeed && pickupFeed.map((item) => (
              <PickupFeedItem key={item.id} item={item} onRemove={removePickupFeedItem} />
            ))}
          </AnimatePresence>
        </div>

        {/* MULTIPLAYER STATUS (Top Left) */}
        {connectionStatus === 'connected' && (
           <div className="absolute top-8 left-8 flex flex-col items-start pointer-events-none">
             <div className="bg-black/80 backdrop-blur-xl border border-cyan-500/30 px-6 py-3 rounded-full shadow-2xl flex items-center space-x-3">
                <span className="relative flex h-3 w-3 mr-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500"></span>
                </span>
                <span className="font-mono text-xs font-bold tracking-[0.2em] text-cyan-300">
                  ROOM: {roomCode}
                </span>
                <span className="text-white/30">|</span>
                <span className="font-mono text-xs font-bold tracking-[0.2em] text-white/70">
                  {playerCount} PLAYER{playerCount !== 1 ? 'S' : ''}
                </span>
             </div>
           </div>
        )}
        
        {/* CHAT FEED */}
        <ChatFeed />
        
        {/* SCOREBOARD */}
        <Scoreboard isVisible={showScoreboard} />
      </div>

      {/* Background Blur Overlay (Only when menus are open) */}
      <div className={`absolute inset-0 bg-[#0b0c10]/40 backdrop-blur-[12px] transition-opacity duration-500 pointer-events-auto ${activeOverlay ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} />
      <InventoryOverlay active={activeOverlay === 'inventory'} onClose={toggleInventory} />
      <ShopOverlay active={activeOverlay === 'shop'} onClose={toggleShop} />

      {/* IN-GAME ESC */}
      <div className={`absolute inset-0 flex flex-col items-center justify-center transition-all duration-[600ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${activeOverlay === 'ingame_esc' ? 'opacity-100 pointer-events-auto scale-100' : 'opacity-0 pointer-events-none scale-105'}`}>
        <div className="w-[800px] flex flex-col items-center">
          <div className="mb-12 flex flex-col items-center text-center">
            <span className="px-4 py-1 rounded-full border border-cyan-500/30 bg-cyan-900/20 text-[10px] tracking-[0.4em] text-cyan-300 font-bold mb-6">
               {gameMode?.toUpperCase()} MODE {connectionStatus === 'connected' ? ` | MULTIPLAYER (${isHost ? 'HOST' : 'GUEST'})` : ''}
            </span>
            <h1 className="text-5xl font-light tracking-[0.2em] mb-2">WORLD <span className="font-bold text-cyan-400">SEARCHER</span></h1>
            {connectionStatus === 'connected' && isHost ? (
               <div className="mt-4 flex flex-col items-center bg-black/40 border border-cyan-500/50 rounded-xl p-4 backdrop-blur-md">
                 <span className="text-[10px] text-cyan-300/70 tracking-[0.3em] font-bold mb-2 uppercase">Your Room Code</span>
                 <span className="text-3xl font-mono text-cyan-400 tracking-[0.4em] drop-shadow-[0_0_15px_#22d3ee] select-all cursor-text">{roomCode}</span>
                 <span className="text-[10px] text-white/40 tracking-widest mt-2">Share this code with friends to let them join your world.</span>
               </div>
            ) : connectionStatus === 'connected' && !isHost ? (
               <div className="mt-4 flex flex-col items-center bg-black/40 border border-cyan-500/50 rounded-xl p-4 backdrop-blur-md">
                 <span className="text-[10px] text-cyan-300/70 tracking-[0.3em] font-bold mb-2 uppercase">Connected To Room</span>
                 <span className="text-2xl font-mono text-cyan-400 tracking-[0.4em] drop-shadow-[0_0_15px_#22d3ee]">{roomCode}</span>
               </div>
            ) : (
               <p className="text-white/50 tracking-widest text-sm font-light uppercase">System suspended. Awaiting input.</p>
            )}
          </div>
          <div className="flex space-x-6 mb-8 relative">
            <button onMouseEnter={() => sfxManager.play('ui_hover')} onClick={() => { sfxManager.play('ui_click'); toggleMenu(); }} className="w-32 h-32 rounded-full flex flex-col items-center justify-center bg-white/5 border border-white/10 hover:border-cyan-400 hover:bg-cyan-900/20 hover:shadow-[0_0_30px_rgba(34,211,238,0.2)] transition-all duration-300 group cursor-pointer backdrop-blur-md">
              <Play className="text-white/50 group-hover:text-cyan-400 mb-2 transition-colors ml-1" size={24} />
              <span className="text-xs font-bold tracking-[0.2em] text-white/70 group-hover:text-white transition-colors text-center leading-tight">RESUME<br/>GAME</span>
            </button>
            <button onMouseEnter={() => sfxManager.play('ui_hover')} onClick={() => { sfxManager.play('ui_click'); setSettingsOpen(true); }} className="w-32 h-32 rounded-full flex flex-col items-center justify-center bg-white/5 border border-white/10 hover:border-white/40 hover:bg-white/10 transition-all duration-300 group cursor-pointer backdrop-blur-md">
              <Settings className="text-white/50 group-hover:text-white mb-2 transition-colors" size={24} />
              <span className="text-xs font-bold tracking-[0.2em] text-white/70 group-hover:text-white transition-colors text-center leading-tight">SYSTEM<br/>CONFIG</span>
            </button>
            <button onMouseEnter={() => sfxManager.play('ui_hover')} onClick={() => { sfxManager.play('ui_click'); setInternalMenu('delete_confirm'); }} className="w-32 h-32 rounded-full flex flex-col items-center justify-center bg-black/40 border border-red-500/30 hover:border-red-400 hover:bg-red-900/20 hover:shadow-[0_0_30px_rgba(248,113,113,0.2)] transition-all duration-300 group cursor-pointer backdrop-blur-md">
              <Power className="text-red-400/50 group-hover:text-red-400 mb-2 transition-colors" size={24} />
              <span className="text-xs font-bold tracking-[0.2em] text-red-200/70 group-hover:text-red-100 transition-colors text-center leading-tight">
                {isGuest ? <>DISCONNECT<br/>FROM SERVER</> : <>SAVE &<br/>QUIT</>}
              </span>
            </button>
          </div>
          <div className="w-[400px] mb-8">
            <MusicPlayerWidget />
          </div>
          <div className="w-full max-w-2xl bg-black/40 border border-white/10 rounded-2xl p-6 backdrop-blur-xl shadow-2xl">
            <div className="grid grid-cols-2 gap-x-12 gap-y-4">
               <div className="space-y-4">
                 <div className="flex items-center text-sm"><KeyUI>W</KeyUI><KeyUI>A</KeyUI><KeyUI>S</KeyUI><KeyUI>D</KeyUI> <span className="ml-3 text-white/50 tracking-widest font-light">Move</span></div>
                 <div className="flex items-center text-sm"><KeyUI>L-Click</KeyUI> <span className="ml-3 text-white/50 tracking-widest font-light">Break / Place</span></div>
                 <div className="flex items-center text-sm"><KeyUI>Shift</KeyUI> <span className="ml-3 text-white/50 tracking-widest font-light">Sprint</span></div>
                 <div className="flex items-center text-sm"><KeyUI>Scroll</KeyUI> <span className="ml-3 text-white/50 tracking-widest font-light">Cycle Slots</span></div>
               </div>
               <div className="space-y-4">
                 <div className="flex items-center text-sm"><KeyUI>Space</KeyUI> <span className="ml-3 text-white/50 tracking-widest font-light">Jump</span></div>
                 <div className="flex items-center text-sm"><KeyUI>Alt</KeyUI> <span className="mx-1 text-white/30">+</span> <KeyUI>Click</KeyUI> <span className="ml-3 text-white/50 tracking-widest font-light">Force Break</span></div>
                 <div className="flex items-center text-sm"><KeyUI>1</KeyUI> <span className="mx-1 text-white/30">-</span> <KeyUI>9</KeyUI> <span className="ml-3 text-white/50 tracking-widest font-light">Hotbar Select</span></div>
                 <div className="flex items-center text-sm"><KeyUI>E</KeyUI> <span className="ml-3 text-white/50 tracking-widest font-light">Inventory</span></div>
               </div>
            </div>
          </div>
        </div>
      </div>

      {/* DELETE/QUIT CONFIRMATION */}
      <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transition-all duration-300 ease-out ${activeOverlay === 'delete_confirm' ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none'}`}>
        <div className="bg-[#1a0f14]/80 backdrop-blur-2xl border border-red-500/30 rounded-2xl p-8 shadow-[0_0_50px_rgba(248,113,113,0.1)] w-96 flex flex-col items-center text-center">
           <AlertTriangle className="text-red-400 mb-4 animate-pulse" size={32} />
           <p className="text-red-200 text-sm tracking-widest font-light mb-8">Exit to Title Screen?</p>
           <div className="flex w-full space-x-4">
             <button onMouseEnter={() => sfxManager.play('ui_hover')} onClick={() => { sfxManager.play('ui_click'); handleSaveAndExit(); }} className="flex-1 py-3 rounded-lg bg-red-900/40 border border-red-500/30 text-red-200 text-xs tracking-[0.2em] font-bold hover:bg-red-500/20 hover:border-red-400 transition-all cursor-pointer">{isGuest ? 'YES, DISCONNECT' : 'YES, EXIT'}</button>
             <button onMouseEnter={() => sfxManager.play('ui_hover')} onClick={() => { sfxManager.play('ui_click'); setInternalMenu(null); }} className="flex-1 py-3 rounded-lg bg-white/5 border border-white/10 text-white/70 text-xs tracking-[0.2em] font-bold hover:bg-white/10 hover:text-white transition-all cursor-pointer">CANCEL</button>
           </div>
           
           <div className="mt-8 pt-4 border-t border-red-900/30 w-full">
              {!isGuest && <button onClick={handleDeleteWorld} className="w-full py-2 text-red-500/50 hover:text-red-400 text-[10px] tracking-widest transition-colors font-bold">PERMANENTLY PURGE WORLD</button>}
            </div>
        </div>
      </div>

      {/* IN-GAME SETTINGS */}
      <div className={`absolute inset-0 flex items-center justify-center transition-all duration-[500ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${activeOverlay === 'ingame_settings' ? 'opacity-100 pointer-events-auto scale-100' : 'opacity-0 pointer-events-none scale-105'}`}>
        <div className="bg-[#0b0c10]/80 backdrop-blur-3xl border border-white/10 rounded-2xl w-[600px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
          <div className="flex items-center justify-between p-6 border-b border-white/5">
             <h3 className="text-xl font-light tracking-[0.3em] text-white">SETTINGS</h3>
             <button onClick={() => setSettingsOpen(false)} className="p-2 text-white/40 hover:text-cyan-400 hover:bg-white/5 rounded-full transition-colors cursor-pointer"><X size={20} /></button>
          </div>
          <div className="p-8 overflow-y-auto space-y-10 scrollbar-hide">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold tracking-[0.3em] text-cyan-400/70">AUDIO</span>
                <span className="px-3 py-1 bg-white/5 rounded-full text-xs font-mono text-white/50 flex items-center border border-white/5"><Volume2 size={12} className="mr-2"/> ON</span>
              </div>
              <CustomSlider label="Master" value={audioMaster} onChange={setAudioMaster} />
              <CustomSlider label="Sound FX" value={audioSfx} onChange={setAudioSfx} />
              <CustomSlider label="Music" value={audioMusic} onChange={setAudioMusic} />
            </div>
            <div className="space-y-6">
              <span className="text-[10px] font-bold tracking-[0.3em] text-cyan-400/70 block">GRAPHICS</span>
              <CustomSlider label="Render Dist." value={renderDistance} onChange={setRenderDistance} min={2} max={32} suffix=" ch" />
              <div className="flex justify-between items-center text-sm font-light text-white/50 w-full">
                <span className="w-24 group-hover:text-white transition-colors">Shadows</span>
                <div className="flex-1 mx-4 flex bg-black/40 border border-white/10 rounded-lg p-1">
                  <button onClick={() => setShadowQuality('performance')} className={`flex-1 py-1.5 text-xs font-bold tracking-widest rounded-md transition-all ${shadowQuality === 'performance' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50' : 'text-white/40 hover:text-white border border-transparent hover:bg-white/5'}`}>PERFORMANCE</button>
                  <button onClick={() => setShadowQuality('visual')} className={`flex-1 py-1.5 text-xs font-bold tracking-widest rounded-md transition-all ${shadowQuality === 'visual' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50' : 'text-white/40 hover:text-white border border-transparent hover:bg-white/5'}`}>VISUAL</button>
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <span className="text-[10px] font-bold tracking-[0.3em] text-cyan-400/70 block mb-4">GAME MODE</span>
              <div className="flex space-x-4">
                <GameModeCard title="Survival" desc="Manage health, gather resources." isActive={gameMode === 'Survival'} onClick={() => setGameMode('Survival')} />
                <GameModeCard title="Creative" desc="Infinite blocks, build freely." isActive={gameMode === 'Creative'} onClick={() => setGameMode('Creative')} />
                <GameModeCard title="Hardcore" desc="One life. No respawn." isActive={gameMode === 'Hardcore'} onClick={() => setGameMode('Hardcore')} />
              </div>
            </div>
            <div className="space-y-4 pt-4 border-t border-white/5">
              <span className="text-[10px] font-bold tracking-[0.3em] text-cyan-400/70 block mb-4">DATA MANAGEMENT</span>
              <button onClick={() => showToast("Export feature in development...")} className="w-full py-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-cyan-400/50 transition-all flex items-center justify-center group cursor-pointer">
                <Upload size={16} className="text-white/40 group-hover:text-cyan-400 mr-3 transition-colors" />
                <span className="text-xs font-bold tracking-[0.2em] text-white/70 group-hover:text-white transition-colors">EXPORT SAVE</span>
              </button>
              <button onClick={() => showToast("Import feature in development...")} className="w-full py-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-cyan-400/50 transition-all flex items-center justify-center group cursor-pointer">
                <Download size={16} className="text-white/40 group-hover:text-cyan-400 mr-3 transition-colors" />
                <span className="text-xs font-bold tracking-[0.2em] text-white/70 group-hover:text-white transition-colors">IMPORT SAVE</span>
              </button>
            </div>
          </div>
          <div className="p-6 border-t border-white/5">
            <button onClick={() => setSettingsOpen(false)} className="w-full py-4 rounded-xl bg-cyan-900/30 border border-cyan-400/50 hover:bg-cyan-900/50 hover:border-cyan-400 transition-all text-xs font-bold tracking-[0.2em] text-cyan-100 cursor-pointer">DONE</button>
          </div>
        </div>
      </div>

      {/* Toast Notification */}
      <div className={`fixed bottom-12 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur-md border border-cyan-400/50 text-cyan-200 px-6 py-3 rounded-full text-xs tracking-widest font-bold transition-all duration-300 z-[100] ${toastMessage ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8 pointer-events-none'}`}>
        {toastMessage}
      </div>
      
    </div>
  );
}
