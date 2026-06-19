import { useRef, useEffect } from 'react';
import { useChunkStore } from '../stores/chunkSlice';
import {
  BlockById,
} from '../registry/BlockRegistry';
import {
  CHUNK_Y_MIN,
} from '../utils/chunkData';
import { playerPosition, playerRotation } from '../globals';

// Precompute block colors for O(1) lightning-fast lookups in the minimap inner loop
const texColors = new Array(256).fill('#000000');
Object.keys(BlockById).forEach((id) => {
  texColors[id] = BlockById[id].color || '#ffffff';
});

export const Minimap = () => {
  const canvasRef = useRef(null);
  const mapContainerRef = useRef(null);
  const compassRingRef = useRef(null);
  const textRef = useRef(null);

  const nRef = useRef(null);
  const sRef = useRef(null);
  const eRef = useRef(null);
  const wRef = useRef(null);

  // Smoothly update rotation and coordinates without React state (zero lag)
  useEffect(() => {
    let frameId;
    let lastCoords = '';
    let lastYaw = null;

    const updateLoop = () => {
      // 1. Update Map Rotation
      if (mapContainerRef.current) {
        const yaw = playerRotation.y;

        if (yaw !== lastYaw) {
          mapContainerRef.current.style.transform = `rotate(${-yaw}rad)`;

          if (compassRingRef.current) {
            compassRingRef.current.style.transform = `rotate(${-yaw}rad)`;
          }

          // Counter-rotate the N, S, E, W markers so they stay perfectly upright
          if (nRef.current)
            nRef.current.style.transform = `translateX(-50%) rotate(${yaw}rad)`;
          if (sRef.current)
            sRef.current.style.transform = `translateX(-50%) rotate(${yaw}rad)`;
          if (eRef.current)
            eRef.current.style.transform = `translateY(-50%) rotate(${yaw}rad)`;
          if (wRef.current)
            wRef.current.style.transform = `translateY(-50%) rotate(${yaw}rad)`;

          lastYaw = yaw;
        }
      }

      // 2. Update Coordinates Text
      if (textRef.current) {
        const x = Math.floor(playerPosition.x);
        const y = Math.floor(playerPosition.y);
        const z = Math.floor(playerPosition.z);
        const newCoords = `X: ${x}  Y: ${y}  Z: ${z}`;

        // Only write to the DOM if the value actually changed to prevent layout thrashing
        if (newCoords !== lastCoords) {
          textRef.current.textContent = newCoords;
          lastCoords = newCoords;
        }
      }

      frameId = requestAnimationFrame(updateLoop);
    };
    updateLoop();
    return () => cancelAnimationFrame(frameId);
  }, []);

  // Update map scan every 5 seconds
  useEffect(() => {
    const scanMap = () => {
      const pos = playerPosition;
      const chunks = useChunkStore.getState().chunks;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, 128, 128);

      const px = Math.floor(pos.x);
      const pxY = Math.floor(pos.y);
      const pz = Math.floor(pos.z);

      const radius = 32; // 32 blocks radius = 64x64 diameter

      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const x = px + dx;
          const z = pz + dz;
          const cx = Math.floor(x / 16);
          const cz = Math.floor(z / 16);
          const chunkKey = `${cx},${cz}`;

          if (chunks[chunkKey]) {
            const buffer = chunks[chunkKey].buffer;
            let foundColor = null;
            if (buffer) {
              const lx = ((x % 16) + 16) % 16;
              const lz = ((z % 16) + 16) % 16;

              // Start scanning from Math.min(150, playerY + 40) down to -64 to skip empty sky
              const scanTop = Math.min(150, pxY + 40);
              let idx = lx + lz * 16 + (scanTop - CHUNK_Y_MIN) * 256;

              for (let y = scanTop; y > CHUNK_Y_MIN; y--) {
                const val = buffer[idx];
                if (val !== 0 && !(val & (1 << 21))) {
                  // Inline getIsHidden for speed
                  foundColor = texColors[val & 0xff]; // Inline getTextureId for speed
                  break;
                }
                idx -= 256;
              }
            }
            if (foundColor) {
              ctx.fillStyle = foundColor;
              ctx.fillRect((dx + radius) * 2, (dz + radius) * 2, 2, 2);
            }
          }
        }
      }

      // Draw player dot in center
      ctx.fillStyle = '#ff0055';
      ctx.beginPath();
      ctx.arc(radius * 2, radius * 2, 4, 0, Math.PI * 2);
      ctx.fill();
    };

    scanMap(); // Run immediately on mount so it's not blank!
    const interval = setInterval(scanMap, 5000); // update every 5 seconds

    return () => clearInterval(interval);
  }, []);

  return (
    <div
      style={{
        position: 'absolute',
        top: '20px',
        right: '20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '12px',
        zIndex: 10,
      }}
    >
      {/* Map & Compass Wrapper */}
      <div
        style={{
          position: 'relative',
          width: '160px',
          height: '160px',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        {/* Rotating Minimap */}
        <div
          ref={mapContainerRef}
          style={{
            width: '128px',
            height: '128px',
            borderRadius: '50%',
            overflow: 'hidden',
            border: '4px solid rgba(255, 255, 255, 0.1)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            backgroundColor: 'rgba(15, 23, 42, 0.8)',
            backdropFilter: 'blur(8px)',
            position: 'absolute',
          }}
        >
          <canvas
            ref={canvasRef}
            width={128}
            height={128}
            style={{ width: '100%', height: '100%' }}
          />
        </div>

        {/* Rotating Compass Ring (Outside Map) */}
        <div
          ref={compassRingRef}
          style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
        >
          <div
            ref={nRef}
            style={{
              position: 'absolute',
              top: '0px',
              left: '50%',
              transform: 'translateX(-50%)',
              color: '#22d3ee',
              fontSize: '13px',
              fontWeight: '900',
              textShadow: '0 0 6px #000, 0 0 3px #000',
            }}
          >
            N
          </div>
          <div
            ref={sRef}
            style={{
              position: 'absolute',
              bottom: '0px',
              left: '50%',
              transform: 'translateX(-50%)',
              color: '#22d3ee',
              fontSize: '13px',
              fontWeight: '900',
              textShadow: '0 0 6px #000, 0 0 3px #000',
            }}
          >
            S
          </div>
          <div
            ref={eRef}
            style={{
              position: 'absolute',
              right: '0px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#22d3ee',
              fontSize: '13px',
              fontWeight: '900',
              textShadow: '0 0 6px #000, 0 0 3px #000',
            }}
          >
            E
          </div>
          <div
            ref={wRef}
            style={{
              position: 'absolute',
              left: '0px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#22d3ee',
              fontSize: '13px',
              fontWeight: '900',
              textShadow: '0 0 6px #000, 0 0 3px #000',
            }}
          >
            W
          </div>
        </div>
      </div>

      {/* Static Coordinate Display */}
      <div
        ref={textRef}
        style={{
          background: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(12px)',
          padding: '6px 16px',
          borderRadius: '999px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          color: '#e2e8f0',
          fontSize: '0.85rem',
          fontWeight: 600,
          letterSpacing: '1px',
          fontVariantNumeric: 'tabular-nums',
          fontFamily: 'monospace',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          whiteSpace: 'nowrap',
        }}
      >
        X: 0 Y: 0 Z: 0
      </div>
    </div>
  );
};
