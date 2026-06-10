import { useStore } from '../stores/useStore';
import { useEnvironmentStore } from '../stores/environmentSlice';
import { useChunkStore } from '../stores/chunkSlice';
import { useFlareStore } from '../stores/flareSlice';
import { networkActions } from '../stores/networkActions';
import { useEffect, useRef } from 'react';
import { playerPosition } from '../globals';
import { BlockById } from '../registry/BlockRegistry';
import { SwarmManager } from './SwarmManager';
import { getSwarmActiveCount } from '../utils/swarmConfig';
import {
  getIndex,
  getTextureId,
  CHUNK_Y_MIN,
  CHUNK_Y_MAX,
} from '../utils/chunkData';
import { getBiomeAt, getBiomeConfig } from '../utils/biomes';
import { mulberry32 } from '../utils/chunkGenerator';
import { createNoise2D } from 'simplex-noise';
import { getSeed } from '../worldSeed';

const SPAWN_MIN_DIST = 20;
const SPAWN_MAX_DIST = 50;

let tempNoise = null;
let moistNoise = null;
let cachedSeed = null;

const getNoises = (seed) => {
  if (seed !== cachedSeed) {
    cachedSeed = seed;
    tempNoise = createNoise2D(mulberry32(seed + 1));
    moistNoise = createNoise2D(mulberry32(seed + 2));
  }
  return { tempNoise, moistNoise };
};

