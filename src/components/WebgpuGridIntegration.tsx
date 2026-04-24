import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import * as THREE from "three";

/**
 * Lightweight in-repo showroom environment.
 *
 * This replaces the old sibling-repo `webgpu-grid` dependency so the project
 * stays self-contained while preserving a clean presentation surface for
 * non-flight inspection modes.
 */
export function WebgpuGridIntegration({
  unitScale = 1000,
}: {
  unitScale?: number;
}) {
  const scene = useThree((state) => state.scene);
  const floorSize = unitScale * 24;
  const fogNear = unitScale * 4;
  const fogFar = unitScale * 18;

  useEffect(() => {
    const previousFog = scene.fog;
    const fog = new THREE.Fog("#d8e0ea", fogNear, fogFar);
    scene.fog = fog;

    return () => {
      if (scene.fog === fog) {
        scene.fog = previousFog ?? null;
      }
    };
  }, [fogFar, fogNear, scene]);

  return (
    <group>
      <ambientLight intensity={0.82} color="#f6fbff" />
      <hemisphereLight
        intensity={0.58}
        color="#f8fbff"
        groundColor="#7c8ea3"
      />
      <directionalLight
        castShadow
        color="#eef6ff"
        intensity={1.9}
        position={[3600, 6200, 2600]}
        shadow-mapSize-width={1536}
        shadow-mapSize-height={1536}
      />
      <directionalLight
        intensity={0.8}
        color="#dce8f6"
        position={[-2400, 2800, -1600]}
      />
      <mesh
        receiveShadow
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.02, 0]}
      >
        <planeGeometry args={[floorSize, floorSize]} />
        <meshStandardMaterial
          color="#dde5ee"
          roughness={0.94}
          metalness={0.03}
        />
      </mesh>
      <gridHelper
        args={[floorSize, 64, "#8ea0b5", "#c4d0dd"]}
        position={[0, 0.1, 0]}
      />
    </group>
  );
}
