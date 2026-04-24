import { useFrame } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { useMemo, useRef } from "react";
import * as THREE from "three";

type RapierDebugWorld = {
  debugRender?: () => {
    vertices?: Float32Array;
    colors?: Float32Array;
  };
};

export function RapierDebugLines() {
  const { world } = useRapier();
  const geomRef = useRef<THREE.BufferGeometry>(null);

  const lineMaterial = useMemo(() => {
    return new THREE.LineBasicMaterial({
      vertexColors: true,
      toneMapped: false,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
  }, []);

  const scratchColor = useRef<Float32Array | null>(null);

  useFrame(() => {
    const geom = geomRef.current;
    if (!geom) return;

    // Rapier exposes a debug renderer buffer.
    // The exact color format can vary (RGB or RGBA); we normalize to RGB for Three.
    const buffers = (world as RapierDebugWorld).debugRender?.();
    if (!buffers) return;

    const vertices: Float32Array | undefined = buffers.vertices;
    const colors: Float32Array | undefined = buffers.colors;
    if (!vertices || !colors) return;

    let rgbColors: Float32Array;
    if (colors.length === vertices.length) {
      // RGB per vertex.
      rgbColors = colors;
    } else if (colors.length === (vertices.length / 3) * 4) {
      // RGBA per vertex -> strip alpha.
      const needed = (vertices.length / 3) * 3;
      if (!scratchColor.current || scratchColor.current.length !== needed) {
        scratchColor.current = new Float32Array(needed);
      }
      const out = scratchColor.current;
      let o = 0;
      for (let i = 0; i < colors.length; i += 4) {
        const red = colors[i] ?? 1;
        const green = colors[i + 1] ?? 1;
        const blue = colors[i + 2] ?? 1;
        out[o++] = red;
        out[o++] = green;
        out[o++] = blue;
      }
      rgbColors = out;
    } else {
      // Unknown format; fall back to white.
      const needed = vertices.length;
      if (!scratchColor.current || scratchColor.current.length !== needed) {
        scratchColor.current = new Float32Array(needed);
      }
      scratchColor.current.fill(1);
      rgbColors = scratchColor.current;
    }

    geom.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(rgbColors, 3));
    geom.computeBoundingSphere();
  });

  return (
    <lineSegments frustumCulled={false}>
      <bufferGeometry ref={geomRef} />
      <primitive object={lineMaterial} attach="material" />
    </lineSegments>
  );
}
