// @ts-nocheck
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
import { getIndex, getTextureId, CHUNK_Y_MIN, CHUNK_Y_MAX } from '../utils/chunkData';
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

const findSurfaceData = (chunk, lx, lz, searchTop, searchBot) => {
  for (let by = searchTop; by >= searchBot; by--) {
    const val = chunk.buffer[getIndex(lx, by, lz)];
    if ((val & 0xff) !== 0) {
      const tex = getTextureId(val);
      const blockDef = BlockById[tex];
      if (blockDef && (blockDef.isFlora || blockDef.isLiquid || blockDef.isPassable)) continue;

      if (by + 2 <= CHUNK_Y_MAX) {
        const v1 = chunk.buffer[getIndex(lx, by + 1, lz)];
        const v2 = chunk.buffer[getIndex(lx, by + 2, lz)];
        const b1 = BlockById[getTextureId(v1)];
        const b2 = BlockById[getTextureId(v2)];

        const isV1Clear = (v1 & 0xff) === 0 || b1?.isPassable || b1?.isFlora;
        const isV2Clear = (v2 & 0xff) === 0 || b2?.isPassable || b2?.isFlora;

        if (isV1Clear && isV2Clear) {
          return {
            y: by + 1,
            blockLight: (v1 >> 22) & 0xf,
            sunLight: (v1 >> 26) & 0xf
          };
        }
      }
    }
  }
  return null;
};

const checkSkyClearance = (chunk, lx, y, lz) => {
  for (let cy = y + 2; cy <= Math.min(CHUNK_Y_MAX, y + 20); cy++) {
    const cVal = chunk.buffer[getIndex(lx, cy, lz)];
    if (cVal !== 0) {
      const cTex = getTextureId(cVal);
      const bDef = BlockById[cTex];
      if (bDef && !bDef.isPassable && !bDef.isFlora) {
        return false;
      }
    }
  }
  return true;
};

const determineSpawnType = (x, z, tempNoise, moistNoise, seed, isDark, isSurface, days, lastBeastDayRef) => {
  const biomeId = getBiomeAt(x, z, tempNoise, moistNoise, seed);
  const biomeConfig = getBiomeConfig(biomeId);
  const possibleSpawns = [];

  if (isDark) {
    const r = Math.random();
    let type = r < 0.33 ? 'shadowman' : r < 0.66 ? 'bloop' : 'android';
    if (Math.random() < 0.15 && lastBeastDayRef.current !== days) type = 'beast';
    possibleSpawns.push(type);
  }

  if (isSurface && biomeConfig.fauna && biomeConfig.fauna.length > 0) {
    possibleSpawns.push(...biomeConfig.fauna);
  }

  if (possibleSpawns.length > 0) {
    return possibleSpawns[Math.floor(Math.random() * possibleSpawns.length)];
  }
  return null;
};

const getMaxForType = (spawnType) => {
  if (spawnType === 'shadowman') return 40;
  if (spawnType === 'android') return 30;
  if (spawnType === 'bloop') return 30;
  if (spawnType === 'beast') return 1;
  return 10; // defaults for herbivores
};

const validateSpawn = (spawnType, x, y, z, isNight, isSurface, effectiveLight) => {
  if (spawnType === 'shadowman' || spawnType === 'bloop' || spawnType === 'android' || spawnType === 'beast') {
    const flareStoreState = useFlareStore.getState();
    for (const flare of flareStoreState.placedFlares || []) {
      const dx = x - flare.pos[0];
      const dy = y - flare.pos[1];
      const dz = z - flare.pos[2];
      if (dx * dx + dy * dy + dz * dz < 225) return false;
    }

    if (!isNight && isSurface) return false;
    if (effectiveLight > 2) return false;
  }
  return true;
};

