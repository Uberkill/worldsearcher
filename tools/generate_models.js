import fs from 'fs';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

global.window = global;
global.Blob = class Blob {
  constructor(parts, options) { this.parts = parts; this.type = options?.type || ''; }
};
global.FileReader = class FileReader {
  readAsDataURL(blob) {
    let buf = Buffer.concat(blob.parts.map(p => Buffer.isBuffer(p) ? p : Buffer.from(p)));
    this.result = `data:${blob.type};base64,` + buf.toString('base64');
    if (this.onload) this.onload({ target: this });
  }
};
global.document = {
  createElement: (tag) => {
    if (tag === 'canvas') {
      return {
        width: 1, height: 1,
        getContext: () => ({
          fillRect: () => {},
          getImageData: () => ({ data: new Uint8Array(4) }),
          putImageData: () => {},
          drawImage: () => {}
        }),
        toDataURL: () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg=='
      };
    }
  }
};

const exporter = new GLTFExporter();

function exportGLTF(scene, filename) {
  return new Promise((resolve, reject) => {
    try {
      exporter.parse(
        scene,
        function ( gltf ) {
          fs.writeFileSync(filename, JSON.stringify(gltf, null, 2));
          console.log(`Successfully exported ${filename}`);
          resolve();
        },
        function ( error ) {
          console.error(`Error exporting ${filename}:`, error);
          reject(error);
        },
        { binary: false }
      );
    } catch (e) {
      console.error(e);
      reject(e);
    }
  });
}

async function main() {
  if (!fs.existsSync('public/models')) {
     fs.mkdirSync('public/models', { recursive: true });
  }

  try {
    // 1. Sword (Vibro-Blade / Laser Sword)
    const swordScene = new THREE.Scene();
    const swordHilt = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.1), new THREE.MeshStandardMaterial({color: 0x333333}));
    swordHilt.position.y = -0.15;
    const swordBlade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.8, 0.08), new THREE.MeshStandardMaterial({color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 0.5}));
    swordBlade.position.y = 0.4;
    swordScene.add(swordHilt);
    swordScene.add(swordBlade);
    await exportGLTF(swordScene, 'public/models/sword.gltf');

    // 2. Gun (Pulse Rifle)
    const gunScene = new THREE.Scene();
    const gunBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.6), new THREE.MeshStandardMaterial({color: 0x444444}));
    gunBarrel.position.z = -0.2;
    const gunHandle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.25, 0.12), new THREE.MeshStandardMaterial({color: 0x222222}));
    gunHandle.position.set(0, -0.125, 0.05);
    gunHandle.rotation.x = -0.2;
    gunScene.add(gunBarrel);
    gunScene.add(gunHandle);
    await exportGLTF(gunScene, 'public/models/gun.gltf');

    // 3. Pickaxe (Laser Drill)
    const pickScene = new THREE.Scene();
    const pickHandle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.8, 0.08), new THREE.MeshStandardMaterial({color: 0x555555}));
    const pickHead = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.1), new THREE.MeshStandardMaterial({color: 0xffaa00, emissive: 0xffaa00, emissiveIntensity: 0.5}));
    pickHead.position.y = 0.35;
    pickScene.add(pickHandle);
    pickScene.add(pickHead);
    await exportGLTF(pickScene, 'public/models/pickaxe.gltf');

    // 4. Lantern (Sci-fi Torch Light)
    const lanternScene = new THREE.Scene();
    const lanternBody = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 0.2), new THREE.MeshStandardMaterial({color: 0xffaa00, emissive: 0xffaa00, emissiveIntensity: 0.8}));
    const lanternTop = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.05, 0.25), new THREE.MeshStandardMaterial({color: 0x222222}));
    lanternTop.position.y = 0.225;
    const lanternBot = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.05, 0.25), new THREE.MeshStandardMaterial({color: 0x222222}));
    lanternBot.position.y = -0.225;
    lanternScene.add(lanternBody);
    lanternScene.add(lanternTop);
    lanternScene.add(lanternBot);
    await exportGLTF(lanternScene, 'public/models/lantern.gltf');
    
    console.log("All models exported successfully.");
  } catch (e) {
    console.error("Failed main:", e);
  }
}

main();
