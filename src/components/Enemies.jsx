import { useStore } from '../stores/useStore';
import { useNetworkStore } from '../stores/useNetworkStore';
import { useEffect } from 'react';
import { playerPosition } from '../globals';
import { BlockRegistry, BlockById } from '../registry/BlockRegistry';
import { SwarmManager, getSwarmActiveCount } from './SwarmManager';
import { getIndex, getTextureId, getIsHidden, CHUNK_Y_MIN, CHUNK_Y_MAX, getGlobalBlockLight } from '../utils/chunkData';

const SPAWN_MIN_DIST = 20;  
const SPAWN_MAX_DIST = 50;

export const Enemies = () => {
  useEffect(() => {
    const interval = setInterval(() => {
      const netState = useNetworkStore.getState();
      if (netState.connectionStatus === 'connected' && !netState.isHost) {
          return; // Guests do not spawn their own enemies! They receive sync from the Host.
      }

      const state = useStore.getState();
      const isNight = state.isNightTime;
      const days = state.daysElapsed;
      const level = 1 + Math.floor((days - 1) / 2);

      // Attempt to spawn up to 5 enemies per tick
      for (let batch = 0; batch < 5; batch++) {
        let spawnType = null;
        if (isNight) {
           spawnType = Math.random() > 0.5 ? 'shadowman' : 'creeper';
           if (Math.random() < 0.15) spawnType = 'beast';
        } else {
           spawnType = Math.random() > 0.5 ? 'muck-pig' : 'wooly-grazer';
        }

        if (!spawnType) continue;

        // SAFE LIMITS: Ensure physics doesn't choke when entities swarm the player.
        // Previously set to 400/300/100, which caused intense Rapier Broadphase/Narrowphase CPU locking.
        const maxForType = spawnType === 'shadowman' ? 40 : spawnType === 'creeper' ? 30 : spawnType === 'beast' ? 10 : 10;
        const activeCount = getSwarmActiveCount(spawnType);
        if (activeCount >= maxForType) continue;

        const angle   = Math.random() * Math.PI * 2;
        const dist    = SPAWN_MIN_DIST + Math.random() * (SPAWN_MAX_DIST - SPAWN_MIN_DIST);
        const x       = playerPosition.x + Math.cos(angle) * dist;
        const z       = playerPosition.z + Math.sin(angle) * dist;

        const cx = Math.floor(x / 16);
        const cz = Math.floor(z / 16);
        const chunk = state.chunks[`${cx},${cz}`];
        
        if (!chunk || !chunk.buffer || !chunk.meshArrays || Object.keys(chunk.meshArrays).length === 0) {
           continue;
        }
        
        let y = null;
        
        const lx = Math.floor((x % 16 + 16) % 16);
        const lz = Math.floor((z % 16 + 16) % 16);
        
        const py = Math.floor(playerPosition.y);
        const searchTop = Math.min(CHUNK_Y_MAX, py + 15);
        const searchBot = Math.max(CHUNK_Y_MIN, py - 25);
        
        for (let by = searchTop; by >= searchBot; by--) {
           const val = chunk.buffer[getIndex(lx, by, lz)];
           if (val !== 0) {
              const tex = getTextureId(val);
              const blockDef = BlockById[tex];
              if (blockDef && (blockDef.isFlora || blockDef.isLiquid || blockDef.isPassable)) continue;
              
              if (by + 2 <= CHUNK_Y_MAX) {
                 const v1 = chunk.buffer[getIndex(lx, by + 1, lz)];
                 const v2 = chunk.buffer[getIndex(lx, by + 2, lz)];
                 const b1 = BlockById[getTextureId(v1)];
                 const b2 = BlockById[getTextureId(v2)];
                 
                 const isV1Clear = v1 === 0 || b1?.isPassable || b1?.isFlora;
                 const isV2Clear = v2 === 0 || b2?.isPassable || b2?.isFlora;
                 
                 if (isV1Clear && isV2Clear) {
                    y = by + 1; 
                    break;
                 }
              }
           }
        }
        
        if (y === null) continue;

        let isValidSpawn = true;
        if (spawnType !== 'muck-pig' && spawnType !== 'wooly-grazer') {
           for (const flare of (state.placedFlares || [])) {
              const dx = x - flare.pos[0];
              const dy = y - flare.pos[1];
              const dz = z - flare.pos[2];
              if (dx*dx + dy*dy + dz*dz < 225) { 
                 isValidSpawn = false;
                 break;
              }
           }
           
           if (isValidSpawn) {
               const gx = Math.floor(x);
               const gz = Math.floor(z);
               const gy = Math.floor(y);
               
               const neighborBuffers = [];
               const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]];
               for (const [dx, dz] of dirs) {
                  const nChunk = state.chunks[`${cx+dx},${cz+dz}`];
                  if (nChunk && nChunk.buffer) {
                     neighborBuffers.push({ cx: cx+dx, cz: cz+dz, buffer: nChunk.buffer });
                  }
               }
               const light = getGlobalBlockLight(gx, gy, gz, chunk.buffer, neighborBuffers);
               if (light > 2) {
                  isValidSpawn = false;
               }
           }
        }
        
        if (!isValidSpawn) continue; 

        if (spawnType === 'muck-pig' || spawnType === 'wooly-grazer') {
           const availableSlots = maxForType - getSwarmActiveCount(spawnType);
           const herdSize = Math.min(2 + Math.floor(Math.random() * 3), availableSlots);
           if (herdSize <= 0) continue;
           for (let i = 0; i < herdSize; i++) {
             const offsetX = (Math.random() - 0.5) * 6;
             const offsetZ = (Math.random() - 0.5) * 6;
             const nx = x + offsetX;
             const nz = z + offsetZ;
             const ncx = Math.floor(nx / 16);
             const ncz = Math.floor(nz / 16);
             const nChunk = state.chunks[`${ncx},${ncz}`];
             
             if (!nChunk || !nChunk.buffer || !nChunk.meshArrays || Object.keys(nChunk.meshArrays).length === 0) continue;
             
             let ny = null;
             
             const nlx = Math.floor((nx % 16 + 16) % 16);
             const nlz = Math.floor((nz % 16 + 16) % 16);
             
             for (let by = searchTop; by >= searchBot; by--) {
                const val = nChunk.buffer[getIndex(nlx, by, nlz)];
                if (val !== 0) {
                   const tex = getTextureId(val);
                   const blockDef = BlockById[tex];
                   if (blockDef && (blockDef.isFlora || blockDef.isLiquid || blockDef.isPassable)) continue;
                   
                   if (by + 2 <= CHUNK_Y_MAX) {
                      const v1 = nChunk.buffer[getIndex(nlx, by + 1, nlz)];
                      const v2 = nChunk.buffer[getIndex(nlx, by + 2, nlz)];
                      const b1 = BlockById[getTextureId(v1)];
                      const b2 = BlockById[getTextureId(v2)];
                      if ((v1 === 0 || b1?.isPassable || b1?.isFlora) && (v2 === 0 || b2?.isPassable || b2?.isFlora)) {
                         ny = by + 1;
                         break;
                      }
                   }
                }
             }
             if (ny !== null) {
                console.log(`[Enemies] Spawning ${spawnType} at ${nx.toFixed(1)}, ${ny}, ${nz.toFixed(1)}`);
                state.requestSpawn(spawnType, [nx, ny, nz], 1);
             }
           }
        } else {
           console.log(`[Enemies] Spawning ${spawnType} at ${x.toFixed(1)}, ${y}, ${z.toFixed(1)}`);
           state.requestSpawn(spawnType, [x, y, z], level);
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, []); 

  return (
    <>
      <SwarmManager type="shadowman" max={40} />
      <SwarmManager type="creeper" max={30} />
      <SwarmManager type="beast" max={10} />
      <SwarmManager type="muck-pig" max={10} />
      <SwarmManager type="wooly-grazer" max={10} />
    </>
  );
};
