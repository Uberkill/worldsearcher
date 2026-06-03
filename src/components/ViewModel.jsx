import { useFrame, useThree } from '@react-three/fiber';
import { useRef, useState, useEffect, Suspense } from 'react';
import { useStore } from '../stores/useStore';
import * as THREE from 'three';
import { GlobalRegistry } from '../registry/Registry';
import { MaterialCache } from '../utils/MaterialCache';

// FIX: Hoist reusable objects — before: new Vector3/Euler/Quaternion every frame
// = 180 allocations/sec → GC pressure → frame stutters.
const _targetPos  = new THREE.Vector3();
const _targetEul  = new THREE.Euler();
const _targetQuat = new THREE.Quaternion();

// Derive colour from BlockRegistry so it auto-updates when registry changes.
// Items not in registry (tools) fall back to the hand-coded map.
const TOOL_COLORS = {
  sword:      '#c0c0c0',
  gun:        '#333333',
  pickaxe:    '#777777',
  lantern:    '#ffcc44',
  flare:      '#ff8800',
};
const getColor = (texture) =>
  TOOL_COLORS[texture] ?? GlobalRegistry[texture]?.color ?? '#ffffff';

// Items that use the long "tool" shape instead of a cube
const TOOL_SHAPES = new Set(['sword', 'gun', 'pickaxe', 'lantern', 'flare']);

// Shared geometry for the viewmodel mesh — avoid re-allocation on texture change
const CUBE_GEO = new THREE.BoxGeometry(0.4, 0.4, 0.4);
const TOOL_GEO = new THREE.BoxGeometry(0.1, 0.1, 0.8);

import { ModelLoader } from './ModelLoader';
import { ErrorBoundary } from 'react-error-boundary';

// Custom Fallback Geometry Renderers
const FallbackModels = {
  sword: () => (
    <group position={[0, -0.3, 0]}>
      <mesh castShadow receiveShadow position={[0, -0.15, 0]}>
        <boxGeometry args={[0.1, 0.3, 0.1]} />
        <meshStandardMaterial color="#333333" />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 0.4, 0]}>
        <boxGeometry args={[0.08, 0.8, 0.08]} />
        <meshStandardMaterial color="#00ffff" emissive="#00ffff" emissiveIntensity={0.5} />
      </mesh>
    </group>
  ),
  gun: () => (
    <group position={[0, -0.2, -0.3]}>
      <mesh castShadow receiveShadow position={[0, 0, -0.2]}>
        <boxGeometry args={[0.1, 0.1, 0.6]} />
        <meshStandardMaterial color="#444444" />
      </mesh>
      <mesh castShadow receiveShadow position={[0, -0.125, 0.05]} rotation={[-0.2, 0, 0]}>
        <boxGeometry args={[0.1, 0.25, 0.12]} />
        <meshStandardMaterial color="#222222" />
      </mesh>
    </group>
  ),
  gauss_rifle: () => (
    <group position={[0, -0.2, -0.3]}>
      {/* Barrel - Sleek & Long */}
      <mesh castShadow receiveShadow position={[0, 0, -0.7]}>
        <boxGeometry args={[0.06, 0.06, 1.4]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.2} metalness={0.8} />
      </mesh>
      {/* Scope - High Tech */}
      <mesh castShadow receiveShadow position={[0, 0.08, -0.3]}>
        <boxGeometry args={[0.04, 0.04, 0.4]} />
        <meshStandardMaterial color="#050505" />
      </mesh>
      {/* Handle */}
      <mesh castShadow receiveShadow position={[0, -0.15, -0.1]} rotation={[-0.2, 0, 0]}>
        <boxGeometry args={[0.06, 0.25, 0.1]} />
        <meshStandardMaterial color="#050505" />
      </mesh>
      {/* Aether Crystal Power Core - Wraps around the sides like a battery */}
      <mesh castShadow receiveShadow position={[0, 0, -0.45]}>
        <boxGeometry args={[0.1, 0.04, 0.3]} />
        <meshStandardMaterial color="#00ffff" emissive="#00ffff" emissiveIntensity={1.5} />
      </mesh>
      {/* Barrel Muzzle Glow */}
      <mesh castShadow receiveShadow position={[0, 0, -1.41]}>
        <boxGeometry args={[0.04, 0.04, 0.02]} />
        <meshStandardMaterial color="#00ffff" emissive="#00ffff" emissiveIntensity={2} />
      </mesh>
    </group>
  ),
  grapple: () => (
    <group position={[0, -0.2, 0]}>
      {/* Main Body */}
      <mesh castShadow receiveShadow position={[0, 0, -0.2]}>
        <boxGeometry args={[0.15, 0.15, 0.3]} />
        <meshStandardMaterial color="#333333" roughness={0.7} metalness={0.4} />
      </mesh>
      {/* Grip */}
      <mesh castShadow receiveShadow position={[0, -0.15, -0.1]} rotation={[-0.2, 0, 0]}>
        <boxGeometry args={[0.06, 0.25, 0.08]} />
        <meshStandardMaterial color="#111111" />
      </mesh>
      {/* Front Winch Ring */}
      <mesh castShadow receiveShadow position={[0, 0, -0.4]}>
        <boxGeometry args={[0.18, 0.18, 0.05]} />
        <meshStandardMaterial color="#222222" />
      </mesh>
      {/* Hook Claws */}
      <mesh castShadow receiveShadow position={[0.08, 0, -0.45]} rotation={[0, 0.3, 0]}>
        <boxGeometry args={[0.02, 0.02, 0.15]} />
        <meshStandardMaterial color="#666666" />
      </mesh>
      <mesh castShadow receiveShadow position={[-0.08, 0, -0.45]} rotation={[0, -0.3, 0]}>
        <boxGeometry args={[0.02, 0.02, 0.15]} />
        <meshStandardMaterial color="#666666" />
      </mesh>
    </group>
  ),
  pickaxe: () => (
    <group position={[0, -0.3, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[0.08, 0.6, 0.08]} />
        <meshStandardMaterial color="#555555" />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 0.25, 0]}>
        <boxGeometry args={[0.1, 0.1, 0.6]} />
        <meshStandardMaterial color="#ffaa00" emissive="#ffaa00" emissiveIntensity={0.5} />
      </mesh>
    </group>
  ),
  lantern: () => (
    <group position={[0, -0.1, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[0.2, 0.4, 0.2]} />
        <meshStandardMaterial color="#ffaa00" emissive="#ffaa00" emissiveIntensity={0.8} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 0.225, 0]}>
        <boxGeometry args={[0.25, 0.05, 0.25]} />
        <meshStandardMaterial color="#222222" />
      </mesh>
      <mesh castShadow receiveShadow position={[0, -0.225, 0]}>
        <boxGeometry args={[0.25, 0.05, 0.25]} />
        <meshStandardMaterial color="#222222" />
      </mesh>
    </group>
  ),
  flare: () => (
    <group position={[0, -0.1, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[0.1, 0.5, 0.1]} />
        <meshStandardMaterial color="#ff2200" emissive="#ff2200" emissiveIntensity={1} />
      </mesh>
    </group>
  )
};

