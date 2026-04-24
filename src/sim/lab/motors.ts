import * as THREE from "three";

export function buildMotorHealthScales(actuatorMismatchPct: number) {
  const spread = THREE.MathUtils.clamp(actuatorMismatchPct, 0, 25) * 0.01;
  return [
    1 - spread * 0.85,
    1 + spread * 0.55,
    1 - spread * 0.35,
    1 + spread,
  ].map((value) => THREE.MathUtils.clamp(value, 0.65, 1.35));
}
