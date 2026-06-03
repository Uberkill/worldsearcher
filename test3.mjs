import * as THREE from 'three';

const batch = new THREE.BatchedMesh(10, 100, 100, new THREE.MeshBasicMaterial());
const geom1 = new THREE.BufferGeometry();
geom1.setAttribute('position', new THREE.BufferAttribute(new Float32Array(30), 3));
geom1.setIndex(new THREE.BufferAttribute(new Uint16Array(30), 1));

const geomId = batch.addGeometry(geom1);
const instId = batch.addInstance(geomId);

console.log("Added geom1", geomId, instId);

const box1 = batch.getBoundingBoxAt(geomId, new THREE.Box3());
console.log("Box1 before delete:", box1);

batch.deleteInstance(instId);
// batch.deleteGeometry(geomId);

const box2 = batch.getBoundingBoxAt(geomId, new THREE.Box3());
console.log("Box1 after deleteInstance:", box2);

console.log("Is active?", batch.getVisibleAt(instId));
