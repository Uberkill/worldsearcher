import * as THREE from 'three';

// Global shared frustums to prevent GC allocation and avoid breaking React Fast Refresh
export const globalFrustum = new THREE.Frustum();
export const weatherFrustum = new THREE.Frustum();
