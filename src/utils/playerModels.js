import * as THREE from 'three';

// Shared geometries and materials for multiplayer avatars (O(1) memory)
export const BODY_GEO = new THREE.BoxGeometry(0.6, 0.7, 0.4);
export const HEAD_GEO = new THREE.BoxGeometry(0.5, 0.5, 0.5);
export const LIMB_GEO = new THREE.BoxGeometry(0.2, 0.7, 0.2);
export const VISOR_GEO = new THREE.BoxGeometry(0.4, 0.15, 0.05);

export const BODY_MAT = new THREE.MeshStandardMaterial({ color: '#445566' });
export const HEAD_MAT = new THREE.MeshStandardMaterial({ color: '#ffccaa' });
export const VISOR_MAT = new THREE.MeshBasicMaterial({ color: '#00ffff' });
