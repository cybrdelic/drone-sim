import * as THREE from "three";
import { SimSettings } from "../../types";

export interface PropulsionModel {
  airDensityKgM3: number;
  diameterM: number;
  propPitchIn: number;
  Ct0: number;
  Cq0: number;
  motorKV: number;
  batteryCells: number;
  vOpenPerCell: number;
  packRintOhm: number;
  motorEff: number;
  motorTauSec: number;
  rotorInertiaScale: number;
  rotorInertiaKgM2: number;
  motorHeatFraction: number;
  motorThermalCapacityJPerC: number;
  motorThermalLeakPerSec: number;
  thermalSoftLimitC: number;
  thermalHardLimitC: number;
  staticMisalignDeg: number;
  flexRadPerN: number;
  flexTauSec: number;
  imuRateNoiseStdRad: number;
  vibRateAmpRad: number;
}

export function buildPropulsionModel(
  propSize: number,
  simSettings: SimSettings,
): PropulsionModel {
  const airDensityKgM3 = 1.225;
  const diameterM = propSize * 0.0254;

  const propPitchIn = THREE.MathUtils.clamp(
    simSettings.buildPropPitchIn,
    2,
    Math.max(3.2, propSize * 1.25),
  );
  const pitchM = propPitchIn * 0.0254;
  const pitchRatio = diameterM > 1e-6 ? pitchM / diameterM : 0.4;

  const Ct0 = THREE.MathUtils.clamp(0.08 + 0.08 * (pitchRatio - 0.4), 0.06, 0.16);
  const Cq0 = THREE.MathUtils.clamp(Ct0 * 0.09, 0.005, 0.03);
  const motorKV = THREE.MathUtils.clamp(
    simSettings.buildMotorKV,
    500,
    propSize >= 7 ? 2400 : 4200,
  );
  const batteryCells = Math.round(THREE.MathUtils.clamp(simSettings.buildBatteryCells, 3, 8));
  const vOpenPerCell = 3.85;
  const packRintOhm = THREE.MathUtils.clamp(
    simSettings.buildPackResistanceMilliOhm,
    4,
    80,
  ) * 1e-3;
  const motorEff = 0.85;
  const rotorInertiaScale = THREE.MathUtils.clamp(simSettings.rotorInertiaScale, 0.35, 3);
  const motorBellInertiaKgM2 = propSize >= 5 ? 2.2e-6 : 1.1e-6;
  const propBladeMassKg = THREE.MathUtils.lerp(0.0012, 0.0048, THREE.MathUtils.clamp((propSize - 3) / 4, 0, 1));
  const propInertiaKgM2 = 0.5 * propBladeMassKg * Math.pow(diameterM * 0.46, 2);
  const rotorInertiaKgM2 = (motorBellInertiaKgM2 + propInertiaKgM2) * rotorInertiaScale;
  const motorTauSec = THREE.MathUtils.clamp(0.022 + rotorInertiaScale * 0.02, 0.018, 0.11);

  return {
    airDensityKgM3,
    diameterM,
    propPitchIn,
    Ct0,
    Cq0,
    motorKV,
    batteryCells,
    vOpenPerCell,
    packRintOhm,
    motorEff,
    motorTauSec,
    rotorInertiaScale,
    rotorInertiaKgM2,
    motorHeatFraction: 0.22,
    motorThermalCapacityJPerC: propSize >= 5 ? 42 : 22,
    motorThermalLeakPerSec: 0.085,
    thermalSoftLimitC: 82,
    thermalHardLimitC: 118,
    staticMisalignDeg: 0,
    flexRadPerN: propSize >= 5 ? 0.00035 : 0.0006,
    flexTauSec: 0.08,
    imuRateNoiseStdRad: 0.03,
    vibRateAmpRad: 0.22,
  };
}
