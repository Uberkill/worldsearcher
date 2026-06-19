import React from 'react';
import { useStore } from '../stores/useStore';
import { useUIStore } from '../stores/useUIStore';

export const ShipyardHologram = () => {
  const isShipyardUIOpen = useUIStore((state) => state.activeModal === 'SHIPYARD');
  const corePos = useStore((state) => state.shipyardCorePos);

  if (!isShipyardUIOpen || !corePos) return null;

  return (
    <mesh position={[corePos[0] - 0.5, corePos[1] - 0.5, corePos[2] - 0.5]}>
       <boxGeometry args={[32, 32, 32]} />
       <meshBasicMaterial color="#22d3ee" wireframe transparent opacity={0.4} depthTest={false} />
    </mesh>
  );
};
