import { useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';
import { networkActions } from '../stores/networkActions';
import { useSyncStore } from '../stores/syncSlice';

export const Waypoints = () => {
  const waypoints = useSyncStore((state) => state.waypoints);
  const [activeWaypoints, setActiveWaypoints] = useState([]);
  const { camera } = useThree();

  useFrame(() => {
    const now = Date.now();
    const valid = waypoints.filter((w) => now - w.timestamp < 10000);

    if (valid.length !== activeWaypoints.length) {
      setActiveWaypoints(valid);
    } else {
      let changed = false;
      for (let i = 0; i < valid.length; i++) {
        if (
          valid[i].id !== activeWaypoints[i]?.id ||
          valid[i].timestamp !== activeWaypoints[i]?.timestamp
        ) {
          changed = true;
          break;
        }
      }
      if (changed) setActiveWaypoints(valid);
    }
  });

  return (
    <group>
      {activeWaypoints.map((w) => (
        <WaypointMarker
          key={`${w.id}-${w.timestamp}`}
          waypoint={w}
          camera={camera}
        />
      ))}
    </group>
  );
};

const WaypointMarker = ({ waypoint, camera }) => {
  const meshRef = useRef();
  const [distance, setDistance] = useState(0);
  const [opacity, setOpacity] = useState(1);

  useFrame(() => {
    if (meshRef.current) {
      const dist = camera.position.distanceTo(meshRef.current.position);
      setDistance(Math.round(dist));
      const scale = Math.max(1, dist / 15);
      meshRef.current.scale.set(scale, scale, scale);
    }

    const age = Date.now() - waypoint.timestamp;
    if (age > 8000) {
      setOpacity(Math.max(0, 1 - (age - 8000) / 2000));
    } else {
      setOpacity(1);
    }
  });

  return (
    <Billboard
      ref={meshRef}
      position={[waypoint.x, waypoint.y + 0.5, waypoint.z]}
    >
      <Text
        position={[0, 0.4, 0]}
        fontSize={0.5}
        color={waypoint.color}
        outlineWidth={0.05}
        outlineColor="black"
        anchorX="center"
        anchorY="middle"
        depthTest={false}
        fillOpacity={opacity}
        outlineOpacity={opacity}
      >
        ▼
      </Text>
      <Text
        position={[0, -0.1, 0]}
        fontSize={0.25}
        color={waypoint.color}
        outlineWidth={0.03}
        outlineColor="black"
        anchorX="center"
        anchorY="middle"
        depthTest={false}
        fillOpacity={opacity}
        outlineOpacity={opacity}
      >
        {distance}m
      </Text>
    </Billboard>
  );
};
