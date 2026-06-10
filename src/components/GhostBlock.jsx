import { useStore } from '../stores/useStore';
import { Edges } from '@react-three/drei';
import { MaterialCache } from '../utils/MaterialCache';

export const GhostBlock = () => {
  const hoverTarget = useStore((state) => state.hoverTarget);
  if (!hoverTarget) return null;

  return (
    <mesh
      position={[
        hoverTarget[0] + 0.5,
        hoverTarget[1] + 0.5,
        hoverTarget[2] + 0.5,
      ]}
      raycast={() => null}
      material={MaterialCache.getBasic('#ffffff', false)}
    >
      <boxGeometry args={[1.005, 1.005, 1.005]} />
      <Edges linewidth={2} color="black" transparent opacity={0.5} />
    </mesh>
  );
};
