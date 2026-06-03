import fs from 'fs';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

// Polyfills for DOM APIs required by GLTFExporter
global.window = global;
global.Blob = class Blob {
  constructor(parts, options) { this.parts = parts; this.type = options?.type || ''; }
};
global.FileReader = class FileReader {
  readAsDataURL(blob) {
    setTimeout(() => {
      let buf = Buffer.concat(blob.parts.map(p => Buffer.isBuffer(p) ? p : Buffer.from(p)));
      this.result = `data:${blob.type};base64,` + buf.toString('base64');
      if (this.onload) this.onload({ target: this });
    }, 0);
  }
};

const scene = new THREE.Scene();
const geometry = new THREE.BoxGeometry( 1, 1, 1 );
const material = new THREE.MeshStandardMaterial( { color: 0x00ff00 } );
const cube = new THREE.Mesh( geometry, material );
scene.add( cube );

const exporter = new GLTFExporter();
exporter.parse(
	scene,
	function ( gltf ) {
		fs.writeFileSync('test.gltf', JSON.stringify(gltf, null, 2));
		console.log('Success!');
	},
	function ( error ) {
		console.error( 'An error happened:', error );
	},
	{ binary: false } // Export as JSON string (.gltf)
);
