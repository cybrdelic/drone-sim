import * as THREE from "three";

export type FlightPathPresetId = "oval" | "figure8" | "corkscrew" | "loop";

export function createFlightPathPresets(frameSize: number): Record<FlightPathPresetId, THREE.Vector3[]> {
  const radiusMm = Math.max(300, frameSize * 2);
  const heightMm = Math.max(250, frameSize * 1.2);

  const makeOval = () => {
    const points: THREE.Vector3[] = [];
    const steps = 36;
    const radiusX = radiusMm * 1.2;
    const radiusZ = radiusMm * 0.8;
    for (let index = 0; index <= steps; index++) {
      const theta = (index / steps) * Math.PI * 2;
      points.push(
        new THREE.Vector3(
          Math.cos(theta) * radiusX,
          220,
          Math.sin(theta) * radiusZ,
        ),
      );
    }
    return points;
  };

  const makeFigure8 = () => {
    const points: THREE.Vector3[] = [];
    const steps = 60;
    for (let index = 0; index <= steps; index++) {
      const theta = (index / steps) * Math.PI * 2;
      const denominator = 1 + Math.sin(theta) * Math.sin(theta);
      const x = (radiusMm * Math.cos(theta)) / denominator;
      const z =
        (radiusMm * Math.sin(theta) * Math.cos(theta)) / denominator;
      points.push(new THREE.Vector3(x * 1.6, 240, z * 2.2));
    }
    return points;
  };

  const makeCorkscrew = () => {
    const points: THREE.Vector3[] = [];
    const turns = 2.5;
    const steps = 80;
    for (let index = 0; index <= steps; index++) {
      const theta = (index / steps) * Math.PI * 2 * turns;
      const y = 140 + (index / steps) * heightMm;
      points.push(
        new THREE.Vector3(
          Math.cos(theta) * radiusMm,
          y,
          Math.sin(theta) * radiusMm,
        ),
      );
    }
    return points;
  };

  const makeVerticalLoop = () => {
    const points: THREE.Vector3[] = [];
    const steps = 44;
    const loopRadiusMm = Math.max(220, radiusMm * 0.75);
    for (let index = 0; index <= steps; index++) {
      const theta = (index / steps) * Math.PI * 2;
      const y = 200 + Math.sin(theta) * loopRadiusMm;
      const z = -radiusMm * 0.6 + Math.cos(theta) * loopRadiusMm;
      points.push(new THREE.Vector3(0, Math.max(40, y), z));
    }
    return points;
  };

  return {
    oval: makeOval(),
    figure8: makeFigure8(),
    corkscrew: makeCorkscrew(),
    loop: makeVerticalLoop(),
  };
}

export function createFlightPathPoints(
  waypoints: readonly THREE.Vector3[],
): THREE.Vector3[] {
  if (waypoints.length < 2) {
    return [];
  }

  return waypoints.map(
    (point) =>
      new THREE.Vector3(point.x, Math.max(point.y + 20, 20), point.z),
  );
}

export function createFlightPathLine(
  points: readonly THREE.Vector3[],
): THREE.Line | null {
  if (points.length < 2) {
    return null;
  }

  const geometry = new THREE.BufferGeometry().setFromPoints(Array.from(points));
  const material = new THREE.LineBasicMaterial({ color: "#10b981" });
  return new THREE.Line(geometry, material);
}

export function disposeFlightPathLine(line: THREE.Line | null) {
  if (!line) {
    return;
  }

  line.geometry.dispose();
  if (Array.isArray(line.material)) {
    for (const material of line.material) {
      material.dispose();
    }
    return;
  }

  line.material.dispose();
}