const attemptHerdSpawn = (spawnType, x, z, maxForType, searchTop, searchBot, state) => {
  const availableSlots = maxForType - getSwarmActiveCount(spawnType);
  const herdSize = Math.min(2 + Math.floor(Math.random() * 3), availableSlots);
  if (herdSize <= 0) return;

  const chunkStoreState = useChunkStore.getState();
  for (let i = 0; i < herdSize; i++) {
    const nx = x + (Math.random() - 0.5) * 6;
    const nz = z + (Math.random() - 0.5) * 6;
    const ncx = Math.floor(nx / 16);
    const ncz = Math.floor(nz / 16);
    const nChunk = chunkStoreState.chunks[`${ncx},${ncz}`];

    if (!nChunk || !nChunk.buffer || !nChunk.meshArrays || Object.keys(nChunk.meshArrays).length === 0) continue;

    const nlx = Math.floor(((nx % 16) + 16) % 16);
    const nlz = Math.floor(((nz % 16) + 16) % 16);
    const surfaceData = findSurfaceData(nChunk, nlx, nlz, searchTop, searchBot);
    
    if (surfaceData) {
      state.requestSpawn(spawnType, [nx, surfaceData.y + 1.0, nz], 1); // +1.0 for ny calculation vs y
    }
  }
};

export const Enemies = () => {
  const lastBeastDay = useRef(-1);

  useEffect(() => {
    const interval = setInterval(() => {
      const netState = networkActions.getState();
      if (netState.connectionStatus === 'connected' && !netState.isHost) return;

      const state = useStore.getState();
      const envState = useEnvironmentStore.getState();
      const isNight = envState.isNightTime;
      const days = envState.daysElapsed;
      const level = 1 + Math.floor((days - 1) / 2);
      const seed = getSeed();
      const { tempNoise, moistNoise } = getNoises(seed);

      const chunkStoreState = useChunkStore.getState();
      const py = Math.floor(playerPosition.y);
      const searchTop = Math.min(CHUNK_Y_MAX, py + 30);
      const searchBot = Math.max(CHUNK_Y_MIN, py - 60);

      for (let batch = 0; batch < 5; batch++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = SPAWN_MIN_DIST + Math.random() * (SPAWN_MAX_DIST - SPAWN_MIN_DIST);
        const x = playerPosition.x + Math.cos(angle) * dist;
        const z = playerPosition.z + Math.sin(angle) * dist;

        const cx = Math.floor(x / 16);
        const cz = Math.floor(z / 16);
        const chunk = chunkStoreState.chunks[`${cx},${cz}`];

        if (!chunk || !chunk.buffer || !chunk.meshArrays || Object.keys(chunk.meshArrays).length === 0) continue;

        const lx = Math.floor(((x % 16) + 16) % 16);
        const lz = Math.floor(((z % 16) + 16) % 16);

        const surfaceData = findSurfaceData(chunk, lx, lz, searchTop, searchBot);
        if (!surfaceData) continue;

        const { y, blockLight, sunLight } = surfaceData;
        const isSkyClear = checkSkyClearance(chunk, lx, y, lz);

        const isCave = !isSkyClear;
        const ambientDayLight = isNight ? 0 : sunLight;
        const effectiveLight = Math.max(blockLight, ambientDayLight);
        const isDark = isNight || (isCave && effectiveLight < 4);
        const isSurface = isSkyClear;

        const spawnType = determineSpawnType(x, z, tempNoise, moistNoise, seed, isDark, isSurface, days, lastBeastDay);
        if (!spawnType) continue;

        const maxForType = getMaxForType(spawnType);
        if (getSwarmActiveCount(spawnType) >= maxForType) continue;

        if (!validateSpawn(spawnType, x, y, z, isNight, isSurface, effectiveLight)) continue;

        if (spawnType === 'beast') lastBeastDay.current = days;

        if (spawnType === 'muck-pig' || spawnType === 'wooly-grazer') {
          attemptHerdSpawn(spawnType, x, z, maxForType, searchTop, searchBot, state);
        } else {
          state.requestSpawn(spawnType, [x, y, z], level);
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <SwarmManager type="shadowman" max={40} />
      <SwarmManager type="bloop" max={30} />
      <SwarmManager type="beast" max={1} />
      <SwarmManager type="muck-pig" max={10} />
      <SwarmManager type="wooly-grazer" max={10} />
    </>
  );
};

