import * as THREE from "three";
import { EnvironmentPreset } from "../../types";

export function evaluateAtmosphere(
  altitudeM: number,
  ambientTempC: number,
  humidityPct: number,
) {
  const clampedAltitude = Math.max(0, altitudeM);
  const seaLevelTempK = 288.15 + (ambientTempC - 15);
  const lapseRate = 0.0065;
  const tempK = Math.max(180, seaLevelTempK - lapseRate * clampedAltitude);
  const pressurePa = 101325 * Math.pow(tempK / seaLevelTempK, 5.25588);

  const saturationVaporPa = 610.94 * Math.exp((17.625 * ambientTempC) / (ambientTempC + 243.04));
  const vaporPa = THREE.MathUtils.clamp(humidityPct, 0, 100) * 0.01 * saturationVaporPa;
  const dryPa = Math.max(1, pressurePa - vaporPa);
  const densityKgM3 = dryPa / (287.05 * tempK) + vaporPa / (461.495 * tempK);

  return {
    temperatureC: tempK - 273.15,
    pressurePa,
    densityKgM3,
  };
}

export function computeWindField({
  preset,
  timeSec,
  positionM,
  meanWindMS,
  gustAmplitudeMS,
  turbulenceMS,
  phases,
}: {
  preset: EnvironmentPreset;
  timeSec: number;
  positionM: THREE.Vector3;
  meanWindMS: number;
  gustAmplitudeMS: number;
  turbulenceMS: number;
  phases: number[];
}) {
  const baseHeadingDeg =
    preset === "wind_tunnel" ? 0 : preset === "field_gusty" ? 42 : 18;
  const headingRad = THREE.MathUtils.degToRad(baseHeadingDeg);
  const baseDir = new THREE.Vector3(Math.sin(headingRad), 0, Math.cos(headingRad));
  const phase0 = phases[0] ?? 0;
  const phase1 = phases[1] ?? 0;
  const phase2 = phases[2] ?? 0;

  const gustBias = preset === "wind_tunnel" ? 0.35 : preset === "field_gusty" ? 1.15 : 0.65;
  const turbulenceBias = preset === "wind_tunnel" ? 0.45 : preset === "field_gusty" ? 1.3 : 0.7;
  const gustMS = gustAmplitudeMS * gustBias * (
    0.55 * Math.sin(timeSec * 0.31 + phase0) +
    0.45 * Math.sin(timeSec * 0.83 + phase1)
  );

  const tx = turbulenceMS * turbulenceBias * (
    0.55 * Math.sin(timeSec * 1.9 + positionM.z * 0.14 + phase0) +
    0.25 * Math.sin(timeSec * 4.6 + positionM.x * 0.21 + phase1)
  );
  const ty = turbulenceMS * 0.18 * (
    0.4 * Math.sin(timeSec * 1.2 + positionM.x * 0.16 + phase2)
  );
  const tz = turbulenceMS * turbulenceBias * (
    0.52 * Math.sin(timeSec * 1.6 + positionM.x * 0.17 + phase2) +
    0.22 * Math.sin(timeSec * 3.8 + positionM.z * 0.24 + phase0)
  );

  const meanWind = baseDir.multiplyScalar(Math.max(0, meanWindMS + gustMS));
  const turbulence = new THREE.Vector3(tx, ty, tz);

  return {
    velocityWorld: meanWind.add(turbulence),
    gustMS: Math.abs(gustMS),
  };
}

export function pressureToAltitudeM(pressurePa: number, ambientTempC: number) {
  const seaLevelTempK = 288.15 + (ambientTempC - 15);
  const normalized = Math.max(1e-6, pressurePa / 101325);
  return Math.max(0, (1 - Math.pow(normalized, 1 / 5.25588)) * (seaLevelTempK / 0.0065));
}

export function magneticFieldWorldVector() {
  const declinationRad = THREE.MathUtils.degToRad(7);
  const inclinationRad = THREE.MathUtils.degToRad(58);
  const horizontal = Math.cos(inclinationRad);
  return new THREE.Vector3(
    Math.sin(declinationRad) * horizontal,
    -Math.sin(inclinationRad),
    Math.cos(declinationRad) * horizontal,
  ).normalize();
}