export const Enemies = () => {
  const lastBeastDay = useRef(-1);

  useEffect(() => {
    const interval = setInterval(() => {
      const netState = networkActions.getState();
      if (netState.connectionStatus === 'connected' && !netState.isHost) {
        return; // Guests do not spawn their own enemies! They receive sync from the Host.
      }

      const state = useStore.getState();
      const envState = useEnvironmentStore.getState();
      const isNight = envState.isNightTime;
      const days = envState.daysElapsed;
      const level = 1 + Math.floor((days - 1) / 2);
      const seed = getSeed();
      const { tempNoise, moistNoise } = getNoises(seed);

      // Attempt to spawn up to 5 enemies per tick
      for (let batch = 0; batch < 5; batch++) {
        const angle = Math.random() * Math.PI * 2;
        const dist =
          SPAWN_MIN_DIST + Math.random() * (SPAWN_MAX_DIST - SPAWN_MIN_DIST);
        const x = playerPosition.x + Math.cos(angle) * dist;
        const z = playerPosition.z + Math.sin(angle) * dist;

        const cx = Math.floor(x / 16);
        const cz = Math.floor(z / 16);
        const chunkStoreState = useChunkStore.getState();
        const chunk = chunkStoreState.chunks[`${cx},${cz}`];

        if (
          !chunk ||
          !chunk.buffer ||
          !chunk.meshArrays ||
          Object.keys(chunk.meshArrays).length === 0
        )
          continue;

        // Fast surface lookup from heightMap instead of looping down from Y=255!
        const lx = Math.floor(((x % 16) + 16) % 16);
        const lz = Math.floor(((z % 16) + 16) % 16);

        let y = null;
        let blockLight = 0;
        let sunLight = 0;
        let isSkyClear = true;

        // The chunk worker attached getSurfaceHeightMap to the chunkData! Wait, if it didn't survive serialization, we compute it fast.
        // Even if we iterate, we start at player y + 30, but to be completely safe from stutters, we just check near the player's Y.
        const py = Math.floor(playerPosition.y);
        const searchTop = Math.min(CHUNK_Y_MAX, py + 30);
        const searchBot = Math.max(CHUNK_Y_MIN, py - 60);

        for (let by = searchTop; by >= searchBot; by--) {
          const val = chunk.buffer[getIndex(lx, by, lz)];
          if ((val & 0xff) !== 0) {
            const tex = getTextureId(val);
            const blockDef = BlockById[tex];
            if (
              blockDef &&
              (blockDef.isFlora || blockDef.isLiquid || blockDef.isPassable)
            )
              continue;

            if (by + 2 <= CHUNK_Y_MAX) {
              const v1 = chunk.buffer[getIndex(lx, by + 1, lz)];
              const v2 = chunk.buffer[getIndex(lx, by + 2, lz)];
              const b1 = BlockById[getTextureId(v1)];
              const b2 = BlockById[getTextureId(v2)];

              const isV1Clear =
                (v1 & 0xff) === 0 || b1?.isPassable || b1?.isFlora;
              const isV2Clear =
                (v2 & 0xff) === 0 || b2?.isPassable || b2?.isFlora;

              if (isV1Clear && isV2Clear) {
                y = by + 1;
                blockLight = (v1 >> 22) & 0xf;
                sunLight = (v1 >> 26) & 0xf;
                break;
              }
            }
          }
        }

        if (y === null) continue;

        for (let cy = y + 2; cy <= Math.min(CHUNK_Y_MAX, y + 20); cy++) {
          const cVal = chunk.buffer[getIndex(lx, cy, lz)];
          if (cVal !== 0) {
            const cTex = getTextureId(cVal);
            const bDef = BlockById[cTex];
            if (bDef && !bDef.isPassable && !bDef.isFlora) {
              isSkyClear = false;
              break;
            }
          }
        }

        const isCave = !isSkyClear;
        const ambientDayLight = isNight ? 0 : sunLight;
        const effectiveLight = Math.max(blockLight, ambientDayLight);
        const isDark = isNight || (isCave && effectiveLight < 4);
        const isSurface = isSkyClear;

        // Biome Evaluation for Surface Spawns!
        const biomeId = getBiomeAt(x, z, tempNoise, moistNoise, seed);
        const biomeConfig = getBiomeConfig(biomeId);

        let spawnType = null;
        const possibleSpawns = [];

        if (isDark) {
          let type = Math.random() > 0.5 ? 'shadowman' : 'creeper';
          if (Math.random() < 0.15 && lastBeastDay.current !== days)
            type = 'beast';
          possibleSpawns.push(type);
        }

        if (isSurface && biomeConfig.fauna && biomeConfig.fauna.length > 0) {
          possibleSpawns.push(...biomeConfig.fauna);
        }

        if (possibleSpawns.length > 0) {
          spawnType =
            possibleSpawns[Math.floor(Math.random() * possibleSpawns.length)];
        }

        if (!spawnType) continue;

        const maxForType =
          spawnType === 'shadowman'
            ? 40
            : spawnType === 'creeper'
              ? 30
              : spawnType === 'beast'
                ? 1
                : 10;
        const activeCount = getSwarmActiveCount(spawnType);
        if (activeCount >= maxForType) continue;

        let isValidSpawn = true;

        // Hostiles don't spawn near flares
        if (
          spawnType === 'shadowman' ||
          spawnType === 'creeper' ||
          spawnType === 'beast'
        ) {
          const flareStoreState = useFlareStore.getState();
          for (const flare of flareStoreState.placedFlares || []) {
            const dx = x - flare.pos[0];
            const dy = y - flare.pos[1];
            const dz = z - flare.pos[2];
            if (dx * dx + dy * dy + dz * dz < 225) {
              isValidSpawn = false;
              break;
            }
          }

          if (isValidSpawn) {
            if (effectiveLight > 2) {
              isValidSpawn = false;
            }
          }
        }

        if (!isValidSpawn) continue;

        if (spawnType === 'beast') {
          lastBeastDay.current = days;
        }

        // Herd spawning
        if (spawnType === 'muck-pig' || spawnType === 'wooly-grazer') {
          const availableSlots = maxForType - getSwarmActiveCount(spawnType);
          const herdSize = Math.min(
            2 + Math.floor(Math.random() * 3),
            availableSlots
          );
          if (herdSize <= 0) continue;
          for (let i = 0; i < herdSize; i++) {
            const offsetX = (Math.random() - 0.5) * 6;
            const offsetZ = (Math.random() - 0.5) * 6;
            const nx = x + offsetX;
            const nz = z + offsetZ;
            const ncx = Math.floor(nx / 16);
            const ncz = Math.floor(nz / 16);
            const nChunk = chunkStoreState.chunks[`${ncx},${ncz}`];

            if (
              !nChunk ||
              !nChunk.buffer ||
              !nChunk.meshArrays ||
              Object.keys(nChunk.meshArrays).length === 0
            )
              continue;

            let ny = null;

            const nlx = Math.floor(((nx % 16) + 16) % 16);
            const nlz = Math.floor(((nz % 16) + 16) % 16);

            for (let by = searchTop; by >= searchBot; by--) {
              const val = nChunk.buffer[getIndex(nlx, by, nlz)];
              if ((val & 0xff) !== 0) {
                const tex = getTextureId(val);
                const blockDef = BlockById[tex];
                if (
                  blockDef &&
                  (blockDef.isFlora || blockDef.isLiquid || blockDef.isPassable)
                )
                  continue;

                if (by + 2 <= CHUNK_Y_MAX) {
                  const v1 = nChunk.buffer[getIndex(nlx, by + 1, nlz)];
                  const v2 = nChunk.buffer[getIndex(nlx, by + 2, nlz)];
                  const b1 = BlockById[getTextureId(v1)];
                  const b2 = BlockById[getTextureId(v2)];
                  if (
                    ((v1 & 0xff) === 0 || b1?.isPassable || b1?.isFlora) &&
                    ((v2 & 0xff) === 0 || b2?.isPassable || b2?.isFlora)
                  ) {
                    ny = by + 2.0; // Spawn higher to prevent physics ejection (flying through ground)
                    break;
                  }
                }
              }
            }
            if (ny !== null) {
              // console.log(`[Enemies] Spawning ${spawnType} at ${nx.toFixed(1)}, ${ny}, ${nz.toFixed(1)}`);
              state.requestSpawn(spawnType, [nx, ny, nz], 1);
            }
          }
        } else {
          // console.log(`[Enemies] Spawning ${spawnType} at ${x.toFixed(1)}, ${y}, ${z.toFixed(1)}`);
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
      <SwarmManager type="beast" max={1} />
      <SwarmManager type="muck-pig" max={10} />
      <SwarmManager type="wooly-grazer" max={10} />
    </>
  );
};
