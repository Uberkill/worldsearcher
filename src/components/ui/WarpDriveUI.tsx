// @ts-nocheck
import React from 'react';
import { BaseOverlay } from './BaseOverlay';
import { useStore } from '../../stores/useStore';
import { networkActions } from '../../stores/networkActions';
import { EventBus } from '../../utils/EventBus';
import { Rocket, Plus, X } from 'lucide-react';

export const WarpDriveUI = ({ active, onClose }) => {
  const shipVoidCanisters = useStore(state => state.shipVoidCanisters);
  
  // We don't subscribe to inventory directly to avoid excessive re-renders, 
  // but we can check it on click. We'll use a local state to force a quick re-render if needed, 
  // or just use useStore.getState() in the click handler.
  const inventory = useStore(state => state.inventory);
  const hasCanister = React.useMemo(() => {
    return inventory.findIndex(item => item && item.texture === 'void_canister' && item.count > 0) !== -1;
  }, [inventory]);

  const handleLoad = () => {
    const state = useStore.getState();
    const inv = state.inventory;
    const vIndex = inv.findIndex(item => item && item.texture === 'void_canister' && item.count > 0);
    
    if (vIndex === -1) {
      EventBus.emit('audio', { sound: 'error', source: 'local' });
      return;
    }

    // Consume from inventory
    state.executeLocalTransaction(
      { type: 'player', id: 'player', slot: vIndex },
      null,
      'CONSUME',
      1
    );

    // Sync network
    const netState = networkActions.getState();
    if (netState && netState.isHost) {
       const newVal = state.shipVoidCanisters + 1;
       state.setShipVoidCanisters(newVal);
       netState.broadcastEvent({ type: 'SYNC_VOID_CANISTERS', val: newVal });
    } else if (netState && !netState.isHost) {
       const reliableConn = netState.connections[0];
       if (reliableConn) {
          try { reliableConn.send({ type: 'LOAD_VOID_INTENT' }); } catch {}
       }
    }

    EventBus.emit('audio', { sound: 'level_up', source: 'local' }); // or some mechanical sound
  };

  return (
    <BaseOverlay active={active} onClose={onClose}>
      <div className="relative pointer-events-auto bg-neutral-900/90 border-2 border-fuchsia-900/50 p-8 rounded-2xl drop-shadow-[0_0_30px_rgba(217,70,239,0.2)] w-[400px] text-white">
        
        <button onClick={onClose} className="absolute top-4 right-4 text-neutral-400 hover:text-white transition-colors">
          <X size={24} />
        </button>

        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-fuchsia-900/30 rounded-full flex items-center justify-center mb-4 border border-fuchsia-500/50 shadow-[0_0_15px_rgba(217,70,239,0.5)]">
            <Rocket size={32} className="text-fuchsia-400" />
          </div>
          <h2 className="text-2xl font-bold tracking-widest uppercase text-fuchsia-100">Warp Drive Engine</h2>
          <p className="text-sm text-fuchsia-400/70 uppercase tracking-wide mt-1">Core Integrity Stable</p>
        </div>

        <div className="bg-black/50 rounded-xl p-6 border border-white/5 mb-6">
          <div className="flex justify-between items-center mb-4">
            <span className="text-neutral-400 uppercase text-sm font-bold tracking-wider">Loaded Canisters</span>
            <span className="text-3xl font-mono text-fuchsia-400 drop-shadow-[0_0_10px_rgba(217,70,239,0.5)]">
              {shipVoidCanisters}
            </span>
          </div>
          
          <div className="h-2 bg-neutral-800 rounded-full overflow-hidden">
            <div 
              className="h-full bg-fuchsia-500 transition-all duration-500 ease-out shadow-[0_0_10px_rgba(217,70,239,0.8)]"
              style={{ width: `${Math.min(100, (shipVoidCanisters / 5) * 100)}%` }}
            />
          </div>
          <p className="text-xs text-neutral-500 mt-2 text-right">Capacity: Unlimited</p>
        </div>

        <button
          onClick={handleLoad}
          disabled={!hasCanister}
          className={`w-full py-4 rounded-xl font-bold tracking-widest uppercase transition-all flex justify-center items-center space-x-3 ${
            hasCanister
              ? 'bg-fuchsia-600 hover:bg-fuchsia-500 text-white shadow-[0_0_20px_rgba(217,70,239,0.4)]'
              : 'bg-white/5 text-white/30 border border-white/10 cursor-not-allowed'
          }`}
        >
          <Plus size={20} />
          <span>Insert Void Canister</span>
        </button>

        {!hasCanister && (
          <p className="text-center text-xs text-red-400/80 mt-4">
            Requires Void Canister in inventory
          </p>
        )}
      </div>
    </BaseOverlay>
  );
};