export const ViewModel = () => {
  const { camera } = useThree();
  const groupRef = useRef();
  const meshRef  = useRef();
  const activeTexture = useStore((state) => state.texture);
  const [isSwinging, setIsSwinging] = useState(false);

  useEffect(() => {
    const handleMouseDown = () => {
      if (document.pointerLockElement) {
        setIsSwinging(true);
        // Faster reset for gun recoil, standard for others
        const duration = useStore.getState().texture === 'gun' ? 100 : 150;
        setTimeout(() => setIsSwinging(false), duration);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  useFrame((state) => {
    if (!groupRef.current) return;

    // Follow camera — no allocation, direct copy
    groupRef.current.position.copy(camera.position);
    groupRef.current.quaternion.copy(camera.quaternion);

    const t   = state.clock.getElapsedTime();
    const bobX = Math.sin(t * 3) * 0.02;
    const bobY = Math.abs(Math.sin(t * 6)) * 0.04;
    
    let swingX = 0, swingY = 0, swingZ = 0;
    let rotX = 0, rotY = 0, rotZ = 0;

    if (isSwinging) {
      if (activeTexture === 'sword') {
        // Diagonal slash from top-right to bottom-left
        swingX = -0.5;
        swingY = -0.3;
        rotX = -Math.PI / 4;
        rotY = Math.PI / 4;
        rotZ = -Math.PI / 2;
      } else if (activeTexture === 'gauss_rifle') {
        // Massive recoil
        swingY = 0.2; 
        swingZ = 0.5; // kick backwards towards camera heavily
        rotX = Math.PI / 6; // pitch up heavily
      } else if (activeTexture === 'gun') {
        // Snappy recoil kickback
        swingZ = 0.2; // kick backwards towards camera
        rotX = Math.PI / 12; // pitch up slightly
      } else {
        // Default chop (pickaxe / others)
        swingX = -0.3;
        swingY = -0.2;
        rotX = -Math.PI / 4;
        rotZ = -Math.PI / 3;
      }
    }

    _targetPos.set(0.5 + bobX + swingX, -0.4 + bobY + swingY, -0.8 + swingZ);
    _targetEul.set(rotX, rotY, rotZ);
    _targetQuat.setFromEuler(_targetEul);
    
    if (meshRef.current) {
        // Gun snaps back fast (recoil), sword/pickaxe have a smoother swing
        let lerpSpeed = 0.25;
        if (activeTexture === 'gun') lerpSpeed = 0.4;
        if (activeTexture === 'gauss_rifle') lerpSpeed = 0.15; // Slow heavy recovery

        meshRef.current.position.lerp(_targetPos, lerpSpeed);
        meshRef.current.quaternion.slerp(_targetQuat, lerpSpeed);
    }
  });

  const registryItem = GlobalRegistry[activeTexture];
  const modelUrl = registryItem?.model; // Custom GLTF URL
  const isTool = TOOL_SHAPES.has(activeTexture);
  
  // Conditionally render the fallback models
  const FallbackComponent = FallbackModels[activeTexture];

  return (
    <group ref={groupRef}>
      <group ref={meshRef}>
          {modelUrl ? (
            <ErrorBoundary fallback={FallbackComponent ? <FallbackComponent /> : null}>
              <Suspense fallback={FallbackComponent ? <FallbackComponent /> : null}>
                <ModelLoader url={modelUrl} />
              </Suspense>
            </ErrorBoundary>
          ) : FallbackComponent ? (
            <FallbackComponent />
          ) : (
            <mesh
              geometry={isTool ? TOOL_GEO : CUBE_GEO}
              castShadow
              material={MaterialCache.getLambert(
                getColor(activeTexture),
                activeTexture === 'glass',
                activeTexture === 'glass' ? 0.55 : 1
              )}
            />
          )}
      </group>
    </group>
  );
};
