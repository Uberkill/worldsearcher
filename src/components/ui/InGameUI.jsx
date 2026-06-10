import { useState, useEffect, useCallback, useRef } from 'react';
import { gameAudio } from '../../audio/GameAudio';
import {
  Settings,
  Power,
  X,
  AlertTriangle,
  Download,
  Upload,
  Volume2,
  VolumeX,
  Map,
  Trophy,
  Zap,
  Sparkles,
  Star,
  Play,
  Heart,
  Sun,
  Moon,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../../stores/useStore';
import { networkActions } from '../../stores/networkActions';
import { useSyncStore } from '../../stores/syncSlice';
import { useConnectionStore } from '../../stores/connectionSlice';
import { clearDB, flushWAL, setSkipAutoSave } from '../../utils/db';
import { GlobalRegistry } from '../../registry/Registry';
import { playerPosition, playerRotation } from '../../globals';
import { InventoryOverlay } from './InventoryOverlay';
import { CreativeInventory } from './CreativeInventory';
import { SkillTreeOverlay } from './SkillTreeOverlay';
import { SpectorModal } from './SpectorModal';
import { useEnvironmentStore } from '../../stores/environmentSlice';
import { QuestJournal } from './QuestJournal';
import { DataBufferHUD } from './DataBufferHUD';
import { ChestOverlay } from './ChestOverlay';
import { CraftingOverlay } from './CraftingOverlay';
import { ShopOverlay } from './ShopOverlay';
import { ChatFeed } from './ChatFeed';
import { Scoreboard } from './Scoreboard';
import { QuestTracker } from './QuestTracker';

import { MusicPlayerWidget } from './MusicPlayerWidget';

// Reusable Key UI
const KeyUI = ({ children }) => (
  <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded bg-black/40 border border-white/10 shadow-[inset_0_-2px_0_rgba(255,255,255,0.05)] text-white/70 font-mono text-[10px] uppercase font-bold tracking-wider mr-1">
    {children}
  </span>
);

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

  const activeTrackColor = isDanger ? 'bg-red-500' : 'bg-cyan-400';
  const thumbColor = isDanger
    ? 'bg-red-400 shadow-[0_0_8px_#f87171]'
    : 'bg-cyan-300 shadow-[0_0_8px_#22d3ee]';
  const valueColor = isDanger ? 'text-red-300' : 'text-cyan-200';

  return (
    <div className="flex justify-between items-center text-sm font-light text-white/50 group w-full">
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
          className={`absolute w-3 h-3 ${thumbColor} rounded-full pointer-events-none`}
          style={{ left: `calc(${percentage}% - 6px)` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          className="absolute w-full opacity-0 cursor-pointer"
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
        style={{
          backgroundColor: GlobalRegistry[item.texture]?.color || '#fff',
        }}
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
  const menuOpen = useStore((state) => state.isMenuOpen);
  const inventoryOpen = useStore((state) => state.isInventoryOpen);
  const settingsOpen = useStore((state) => state.isSettingsOpen);
  const shopOpen = useStore((state) => state.isShopOpen);
  const craftingOpen = useStore((state) => state.isCraftingTableOpen);
  const skillTreeOpen = useStore((state) => state.isSkillTreeOpen);
  const questJournalOpen = useStore((state) => state.isQuestJournalOpen);
  const activeChestId = useStore((state) => state.activeChestId);

  const toggleMenu = useStore((state) => state.toggleMenu);
  const toggleInventory = useStore((state) => state.toggleInventory);
  const toggleShop = useStore((state) => state.toggleShop);
  const toggleCraftingTable = useStore((state) => state.toggleCraftingTable);
  const toggleSkillTree = useStore((state) => state.toggleSkillTree);
  const toggleQuestJournal = useStore((state) => state.toggleQuestJournal);
  const closeChest = useStore((state) => state.closeChest);
  const saveWorld = useStore((state) => state.saveWorld);
  const savePlayerState = useStore((state) => state.savePlayerState);

  // Settings use open/close in slice
  const openSettings = useStore((state) => state.openSettings);
  const closeSettings = useStore((state) => state.closeSettings);

  const setSettingsOpen = useCallback(
    (val) => (val ? openSettings() : closeSettings()),
    [openSettings, closeSettings]
  );

  const inventory = useStore((state) => state.inventory);

  // HUD variables
  const playerHealth = useStore((state) => state.playerHealth);
  const playerMaxHealth = useStore((state) => state.playerMaxHealth);
  const playerPower = useStore((state) => state.playerPower);
  const playerMaxPower = useStore((state) => state.playerMaxPower);
  const playerMana = useStore((state) => state.playerMana);
  const playerMaxMana = useStore((state) => state.playerMaxMana);
  const playerXP = useStore((state) => state.playerData);
  
  const pickupFeed = useStore((state) => state.pickupFeed);
  const removePickupFeedItem = useStore((state) => state.removePickupFeedItem);
  const worldTime = useEnvironmentStore((state) => state.worldTime);
  const isRaining = useEnvironmentStore((state) => state.isRaining);
  const isNightTime = useEnvironmentStore((state) => state.isNightTime);
  const hotbarSize = 9; // Hardcoded in standard
  const hotbarItems = inventory.slice(0, hotbarSize);
  const mainInventoryItems = inventory.slice(hotbarSize);

  // Pad the arrays so the UI grid always looks full
  const paddedMain = [...mainInventoryItems];
  while (paddedMain.length < 27) paddedMain.push(null);
  const paddedHotbar = [...hotbarItems];
  while (paddedHotbar.length < 9) paddedHotbar.push(null);

  const renderDistance = useStore((state) => state.renderDistance);
  const setRenderDistance = useStore((state) => state.setRenderDistance);
  const shadowQuality = useStore((state) => state.shadowQuality);
  const setShadowQuality = useStore((state) => state.setShadowQuality);

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
    return () =>
      window.removeEventListener('storage_quota_exceeded', handleQuota);
  }, []);

  // Real game mode from settings
  const gameMode = useStore((state) => state.gameMode);

  // Real audio from settings
  const masterVolume = useStore((state) => state.masterVolume);
  const setMasterVolumeStore = useStore((state) => state.setMasterVolume);
  const sfxVolume = useStore((state) => state.sfxVolume);
  const setSfxVolumeStore = useStore((state) => state.setSfxVolume);
  const musicVolume = useStore((state) => state.musicVolume);
  const setMusicVolumeStore = useStore((state) => state.setMusicVolume);

  // Convert 0.0-1.0 to 0-100 for sliders
  const audioMaster = Math.round(masterVolume * 100);
  const audioSfx = Math.round(sfxVolume * 100);
  const audioMusic = Math.round(musicVolume * 100);

  const setAudioMaster = (val) => setMasterVolumeStore(val / 100);
  const setAudioSfx = (val) => setSfxVolumeStore(val / 100);
  const setAudioMusic = (val) => setMusicVolumeStore(val / 100);

  // Network State
  const roomCode = useConnectionStore((state) => state.roomCode);
  const isHost = useConnectionStore((state) => state.isHost);
  const connectionStatus = useConnectionStore((state) => state.connectionStatus);
  const isGuest = connectionStatus === 'connected' && !isHost;
  const players = useSyncStore((state) => state.players);
  const playerCount = Object.keys(players).length + 1;

  const uiStateRef = useRef({ internalMenu, settingsOpen });
  useEffect(() => {
    uiStateRef.current = { internalMenu, settingsOpen };
  }, [internalMenu, settingsOpen]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  // KEYBOARD HANDLER
  useEffect(() => {
    const handleKeyDown = (e) => {
      const { internalMenu, settingsOpen } = uiStateRef.current;
      if (internalMenu) return;

      const ns = networkActions.getState();
      const st = useStore.getState();

      if (ns.isTyping) {
        if (e.key === 'Escape') ns.setTyping(false);
        return;
      }

      const anyMenuOpen =
        st.isMenuOpen ||
        settingsOpen ||
        st.isShopOpen ||
        st.isInventoryOpen ||
        st.isCraftingTableOpen ||
        st.activeChestId !== null;

      if (e.key === 'Enter' || e.key.toLowerCase() === 't') {
        if (!anyMenuOpen) {
          e.preventDefault();
          ns.setTyping(true);
          return;
        }
      }

      if (e.key === 'Tab') {
        if (!anyMenuOpen) {
          e.preventDefault();
          setShowScoreboard(true);
          return;
        }
      }

      if (e.key === 'Escape') {
        if (st.heldItem) {
          st.executeLocalTransaction(
            st.heldItem.sourceLoc,
            null,
            'DROP',
            st.heldItem.count
          );
          st.setHeldItem(null);
          return;
        }
        if (st.isInventoryOpen) st.toggleInventory();
        else if (st.isCraftingTableOpen) st.toggleCraftingTable();
        else if (st.isQuestJournalOpen) st.toggleQuestJournal();
        else if (st.activeChestId !== null) st.closeChest();
        else if (st.isShopOpen) st.toggleShop();
        else if (settingsOpen) setSettingsOpen(false);
        else st.toggleMenu();
      }

      if (e.key.toLowerCase() === 'j') {
        if (!st.isMenuOpen && !settingsOpen && !st.isShopOpen && !st.isInventoryOpen && !st.isCraftingTableOpen && st.activeChestId === null) {
          st.toggleQuestJournal();
        }
      }

      if (e.key.toLowerCase() === 'e') {
        if (!st.isMenuOpen && !settingsOpen && !st.isShopOpen) {
          if (st.isCraftingTableOpen) st.toggleCraftingTable();
          else if (st.activeChestId !== null) st.closeChest();
          else st.toggleInventory();
        }
      }

      if (e.key.toLowerCase() === 'k') {
        if (
          !st.isMenuOpen &&
          !settingsOpen &&
          !st.isInventoryOpen &&
          !st.isCraftingTableOpen &&
          st.activeChestId === null
        )
          st.toggleShop();
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
  }, [setSettingsOpen]);

  const showToast = (msg) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(msg);
    toastTimeoutRef.current = setTimeout(() => setToastMessage(null), 3000);
  };

  let activeOverlay = null;
  if (internalMenu) {
    activeOverlay = internalMenu; // 'delete_confirm'
  } else if (inventoryOpen) {
    activeOverlay = 'inventory';
  } else if (craftingOpen) {
    activeOverlay = 'crafting';
  } else if (skillTreeOpen) {
    activeOverlay = 'skilltree';
  } else if (questJournalOpen) {
    activeOverlay = 'quest_journal';
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
      const rot = [
        playerRotation.x,
        playerRotation.y,
        playerRotation.z,
        playerRotation.w,
      ];
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
        playtime: state.playtime || 0,
      };
      networkActions.getState().syncGuestStateToHost(dataToSave);

      // Artificial delay to guarantee WebRTC packet fires before browser tears down connection
      await new Promise((r) => setTimeout(r, 500));

      showToast('DISCONNECTING...');
      networkActions.getState().disconnect(true);
      sessionStorage.removeItem('saveSlotId');
      window.location.reload();
      return;
    }
    showToast('SAVING WORLD DATA...');
    await saveWorld();
    await savePlayerState(
      [playerPosition.x, playerPosition.y, playerPosition.z],
      [playerRotation.x, playerRotation.y, playerRotation.z]
    );
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
              <span className="font-bold text-sm tracking-widest uppercase">
                ! Save Failed: Browser Storage Full
              </span>
              <span className="text-xs font-light text-red-100">
                You must press ESC to exit and free up space (Export/Delete old
                saves, or clear C: drive space) to prevent progress loss!
              </span>
            </div>
            <button
              onClick={() => setQuotaError(false)}
              className="ml-8 px-4 py-1.5 bg-black/30 hover:bg-black/50 border border-white/20 rounded text-xs font-bold transition-all cursor-pointer"
            >
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* HUD - ALWAYS RENDERED EXCEPT WHEN MENUS OVERLAY IT */}
      <div
        className={`absolute inset-0 transition-opacity duration-300 ${activeOverlay ? 'opacity-0' : 'opacity-100'}`}
      >
        {/* LEFT HUD (Chat + Health) */}
        <div className="absolute bottom-8 left-8 flex flex-col justify-end space-y-4 pointer-events-none z-50">
          <ChatFeed />

          <div className="flex flex-col space-y-2 bg-black/80 backdrop-blur-xl border border-white/20 px-6 py-4 rounded-2xl shadow-2xl pointer-events-auto w-max">
            {/* XP Bar */}
            <div className="flex items-center space-x-3 mb-1">
              <div className="w-5 flex justify-center">
                <Star size={14} className="text-green-400 drop-shadow-[0_0_5px_#4ade80]" />
              </div>
              <div className="w-64 h-1.5 bg-black/60 rounded-full border border-white/5 overflow-hidden shadow-inner">
                <div
                  className="h-full bg-green-400/80 shadow-[0_0_10px_rgba(74,222,128,0.5)] transition-all duration-300"
                  style={{ width: `${(playerXP % 100)}%` }} // Wrap every 100 XP
                />
              </div>
              <span className="font-mono text-xs font-bold text-white/70 w-8 text-right">Lvl {Math.floor(playerXP / 100)}</span>
            </div>

            {/* Mana Bar */}
            <div className="flex items-center space-x-3">
              <div className="w-5 flex justify-center">
                <Sparkles size={16} className="text-fuchsia-400 drop-shadow-[0_0_5px_#e879f9]" />
              </div>
              <div className="w-64 h-2.5 bg-black/60 rounded-full border border-white/10 overflow-hidden shadow-inner">
                <div
                  className="h-full bg-fuchsia-500/70 border-r border-fuchsia-300/80 shadow-[0_0_10px_rgba(232,121,249,0.4)] transition-all duration-300"
                  style={{ width: `${Math.max(0, (playerMana / playerMaxMana) * 100)}%` }}
                />
              </div>
              <span className="font-mono text-xs font-bold text-white drop-shadow-md w-8 text-right">{Math.ceil(playerMana)}</span>
            </div>

            {/* Power Bar */}
            <div className="flex items-center space-x-3">
              <div className="w-5 flex justify-center">
                <Zap size={20} className={playerPower < 20 ? 'text-amber-500 animate-pulse drop-shadow-[0_0_8px_#f59e0b]' : 'text-amber-400 drop-shadow-[0_0_5px_#fbbf24]'} />
              </div>
              <div className="w-64 h-3 bg-black/60 rounded-full border border-white/10 overflow-hidden shadow-inner">
                <div
                  className={`h-full border-r transition-all duration-300 ${playerPower < 20 ? 'bg-amber-500/80 border-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.6)]' : 'bg-amber-400/60 border-amber-200/80 shadow-[0_0_10px_rgba(251,191,36,0.3)]'}`}
                  style={{ width: `${Math.max(0, (playerPower / playerMaxPower) * 100)}%` }}
                />
              </div>
              <span className="font-mono text-sm font-bold text-white drop-shadow-md w-8 text-right">{Math.ceil(playerPower)}</span>
            </div>

            {/* Health Bar */}
            <div className="flex items-center space-x-3">
              <div className="w-5 flex justify-center">
                <Heart size={24} className={playerHealth < 30 && gameMode?.toLowerCase() !== 'creative' ? 'text-red-500 animate-pulse drop-shadow-[0_0_8px_red]' : 'text-cyan-400 drop-shadow-[0_0_8px_#22d3ee]'} />
              </div>
              <div className="w-64 h-4 bg-black/60 rounded-full border border-white/10 overflow-hidden shadow-inner">
                <div
                  className={`h-full transition-all duration-300 ${playerHealth < 30 && gameMode?.toLowerCase() !== 'creative' ? 'bg-red-500/60 backdrop-blur-md shadow-[0_0_15px_rgba(239,68,68,0.4)] border-r border-red-400' : 'bg-cyan-400/50 backdrop-blur-md shadow-[0_0_15px_rgba(34,211,238,0.3)] border-r border-cyan-300/80'}`}
                  style={{ width: gameMode?.toLowerCase() === 'creative' ? '100%' : `${Math.max(0, (playerHealth / playerMaxHealth) * 100)}%` }}
                />
              </div>
              <span className="font-mono text-lg font-bold tracking-widest text-white drop-shadow-md w-8 text-right">
                {gameMode?.toLowerCase() === 'creative' ? '∞' : Math.ceil(playerHealth)}
              </span>
            </div>
          </div>
        </div>
        {/* SOLAR CYCLE (Top Center) */}
        <div className="absolute top-8 left-1/2 -translate-x-1/2 flex items-center space-x-4 bg-black/80 backdrop-blur-xl border border-white/20 px-6 py-3 rounded-full shadow-2xl">
          {isNightTime ? (
            <Moon
              size={24}
              className="text-indigo-400 drop-shadow-[0_0_8px_#818cf8]"
            />
          ) : (
            <Sun
              size={24}
              className="text-yellow-400 animate-[spin_10s_linear_infinite] drop-shadow-[0_0_8px_#facc15]"
            />
          )}
          <span className="font-mono text-base font-bold tracking-widest text-white drop-shadow-md">
            {Math.floor(worldTime).toString().padStart(2, '0')}:00
          </span>
        </div>

        {/* PICKUP FEED (Bottom Right) */}
        <div className="absolute bottom-8 right-8 flex flex-col items-end pointer-events-none">
          <AnimatePresence>
            {pickupFeed &&
              pickupFeed.map((item) => (
                <PickupFeedItem
                  key={item.id}
                  item={item}
                  onRemove={removePickupFeedItem}
                />
              ))}
          </AnimatePresence>
        </div>

        {/* MULTIPLAYER STATUS (Top Left) */}
          {connectionStatus !== 'disconnected' && (
            <div className="absolute top-8 left-8 flex flex-col items-start pointer-events-none">
              <div className={`bg-black/80 backdrop-blur-xl border px-6 py-3 rounded-full shadow-2xl flex items-center space-x-3 ${connectionStatus === 'degraded' || connectionStatus === 'reconnecting' ? 'border-yellow-500/50' : 'border-cyan-500/30'}`}>
                <span className="relative flex h-3 w-3 mr-2">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${connectionStatus === 'connected' ? 'bg-cyan-400' : 'bg-yellow-400'}`}></span>
                  <span className={`relative inline-flex rounded-full h-3 w-3 ${connectionStatus === 'connected' ? 'bg-cyan-500' : 'bg-yellow-500'}`}></span>
                </span>
                <span className={`font-mono text-xs font-bold tracking-[0.2em] ${connectionStatus === 'connected' ? 'text-cyan-300' : 'text-yellow-300'}`}>
                  {connectionStatus === 'connected' ? `ROOM: ${roomCode}` : connectionStatus.toUpperCase()}
                </span>
                {connectionStatus === 'connected' && (
                  <>
                    <span className="text-white/30">|</span>
                    <span className="font-mono text-xs font-bold tracking-[0.2em] text-white/70">
                      {playerCount} PLAYER{playerCount !== 1 ? 'S' : ''}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}

        {/* CHAT FEED MOVED TO LEFT HUD */}

        {/* SCOREBOARD */}
        <Scoreboard isVisible={showScoreboard} />

        {/* Diegetic Data Buffer Gauge */}
        <DataBufferHUD />
        <QuestTracker />
      </div>

      {/* Background Blur Overlay (Only when menus are open) */}
      <div
        className={`absolute inset-0 transition-opacity duration-500 pointer-events-auto ${activeOverlay ? 'bg-[#0b0c10]/40 backdrop-blur-[12px] opacity-100' : 'opacity-0 pointer-events-none'}`}
      />
      {gameMode?.toLowerCase() === 'creative' ? (
        <CreativeInventory
          active={inventoryOpen}
          onClose={() => toggleInventory()}
        />
      ) : (
        <InventoryOverlay
          active={inventoryOpen}
          onClose={() => toggleInventory()}
        />
      )}
      <CraftingOverlay active={craftingOpen} onClose={toggleCraftingTable} />
      <SkillTreeOverlay active={skillTreeOpen} onClose={toggleSkillTree} />
      <QuestJournal active={questJournalOpen} onClose={toggleQuestJournal} />
      <ChestOverlay chestId={activeChestId} onClose={closeChest} />
      <ShopOverlay active={activeOverlay === 'shop'} onClose={toggleShop} />

      {/* IN-GAME ESC */}
      <div
        className={`absolute inset-0 flex flex-col items-center justify-center transition-all duration-[600ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${activeOverlay === 'ingame_esc' ? 'opacity-100 pointer-events-auto scale-100' : 'opacity-0 pointer-events-none scale-105'}`}
      >
        <div className="w-[800px] flex flex-col items-center">
          <div className="mb-12 flex flex-col items-center text-center">
            <span className="px-4 py-1 rounded-full border border-cyan-500/30 bg-cyan-900/20 text-[10px] tracking-[0.4em] text-cyan-300 font-bold mb-6">
              {gameMode?.toUpperCase()} MODE{' '}
              {connectionStatus === 'connected'
                ? ` | MULTIPLAYER (${isHost ? 'HOST' : 'GUEST'})`
                : connectionStatus !== 'disconnected'
                  ? ` | MULTIPLAYER (${connectionStatus.toUpperCase()})`
                  : ''}
            </span>
            <h1 className="text-5xl font-light tracking-[0.2em] mb-2">
              WORLD <span className="font-bold text-cyan-400">SEARCHER</span>
            </h1>
            {connectionStatus === 'connected' && isHost ? (
              <div className="mt-4 flex flex-col items-center bg-black/40 border border-cyan-500/50 rounded-xl p-4 backdrop-blur-md">
                <span className="text-[10px] text-cyan-300/70 tracking-[0.3em] font-bold mb-2 uppercase">
                  Your Room Code
                </span>
                <span className="text-3xl font-mono text-cyan-400 tracking-[0.4em] drop-shadow-[0_0_15px_#22d3ee] select-all cursor-text">
                  {roomCode}
                </span>
                <span className="text-[10px] text-white/40 tracking-widest mt-2">
                  Share this code with friends to let them join your world.
                </span>
              </div>
            ) : connectionStatus === 'connected' && !isHost ? (
              <div className="mt-4 flex flex-col items-center bg-black/40 border border-cyan-500/50 rounded-xl p-4 backdrop-blur-md">
                <span className="text-[10px] text-cyan-300/70 tracking-[0.3em] font-bold mb-2 uppercase">
                  Connected To Room
                </span>
                <span className="text-2xl font-mono text-cyan-400 tracking-[0.4em] drop-shadow-[0_0_15px_#22d3ee]">
                  {roomCode}
                </span>
              </div>
            ) : connectionStatus !== 'disconnected' ? (
                <div className="mt-4 flex flex-col items-center bg-black/40 border border-yellow-500/50 rounded-xl p-4 backdrop-blur-md">
                  <span className="text-[10px] text-yellow-300/70 tracking-[0.3em] font-bold mb-2 uppercase">
                    Network Status
                  </span>
                  <span className="text-lg font-mono text-yellow-400 tracking-[0.2em] drop-shadow-[0_0_15px_#eab308] animate-pulse">
                    {connectionStatus === 'connecting' ? 'CONNECTING TO SERVER...' : 'RECONNECTING...'}
                  </span>
                </div>
              ) : (
              <p className="text-white/50 tracking-widest text-sm font-light uppercase">
                System suspended. Awaiting input.
              </p>
            )}
          </div>
          <div className="flex space-x-6 mb-8 relative">
            <button
              onMouseEnter={() => gameAudio.playGlobal('ui_hover')}
              onClick={() => {
                gameAudio.playGlobal('ui_click');
                toggleMenu();
              }}
              className="w-32 h-32 rounded-full flex flex-col items-center justify-center bg-white/5 border border-white/10 hover:border-cyan-400 hover:bg-cyan-900/20 hover:shadow-[0_0_30px_rgba(34,211,238,0.2)] transition-all duration-300 group cursor-pointer backdrop-blur-md"
            >
              <Play
                className="text-white/50 group-hover:text-cyan-400 mb-2 transition-colors ml-1"
                size={24}
              />
              <span className="text-xs font-bold tracking-[0.2em] text-white/70 group-hover:text-white transition-colors text-center leading-tight">
                RESUME
                <br />
                GAME
              </span>
            </button>
            <button
              onMouseEnter={() => gameAudio.playGlobal('ui_hover')}
              onClick={() => {
                gameAudio.playGlobal('ui_click');
                setSettingsOpen(true);
              }}
              className="w-32 h-32 rounded-full flex flex-col items-center justify-center bg-white/5 border border-white/10 hover:border-white/40 hover:bg-white/10 transition-all duration-300 group cursor-pointer backdrop-blur-md"
            >
              <Settings
                className="text-white/50 group-hover:text-white mb-2 transition-colors"
                size={24}
              />
              <span className="text-xs font-bold tracking-[0.2em] text-white/70 group-hover:text-white transition-colors text-center leading-tight">
                SYSTEM
                <br />
                CONFIG
              </span>
            </button>
            <button
              onMouseEnter={() => gameAudio.playGlobal('ui_hover')}
              onClick={() => {
                gameAudio.playGlobal('ui_click');
                setInternalMenu('delete_confirm');
              }}
              className="w-32 h-32 rounded-full flex flex-col items-center justify-center bg-black/40 border border-red-500/30 hover:border-red-400 hover:bg-red-900/20 hover:shadow-[0_0_30px_rgba(248,113,113,0.2)] transition-all duration-300 group cursor-pointer backdrop-blur-md"
            >
              <Power
                className="text-red-400/50 group-hover:text-red-400 mb-2 transition-colors"
                size={24}
              />
              <span className="text-xs font-bold tracking-[0.2em] text-red-200/70 group-hover:text-red-100 transition-colors text-center leading-tight">
                {isGuest ? (
                  <>
                    DISCONNECT
                    <br />
                    FROM SERVER
                  </>
                ) : (
                  <>
                    SAVE &<br />
                    QUIT
                  </>
                )}
              </span>
            </button>
          </div>
          <div className="w-[400px] mb-8">
            <MusicPlayerWidget />
          </div>
          <div className="w-full max-w-2xl bg-black/40 border border-white/10 rounded-2xl p-6 backdrop-blur-xl shadow-2xl">
            <div className="grid grid-cols-2 gap-x-12 gap-y-4">
              <div className="space-y-4">
                <div className="flex items-center text-sm">
                  <KeyUI>W</KeyUI>
                  <KeyUI>A</KeyUI>
                  <KeyUI>S</KeyUI>
                  <KeyUI>D</KeyUI>{' '}
                  <span className="ml-3 text-white/50 tracking-widest font-light">
                    Move
                  </span>
                </div>
                <div className="flex items-center text-sm">
                  <KeyUI>L-Click</KeyUI>{' '}
                  <span className="ml-3 text-white/50 tracking-widest font-light">
                    Break / Place
                  </span>
                </div>
                <div className="flex items-center text-sm">
                  <KeyUI>Shift</KeyUI>{' '}
                  <span className="ml-3 text-white/50 tracking-widest font-light">
                    Sprint
                  </span>
                </div>
                <div className="flex items-center text-sm">
                  <KeyUI>Scroll</KeyUI>{' '}
                  <span className="ml-3 text-white/50 tracking-widest font-light">
                    Cycle Slots
                  </span>
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex items-center text-sm">
                  <KeyUI>Space</KeyUI>{' '}
                  <span className="ml-3 text-white/50 tracking-widest font-light">
                    Jump
                  </span>
                </div>
                <div className="flex items-center text-sm">
                  <KeyUI>Alt</KeyUI>{' '}
                  <span className="mx-1 text-white/30">+</span>{' '}
                  <KeyUI>Click</KeyUI>{' '}
                  <span className="ml-3 text-white/50 tracking-widest font-light">
                    Force Break
                  </span>
                </div>
                <div className="flex items-center text-sm">
                  <KeyUI>1</KeyUI> <span className="mx-1 text-white/30">-</span>{' '}
                  <KeyUI>9</KeyUI>{' '}
                  <span className="ml-3 text-white/50 tracking-widest font-light">
                    Hotbar Select
                  </span>
                </div>
                <div className="flex items-center text-sm">
                  <KeyUI>E</KeyUI>{' '}
                  <span className="ml-3 text-white/50 tracking-widest font-light">
                    Inventory
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* DELETE/QUIT CONFIRMATION */}
      <div
        className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transition-all duration-300 ease-out ${activeOverlay === 'delete_confirm' ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none'}`}
      >
        <div className="bg-[#1a0f14]/80 backdrop-blur-2xl border border-red-500/30 rounded-2xl p-8 shadow-[0_0_50px_rgba(248,113,113,0.1)] w-96 flex flex-col items-center text-center">
          <AlertTriangle
            className="text-red-400 mb-4 animate-pulse"
            size={32}
          />
          <p className="text-red-200 text-sm tracking-widest font-light mb-8">
            Exit to Title Screen?
          </p>
          <div className="flex w-full space-x-4">
            <button
              onMouseEnter={() => gameAudio.playGlobal('ui_hover')}
              onClick={() => {
                gameAudio.playGlobal('ui_click');
                handleSaveAndExit();
              }}
              className="flex-1 py-3 rounded-lg bg-red-900/40 border border-red-500/30 text-red-200 text-xs tracking-[0.2em] font-bold hover:bg-red-500/20 hover:border-red-400 transition-all cursor-pointer"
            >
              {isGuest ? 'YES, DISCONNECT' : 'YES, EXIT'}
            </button>
            <button
              onMouseEnter={() => gameAudio.playGlobal('ui_hover')}
              onClick={() => {
                gameAudio.playGlobal('ui_click');
                setInternalMenu(null);
              }}
              className="flex-1 py-3 rounded-lg bg-white/5 border border-white/10 text-white/70 text-xs tracking-[0.2em] font-bold hover:bg-white/10 hover:text-white transition-all cursor-pointer"
            >
              CANCEL
            </button>
          </div>

          <div className="mt-8 pt-4 border-t border-red-900/30 w-full">
            {!isGuest && (
              <button
                onClick={handleDeleteWorld}
                className="w-full py-2 text-red-500/50 hover:text-red-400 text-[10px] tracking-widest transition-colors font-bold"
              >
                PERMANENTLY PURGE WORLD
              </button>
            )}
          </div>
        </div>
      </div>

      {/* IN-GAME SETTINGS */}
      <div
        className={`absolute inset-0 flex items-center justify-center transition-all duration-[500ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${activeOverlay === 'ingame_settings' ? 'opacity-100 pointer-events-auto scale-100' : 'opacity-0 pointer-events-none scale-105'}`}
      >
        <div className="bg-[#0b0c10]/80 backdrop-blur-3xl border border-white/10 rounded-2xl w-[600px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
          <div className="flex items-center justify-between p-6 border-b border-white/5">
            <h3 className="text-xl font-light tracking-[0.3em] text-white">
              SETTINGS
            </h3>
            <button
              onClick={() => setSettingsOpen(false)}
              className="p-2 text-white/40 hover:text-cyan-400 hover:bg-white/5 rounded-full transition-colors cursor-pointer"
            >
              <X size={20} />
            </button>
          </div>
          <div className="p-8 overflow-y-auto space-y-10 scrollbar-hide">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold tracking-[0.3em] text-cyan-400/70">
                  AUDIO
                </span>
                <span className="px-3 py-1 bg-white/5 rounded-full text-xs font-mono text-white/50 flex items-center border border-white/5">
                  <Volume2 size={12} className="mr-2" /> ON
                </span>
              </div>
              <CustomSlider
                label="Master"
                value={audioMaster}
                onChange={setAudioMaster}
              />
              <CustomSlider
                label="Sound FX"
                value={audioSfx}
                onChange={setAudioSfx}
              />
              <CustomSlider
                label="Music"
                value={audioMusic}
                onChange={setAudioMusic}
              />
            </div>
            <div className="space-y-6">
              <span className="text-[10px] font-bold tracking-[0.3em] text-cyan-400/70 block">
                GRAPHICS
              </span>
              <CustomSlider
                label="Render Dist."
                value={renderDistance}
                onChange={setRenderDistance}
                min={2}
                max={32}
                suffix=" ch"
                dangerThreshold={16}
              />
              <div className="flex justify-between items-center text-sm font-light text-white/50 w-full">
                <span className="w-24 group-hover:text-white transition-colors">
                  Shadows
                </span>
                <div className="flex-1 mx-4 flex bg-black/40 border border-white/10 rounded-lg p-1">
                  <button
                    onClick={() => setShadowQuality('performance')}
                    className={`flex-1 py-1.5 text-xs font-bold tracking-widest rounded-md transition-all ${shadowQuality === 'performance' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50' : 'text-white/40 hover:text-white border border-transparent hover:bg-white/5'}`}
                  >
                    PERFORMANCE
                  </button>
                  <button
                    onClick={() => setShadowQuality('visual')}
                    className={`flex-1 py-1.5 text-xs font-bold tracking-widest rounded-md transition-all ${shadowQuality === 'visual' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50' : 'text-white/40 hover:text-white border border-transparent hover:bg-white/5'}`}
                  >
                    VISUAL
                  </button>
                </div>
              </div>
            </div>
            <div className="space-y-4 pt-4 border-t border-white/5">
              <span className="text-[10px] font-bold tracking-[0.3em] text-cyan-400/70 block mb-4">
                DATA MANAGEMENT
              </span>
              <button
                onClick={() => showToast('Export feature in development...')}
                className="w-full py-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-cyan-400/50 transition-all flex items-center justify-center group cursor-pointer"
              >
                <Upload
                  size={16}
                  className="text-white/40 group-hover:text-cyan-400 mr-3 transition-colors"
                />
                <span className="text-xs font-bold tracking-[0.2em] text-white/70 group-hover:text-white transition-colors">
                  EXPORT SAVE
                </span>
              </button>
              <button
                onClick={() => showToast('Import feature in development...')}
                className="w-full py-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-cyan-400/50 transition-all flex items-center justify-center group cursor-pointer"
              >
                <Download
                  size={16}
                  className="text-white/40 group-hover:text-cyan-400 mr-3 transition-colors"
                />
                <span className="text-xs font-bold tracking-[0.2em] text-white/70 group-hover:text-white transition-colors">
                  IMPORT SAVE
                </span>
              </button>
            </div>
          </div>
          <div className="p-6 border-t border-white/5">
            <button
              onClick={() => setSettingsOpen(false)}
              className="w-full py-4 rounded-xl bg-cyan-900/30 border border-cyan-400/50 hover:bg-cyan-900/50 hover:border-cyan-400 transition-all text-xs font-bold tracking-[0.2em] text-cyan-100 cursor-pointer"
            >
              DONE
            </button>
          </div>
        </div>
      </div>

      {/* Toast Notification */}
      <div
        className={`fixed bottom-12 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur-md border border-cyan-400/50 text-cyan-200 px-6 py-3 rounded-full text-xs tracking-widest font-bold transition-all duration-300 z-[100] ${toastMessage ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8 pointer-events-none'}`}
      >
        {toastMessage}
      </div>
    </div>
  );
}
