import * as THREE from 'three';

const batch = new THREE.BatchedMesh(10, 100, 100, new THREE.MeshBasicMaterial());
const geom1 = new THREE.BufferGeometry();
geom1.setAttribute('position', new THREE.BufferAttribute(new Float32Array(30), 3));
geom1.setIndex(new THREE.BufferAttribute(new Uint16Array(30), 1));

const geomId = batch.addGeometry(geom1);
const instId = batch.addInstance(geomId);

console.log("Added geom1", geomId, instId);
console.log("Unused vertices:", batch.unusedVertexCount);

batch.deleteInstance(instId);
batch.deleteGeometry(geomId);

console.log("Deleted. Unused vertices:", batch.unusedVertexCount);

const geom2 = new THREE.BufferGeometry();
geom2.setAttribute('position', new THREE.BufferAttribute(new Float32Array(60), 3));
geom2.setIndex(new THREE.BufferAttribute(new Uint16Array(60), 1));

try {
  const geomId2 = batch.addGeometry(geom2);
  const instId2 = batch.addInstance(geomId2);
  console.log("Added geom2", geomId2, instId2);
  console.log("Unused vertices:", batch.unusedVertexCount);
} catch (e) {
  console.log("Failed to add geom2:", e.message);
  
  if (batch.optimize) {
     batch.optimize();
     console.log("Optimized. Unused vertices:", batch.unusedVertexCount);
     const geomId2 = batch.addGeometry(geom2);
     const instId2 = batch.addInstance(geomId2);
     console.log("Added geom2 after optimize", geomId2, instId2);
  }
}
