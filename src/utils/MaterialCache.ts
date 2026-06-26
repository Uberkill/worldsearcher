// @ts-nocheck
import * as THREE from 'three';

/**
 * Universal Material Cache
 * Prevents React Three Fiber from generating duplicate WebGL Materials
 * which ruins draw call batching and triggers unnecessary texture state swaps.
 */
class ECSMaterialCache {
  constructor() {
    this.cache = new Map();
  }

  /**
   * Retrieves or creates a MeshStandardMaterial
   */
  getStandard(colorHex, transparent = false, opacity = 1) {
    const key = `std_${colorHex}_${transparent}_${opacity}`;
    if (!this.cache.has(key)) {
      this.cache.set(
        key,
        new THREE.MeshStandardMaterial({
          color: colorHex,
          transparent: transparent,
          opacity: opacity,
          depthWrite: !transparent,
        })
      );
    }
    return this.cache.get(key);
  }

  /**
   * Retrieves or creates a MeshBasicMaterial
   */
  getBasic(
    colorHex,
    visible = true,
    transparent = false,
    opacity = 1,
    wireframe = false
  ) {
    const key = `bas_${colorHex}_${visible}_${transparent}_${opacity}_${wireframe}`;
    if (!this.cache.has(key)) {
      this.cache.set(
        key,
        new THREE.MeshBasicMaterial({
          color: colorHex,
          visible: visible,
          transparent: transparent,
          opacity: opacity,
          wireframe: wireframe,
        })
      );
    }
    return this.cache.get(key);
  }

  /**
   * Retrieves or creates a MeshLambertMaterial
   */
  getLambert(colorHex, transparent = false, opacity = 1) {
    const key = `lam_${colorHex}_${transparent}_${opacity}`;
    if (!this.cache.has(key)) {
      this.cache.set(
        key,
        new THREE.MeshLambertMaterial({
          color: colorHex,
          transparent: transparent,
          opacity: opacity,
        })
      );
    }
    return this.cache.get(key);
  }
}

export const MaterialCache = new ECSMaterialCache();
