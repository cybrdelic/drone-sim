import { SimSettings } from "../../types";

export type NumericSimSettingKey = {
  [K in keyof SimSettings]: SimSettings[K] extends number ? K : never;
}[keyof SimSettings];

export interface NumericSimSettingRange {
  min: number;
  max: number;
}

export const simNumericSettingRanges: Partial<
  Record<NumericSimSettingKey, NumericSimSettingRange>
> = {
  ambientTempC: { min: -10, max: 45 },
  humidityPct: { min: 0, max: 100 },
  meanWindMS: { min: 0, max: 20 },
  gustAmplitudeMS: { min: 0, max: 10 },
  turbulenceMS: { min: 0, max: 5 },
  escLatencyMs: { min: 0, max: 120 },
  actuatorMismatchPct: { min: 0, max: 20 },
  sensorNoiseScale: { min: 0, max: 2 },
  gpsRateHz: { min: 1, max: 20 },
  motorCurrentLimitA: { min: 20, max: 220 },
  motorCoolingScale: { min: 0.3, max: 2 },
  buildWheelbaseMm: { min: 120, max: 350 },
  buildPropSizeIn: { min: 2.5, max: 8 },
  buildArmWidthMm: { min: 8, max: 25 },
  buildBottomPlateThicknessMm: { min: 2, max: 8 },
  buildTopPlateThicknessMm: { min: 1, max: 4 },
  buildStandoffHeightMm: { min: 15, max: 40 },
  buildFcMountMm: { min: 20, max: 30.5 },
  buildMotorMountPatternMm: { min: 9, max: 19 },
  buildMotorShaftHoleMm: { min: 4, max: 10 },
  buildBatteryMassG: { min: 40, max: 450 },
  buildMotorMassG: { min: 5, max: 80 },
  buildPropMassG: { min: 1, max: 12 },
  buildStackMassG: { min: 5, max: 60 },
  buildMiscMassG: { min: 0, max: 120 },
  manufacturingToleranceMm: { min: 0.01, max: 0.5 },
  materialDensityGcm3: { min: 1, max: 2.2 },
  materialElasticModulusGPa: { min: 20, max: 140 },
  materialYieldStrengthMPa: { min: 120, max: 1200 },
  materialBrittleStrainPct: { min: 0.2, max: 3 },
  impactFragilityScale: { min: 0.25, max: 3 },
  wireOuterDiameterMm: { min: 0.6, max: 4 },
  wiringBundleCount: { min: 1, max: 24 },
  wiringMinSpacingMm: { min: 1, max: 12 },
  wiringCurrentA: { min: 1, max: 180 },
  motorScrewClearanceMm: { min: 0.05, max: 1 },
  stackScrewClearanceMm: { min: 0.05, max: 1 },
  cameraTpuClearanceMm: { min: 0.1, max: 2 },
  antennaTubeClearanceMm: { min: 0.1, max: 2 },
  stackHeightMm: { min: 4, max: 30 },
  armFractureForceN: { min: 80, max: 2000 },
  motorDamageForceN: { min: 40, max: 1200 },
  batteryDamageForceN: { min: 60, max: 1600 },
  buildMotorKV: { min: 500, max: 4200 },
  buildBatteryCells: { min: 3, max: 8 },
  buildPropPitchIn: { min: 2, max: 8 },
  buildPackResistanceMilliOhm: { min: 4, max: 80 },
  rotorInertiaScale: { min: 0.35, max: 3 },
  acroRateDegPerSec: { min: 360, max: 1400 },
  acroExpo: { min: 0, max: 0.75 },
  airmodeStrength: { min: 0, max: 1 },
  propWashCoupling: { min: 0, max: 1 },
  betaflightRcRate: { min: 0.01, max: 3 },
  betaflightSuperRate: { min: 0, max: 0.95 },
  betaflightExpo: { min: 0, max: 0.95 },
  betaflightYawRcRate: { min: 0.01, max: 3 },
  betaflightYawSuperRate: { min: 0, max: 0.95 },
  betaflightYawExpo: { min: 0, max: 0.95 },
  throttleMid01: { min: 0.05, max: 0.95 },
  throttleExpo: { min: 0, max: 0.95 },
  sensorLogSeconds: { min: 10, max: 180 },
};

export function clampSimNumericSetting<K extends NumericSimSettingKey>(
  key: K,
  value: number,
) {
  const range = simNumericSettingRanges[key];
  if (!range) return value;
  return Math.min(range.max, Math.max(range.min, value));
}
