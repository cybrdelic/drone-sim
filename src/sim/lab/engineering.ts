import * as THREE from "three";
import { DroneParams, SimSettings } from "../../types";

export function computeHarnessBundleDiameterMm(
  wireOuterDiameterMm: number,
  wiringBundleCount: number,
) {
  const wireDiameter = Math.max(0.4, wireOuterDiameterMm);
  const wireCount = Math.max(1, Math.round(wiringBundleCount));
  const packingFactor = 0.7;
  return wireDiameter * Math.sqrt(wireCount / packingFactor);
}

export function computeHarnessConductorsPerArm(wiringBundleCount: number) {
  return Math.max(1, Math.ceil(Math.max(1, wiringBundleCount) / 4));
}

export function computeDroneEngineeringData(
  params: DroneParams,
  simSettings: SimSettings,
) {
  const armLength = params.frameSize / 2;
  const centerRadius = params.fcMounting / 2 + 10;

  const centerVol = Math.PI * centerRadius * centerRadius * params.plateThickness;
  const armVol = 4 * params.armWidth * armLength * params.plateThickness * 0.82;
  const topPlateVol = (params.fcMounting + 12) * (params.fcMounting + 30) * params.topPlateThickness;
  const cutoutVol =
    armLength *
    0.5 *
    (params.armWidth * (params.weightReduction / 100) * 0.7) *
    params.plateThickness;
  const motorHoleVol =
    4 * Math.PI * Math.pow(params.motorCenterHole / 2, 2) * params.plateThickness;
  const totalCarbonVolMm3 = centerVol + armVol + topPlateVol - cutoutVol - motorHoleVol;
  const densityGPerMm3 = Math.max(0.8, simSettings.materialDensityGcm3) / 1000;
  const frameWeightG = Math.max(10, totalCarbonVolMm3 * densityGPerMm3);

  const motorWeightG = simSettings.buildMotorMassG;
  const batteryWeightG = simSettings.buildBatteryMassG;
  const stackWeightG = simSettings.buildStackMassG;
  const propWeightG = simSettings.buildPropMassG;
  const miscWeightG = simSettings.buildMiscMassG;

  const auwG =
    frameWeightG +
    motorWeightG * 4 +
    batteryWeightG +
    stackWeightG +
    propWeightG * 4 +
    miscWeightG;

  const kvFactor = Math.pow(simSettings.buildMotorKV / 1950, 0.34);
  const cellFactor = Math.pow(simSettings.buildBatteryCells / 6, 1.04);
  const pitchFactor = Math.pow(simSettings.buildPropPitchIn / 4.3, 0.52);
  const propFactor = Math.pow(params.propSize / 5.1, 2.7);
  const thrustPerMotorG = Math.max(120, 760 * kvFactor * cellFactor * pitchFactor * propFactor);
  const totalThrustG = thrustPerMotorG * 4;
  const twRatio = totalThrustG / Math.max(1, auwG);
  const hoverThrottle = (auwG / Math.max(1, totalThrustG)) * 100;

  const forceN = (thrustPerMotorG / 1000) * 9.81;
  const momentNmm = forceN * armLength;
  const sectionModulusMm3 = Math.max(
    1,
    (params.armWidth * Math.pow(params.plateThickness, 2)) / 6,
  );
  const maxStressMPa = momentNmm / sectionModulusMm3;
  const safetyFactor = Math.max(0, simSettings.materialYieldStrengthMPa / Math.max(1e-6, maxStressMPa));

  const elasticModulusMPa = Math.max(1000, simSettings.materialElasticModulusGPa * 1000);
  const secondMomentMm4 = Math.max(1, (params.armWidth * Math.pow(params.plateThickness, 3)) / 12);
  const tipDeflectionMm =
    (forceN * Math.pow(armLength, 3)) /
    Math.max(1e-6, 3 * elasticModulusMPa * secondMomentMm4);
  const peakStrainPct = (maxStressMPa / elasticModulusMPa) * 100;
  const brittleRiskPct = THREE.MathUtils.clamp(
    (peakStrainPct / Math.max(0.05, simSettings.materialBrittleStrainPct)) *
      simSettings.impactFragilityScale *
      100,
    0,
    100,
  );

  const toleranceStackMm = simSettings.manufacturingToleranceMm * Math.sqrt(8);
  const harnessConductorsPerArm = computeHarnessConductorsPerArm(
    simSettings.wiringBundleCount,
  );
  const harnessBundleDiameterMm = computeHarnessBundleDiameterMm(
    simSettings.wireOuterDiameterMm,
    harnessConductorsPerArm,
  );
  const harnessChannelWidthMm = Math.max(2, params.armWidth * 0.58 - toleranceStackMm);
  const wiringMarginMm =
    harnessChannelWidthMm - harnessBundleDiameterMm - simSettings.wiringMinSpacingMm;
  const wireAreaMm2 = Math.PI * Math.pow(Math.max(0.2, simSettings.wireOuterDiameterMm * 0.5), 2);
  const wiringCurrentDensityAmm2 = simSettings.wiringCurrentA / Math.max(1e-6, wireAreaMm2);

  return {
    frameWeight_g: frameWeightG,
    auw_g: auwG,
    totalThrust_g: totalThrustG,
    twRatio,
    hoverThrottle,
    maxStress_MPa: maxStressMPa,
    safetyFactor,
    tipDeflection_mm: tipDeflectionMm,
    peakStrain_pct: peakStrainPct,
    brittleRisk_pct: brittleRiskPct,
    toleranceStack_mm: toleranceStackMm,
    harnessConductorsPerArm,
    harnessBundleDiameter_mm: harnessBundleDiameterMm,
    harnessChannelWidth_mm: harnessChannelWidthMm,
    wiringMargin_mm: wiringMarginMm,
    wiringCurrentDensity_Amm2: wiringCurrentDensityAmm2,
  };
}
