/**
 * Centralized Resource Manager
 * Enforces strict disposal of Three.js Geometries and Materials to prevent VRAM memory leaks.
 */

class ResourceManager {
  constructor() {
    this.geometries = new Map();
    this.materials = new Map();
    this.textures = new Map();
  }

  /**
   * Register a geometry to an owner (e.g., chunk coordinate '0,0' or entity ID)
   */
  registerGeometry(ownerId, geometry) {
    if (!this.geometries.has(ownerId)) {
      this.geometries.set(ownerId, new Set());
    }
    this.geometries.get(ownerId).add(geometry);
  }

  /**
   * Register a material to an owner
   */
  registerMaterial(ownerId, material) {
    if (!this.materials.has(ownerId)) {
      this.materials.set(ownerId, new Set());
    }
    this.materials.get(ownerId).add(material);
  }

  /**
   * Dispose all resources associated with a specific owner.
   * This MUST be called when chunks or entities are unmounted.
   */
  disposeOwner(ownerId) {
    // Dispose Geometries
    if (this.geometries.has(ownerId)) {
      this.geometries.get(ownerId).forEach(geo => {
        if (geo) {
          // Clear WebGL attributes
          for (const key in geo.attributes) {
            if (geo.attributes[key].array) {
               // Hint V8 to garbage collect
            }
          }
          geo.dispose();
        }
      });
      this.geometries.delete(ownerId);
    }

    // Dispose Materials
    if (this.materials.has(ownerId)) {
      this.materials.get(ownerId).forEach(mat => {
        if (mat) {
          mat.dispose();
        }
      });
      this.materials.delete(ownerId);
    }
  }

  /**
   * Debugging: Audit total managed resources
   */
  getStats() {
    let geoCount = 0;
    this.geometries.forEach(set => { geoCount += set.size; });
    
    let matCount = 0;
    this.materials.forEach(set => { matCount += set.size; });

    return { geometries: geoCount, materials: matCount };
  }
}

export const resourceManager = new ResourceManager();
