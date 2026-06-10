import { useMemo, useRef, useEffect } from 'react';
import { useStore } from '../stores/useStore';
import { useFlareStore } from '../stores/flareSlice';
import { useShallow } from 'zustand/react/shallow';
import * as THREE from 'three';

// ── Shared geometries (module-level, allocated once) ──────────────────────────
const STICK_GEO = new THREE.CylinderGeometry(0.045, 0.055, 0.6, 6);
const FLAME_GEO = new THREE.CylinderGeometry(0.0, 0.075, 0.14, 8); // cone tip
const EMBER_GEO = new THREE.SphereGeometry(0.06, 8, 6);

const STICK_MAT = new THREE.MeshLambertMaterial({ color: '#7a5230' }); // brown wood
const FLAME_MAT = new THREE.MeshBasicMaterial({ color: '#ff6600' }); // orange cone
const EMBER_MAT = new THREE.MeshBasicMaterial({ color: '#ffee22' }); // bright yellow tip

const MAX_FLARES = 5000;

export const Flares = () => {
  const flares = useFlareStore(useShallow((state) => state.placedFlares));

  const stickRef = useRef();
  const flameRef = useRef();
  const emberRef = useRef();

  const dummyStick = useMemo(() => new THREE.Object3D(), []);
  const dummyFlame = useMemo(() => new THREE.Object3D(), []);
  const dummyEmber = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    if (!stickRef.current || !flameRef.current || !emberRef.current) return;

    for (let i = 0; i < flares.length; i++) {
      const f = flares[i];
      const [nx, ny, nz] = f.normal;

      let rx = 0,
        ry = 0,
        rz = 0;
      if (ny > 0.5) {
        rx = 0;
      } else if (ny < -0.5) {
        rx = Math.PI;
      } else if (nx > 0.5) {
        rz = -Math.PI * 0.35;
      } else if (nx < -0.5) {
        rz = Math.PI * 0.35;
      } else if (nz > 0.5) {
        rx = Math.PI * 0.35;
      } else {
        rx = -Math.PI * 0.35;
      }

      const mx = f.pos[0] + nx * 0.06;
      const my = f.pos[1] + ny * 0.06;
      const mz = f.pos[2] + nz * 0.06;

      // Base rotation
      const euler = new THREE.Euler(rx, ry, rz);
      const quat = new THREE.Quaternion().setFromEuler(euler);

      // Stick Dummy
      dummyStick.position.set(mx, my, mz);
      dummyStick.quaternion.copy(quat);
      dummyStick.updateMatrix();
      stickRef.current.setMatrixAt(i, dummyStick.matrix);

      // Flame Dummy (offset Y=0.37 local)
      const fPos = new THREE.Vector3(0, 0.37, 0)
        .applyQuaternion(quat)
        .add(dummyStick.position);
      dummyFlame.position.copy(fPos);
      dummyFlame.quaternion.copy(quat);
      dummyFlame.updateMatrix();
      flameRef.current.setMatrixAt(i, dummyFlame.matrix);

      // Ember Dummy (offset Y=0.46 local)
      const ePos = new THREE.Vector3(0, 0.46, 0)
        .applyQuaternion(quat)
        .add(dummyStick.position);
      dummyEmber.position.copy(ePos);
      dummyEmber.quaternion.copy(quat);
      dummyEmber.updateMatrix();
      emberRef.current.setMatrixAt(i, dummyEmber.matrix);
    }

    stickRef.current.count = flares.length;
    flameRef.current.count = flares.length;
    emberRef.current.count = flares.length;

    stickRef.current.instanceMatrix.needsUpdate = true;
    flameRef.current.instanceMatrix.needsUpdate = true;
    emberRef.current.instanceMatrix.needsUpdate = true;
  }, [flares, dummyStick, dummyFlame, dummyEmber]);

  return (
    <group>
      <instancedMesh
        ref={stickRef}
        args={[STICK_GEO, STICK_MAT, MAX_FLARES]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={flameRef}
        args={[FLAME_GEO, FLAME_MAT, MAX_FLARES]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={emberRef}
        args={[EMBER_GEO, EMBER_MAT, MAX_FLARES]}
        frustumCulled={false}
      />
    </group>
  );
};
