import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

export function useFlightTrail(enabled: boolean) {
  const trailRef = useRef<THREE.Vector3[]>([]);
  const [trailPoints, setTrailPoints] = useState<THREE.Vector3[]>([]);

  const recordTrailPosition = (position: THREE.Vector3) => {
    if (!enabled) return;
    if (
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y) ||
      !Number.isFinite(position.z)
    ) {
      return;
    }

    const next = position.clone();
    const trail = trailRef.current;
    const last = trail[trail.length - 1];
    if (!last || last.distanceToSquared(next) > 16000) {
      const nextTrail = [...trail, next].slice(-36);
      trailRef.current = nextTrail;
      setTrailPoints(nextTrail);
    }
  };

  useEffect(() => {
    if (!enabled) {
      trailRef.current = [];
      setTrailPoints([]);
    }
  }, [enabled]);

  return {
    recordTrailPosition,
    trailPoints,
  };
}
