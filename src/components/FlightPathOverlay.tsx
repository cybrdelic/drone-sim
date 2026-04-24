import * as THREE from "three";

interface FlightPathOverlayProps {
  flightPathLine: THREE.Line | null;
  waypoints: THREE.Vector3[];
}

export function FlightPathOverlay({
  flightPathLine,
  waypoints,
}: FlightPathOverlayProps) {
  if (waypoints.length === 0) {
    return null;
  }

  return (
    <group>
      {waypoints.length > 1 && flightPathLine ? (
        <primitive object={flightPathLine} dispose={null} />
      ) : null}
      {waypoints.map((waypoint, index) => (
        <mesh
          key={`${waypoint.x}-${waypoint.y}-${waypoint.z}-${index}`}
          position={[waypoint.x, Math.max(waypoint.y + 20, 20), waypoint.z]}
        >
          <sphereGeometry args={[3, 16, 16]} />
          <meshStandardMaterial
            color={index === 0 ? "#ffffff" : "#10b981"}
          />
        </mesh>
      ))}
    </group>
  );
}
