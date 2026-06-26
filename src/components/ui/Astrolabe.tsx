// @ts-nocheck
import React, { useEffect, useRef } from 'react';
import { playerPosition, playerRotation, shipTransforms } from '../../globals';
import { Euler } from 'three';
import { BaseOverlay } from './BaseOverlay';
import { X } from 'lucide-react';
import { useStore } from '../../stores/useStore';
import { networkActions } from '../../stores/networkActions';
import { EventBus } from '../../utils/EventBus';
import { Wind } from 'lucide-react';

export const Astrolabe = ({ active, onClose }) => {
  const canvasRef = useRef(null);
  const setShipDestination = useStore(state => state.setShipDestination);
  const shipDestination = useStore(state => state.shipDestination);
  const worldSeed = useStore(state => state.worldSeed);
  const shipCorePower = useStore(state => state.shipCorePower);

  const regionX = useStore(state => state.shipRegion ? state.shipRegion.x : 0);
  const regionZ = useStore(state => state.shipRegion ? state.shipRegion.z : 0);

  const distantIslands = React.useMemo(() => {
    if (!worldSeed) return [];
    const islands = [];
    
    // 3x3 neighbor grid
    for (let rX = regionX - 2000; rX <= regionX + 2000; rX += 2000) {
      for (let rZ = regionZ - 2000; rZ <= regionZ + 2000; rZ += 2000) {
          // Calculate a robust 2D hash for this region cell
          const hashX = rX * 73856093;
          const hashZ = rZ * 19349663;
          const regionalSeed = worldSeed ^ hashX ^ hashZ;
          
          // Generate 2 islands per region cell so we have ~18 islands visible
          for(let i=0; i<2; i++) {
              const angle = ((Math.abs(regionalSeed) + i * 1337) % 360) * (Math.PI / 180);
              const dist = 500 + ((Math.abs(regionalSeed) * (i+1)) % 1000); 
              const ix = Math.floor(rX + Math.cos(angle) * dist);
              const iz = Math.floor(rZ + Math.sin(angle) * dist);
              const rawSeed = Math.abs((ix + 1) * (iz + 1) * worldSeed) % 10000000;
              const poiRandom = (Math.abs(regionalSeed) * (i+2)) % 100;
              let finalType = 0; // 0: Island
              if (poiRandom < 15) finalType = 1; // 15% Spark Crystal
              else if (poiRandom < 30) finalType = 2; // 15% Ruins
              else if (poiRandom < 40) finalType = 3; // 10% Meteor
              const encodedSeed = (rawSeed * 100) + finalType;
              islands.push({ x: ix, z: iz, seed: encodedSeed, type: finalType });
          }
      }
    }
    return islands;
  }, [worldSeed, regionX, regionZ]);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    let frameId;
    const draw = () => {
      ctx.clearRect(0, 0, 600, 600);
      
      const px = playerPosition.x;
      const pz = playerPosition.z;
      
      const yaw = playerRotation.y;
      
      const centerX = 300;
      const centerY = 300;
      
      // Draw Radar Background
      ctx.beginPath();
      ctx.arc(centerX, centerY, 280, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 20, 20, 0.6)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.4)';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Draw Grid Rings
      ctx.beginPath();
      ctx.arc(centerX, centerY, 180, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.2)';
      ctx.stroke();
      
      ctx.beginPath();
      ctx.arc(centerX, centerY, 80, 0, Math.PI * 2);
      ctx.stroke();
      
      // Draw Crosshairs
      ctx.beginPath();
      ctx.moveTo(centerX, 20);
      ctx.lineTo(centerX, 580);
      ctx.moveTo(20, centerY);
      ctx.lineTo(580, centerY);
      ctx.stroke();
      
      // Draw Sweep Line
      const time = performance.now() / 1000;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(centerX + Math.cos(time * 2) * 280, centerY + Math.sin(time * 2) * 280);
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.8)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.lineWidth = 1; // reset

      // Draw Ship Core Blip
      const t = shipTransforms.get('default');
      const shipPos = t ? t.position : { x: 0, y: 0, z: 0 };
      const dx = shipPos.x - px;
      const dz = shipPos.z - pz;
      
      // Scale down so 100 blocks = 280 pixels -> wait, if dist is 1500, scale of 2.8 makes it 4200.
      // Let's use a scale that fits 1500 blocks into 280 pixels => scale = 280 / 1500 = 0.18
      const scale = 0.18;
      
      // Rotate by player yaw so the radar is always relative to player forward
      const rotX = dx * Math.cos(-yaw) - dz * Math.sin(-yaw);
      const rotZ = dx * Math.sin(-yaw) + dz * Math.cos(-yaw);
      
      const blipX = centerX + rotX * scale;
      const blipZ = centerY + rotZ * scale;
      
      if (Math.hypot(rotX * scale, rotZ * scale) < 280) {
        ctx.beginPath();
        ctx.arc(blipX, blipZ, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#00ff00'; // Home base
        ctx.fill();
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#00ff00';
      }

      // Draw Distant Islands
      distantIslands.forEach(island => {
         const idx = island.x - px;
         const idz = island.z - pz;
         const irotX = idx * Math.cos(-yaw) - idz * Math.sin(-yaw);
         const irotZ = idx * Math.sin(-yaw) + idz * Math.cos(-yaw);
         
         const iblipX = centerX + irotX * scale;
         const iblipZ = centerY + irotZ * scale;
         
         if (Math.hypot(irotX * scale, irotZ * scale) < 280) {
            ctx.beginPath();
            const size = island.type === 0 ? 8 : 6;
            ctx.arc(iblipX, iblipZ, island.seed === shipDestination ? size + 4 : size, 0, Math.PI * 2);
            let color = '#facc15'; // Island
            if (island.type === 1) color = '#38bdf8'; // Spark Crystal (Blue)
            if (island.type === 2) color = '#a78bfa'; // Ruins (Purple)
            if (island.type === 3) color = '#ef4444'; // Meteor (Red)
            if (island.seed === shipDestination) color = '#ff00ff';
            ctx.fillStyle = color;
            ctx.fill();
            ctx.shadowBlur = 15;
            ctx.shadowColor = color;
         }
      });
      
      // Reset Shadow
      ctx.shadowBlur = 0;
      
      // Draw Player Arrow at Center
      ctx.beginPath();
      ctx.moveTo(centerX, centerY - 15);
      ctx.lineTo(centerX - 10, centerY + 10);
      ctx.lineTo(centerX + 10, centerY + 10);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      // Coordinates & Destination Display
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.font = '24px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`X:${Math.floor(px)} Z:${Math.floor(pz)}`, centerX, 580);
      if (shipDestination) {
         ctx.fillStyle = '#ff00ff';
         ctx.fillText(`DEST: ${shipDestination}`, centerX, 550);
      }
      
      frameId = requestAnimationFrame(draw);
    };
    
    draw();
    
    return () => cancelAnimationFrame(frameId);
  }, [active, distantIslands, shipDestination]);

  const handleCanvasClick = (e) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    
    const px = playerPosition.x;
    const pz = playerPosition.z;
    const yaw = playerRotation.y;
    const scale = 0.18;
    const centerX = 300;
    const centerY = 300;

    let clickedSeed = null;
    let minDist = 20; // 20 pixels click radius

    distantIslands.forEach(island => {
       const idx = island.x - px;
       const idz = island.z - pz;
       const irotX = idx * Math.cos(-yaw) - idz * Math.sin(-yaw);
       const irotZ = idx * Math.sin(-yaw) + idz * Math.cos(-yaw);
       
       const iblipX = centerX + irotX * scale;
       const iblipZ = centerY + irotZ * scale;
       
       if (Math.hypot(irotX * scale, irotZ * scale) < 280) {
           const dist = Math.hypot(iblipX - clickX, iblipZ - clickY);
           if (dist < minDist) {
              minDist = dist;
              clickedSeed = island.seed;
           }
       }
    });

    if (clickedSeed) {
       setShipDestination(clickedSeed);
       const netState = networkActions.getState();
       if (netState && !netState.isHost && netState.connections[0]) {
           try { netState.connections[0].send({ type: 'SET_DESTINATION', seed: clickedSeed }); } catch {}
       }
    }
  };

  return (
    <BaseOverlay active={active} onClose={onClose}>
      <div className="relative pointer-events-auto bg-black/50 p-4 rounded-full border-4 border-neutral-800 drop-shadow-[0_0_25px_rgba(255,255,255,0.15)]">
        <button onClick={onClose} className="absolute top-8 right-8 z-50 text-neutral-400 hover:text-white transition-colors bg-black/80 rounded-full p-2 border border-neutral-700">
          <X size={32} />
        </button>
        <canvas ref={canvasRef} onClick={handleCanvasClick} width={600} height={600} className="rounded-full cursor-pointer" />
        
        {shipDestination && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[350px]">
                <button
                  onClick={() => {
                     const canisters = useStore.getState().shipVoidCanisters;
                     if (canisters <= 0) { EventBus.emit('audio', { sound: 'error', source: 'local' }); return; }
                     if (shipCorePower < 5000) { EventBus.emit('audio', { sound: 'error', source: 'local' }); return; }

                     const netState = networkActions.getState();
                     if (netState && netState.isHost) {
                        const newVal = Math.max(0, canisters - 1);
                        useStore.getState().setShipVoidCanisters(newVal);
                        netState.broadcastEvent({ type: 'SYNC_VOID_CANISTERS', val: newVal });

                        useStore.getState().setLongWarping(true);
                        if (!useStore.getState().isTransitMode) useStore.getState().toggleTransitMode();
                        netState.broadcastEvent({ type: 'WARP_SYNC', active: true, longWarp: true });
                     } else if (netState && !netState.isHost) {
                        const reliableConn = netState.connections[0];
                        if (reliableConn) {
                           try { 
                               reliableConn.send({ type: 'CONSUME_VOID_INTENT' });
                               reliableConn.send({ type: 'LONG_WARP_INTENT' }); 
                           } catch {}
                        }
                     }
                     EventBus.emit('audio', { sound: 'ui_click', source: 'local' });
                     onClose();
                  }}
                  disabled={shipCorePower < 5000 || useStore.getState().shipVoidCanisters <= 0}
                  className={`w-full py-4 rounded-full font-bold tracking-widest uppercase transition-all flex justify-center items-center space-x-3 ${
                    (shipCorePower >= 5000 && useStore.getState().shipVoidCanisters > 0)
                      ? 'bg-fuchsia-600 hover:bg-fuchsia-500 text-white shadow-[0_0_30px_rgba(217,70,239,0.5)]'
                      : 'bg-white/5 text-white/30 border border-white/10 cursor-not-allowed'
                  }`}
                >
                  <Wind size={20} />
                  <span>Hyperdrive (5K Power + Warp Canister)</span>
                </button>
            </div>
        )}
      </div>
    </BaseOverlay>
  );
};

