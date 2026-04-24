import { DroneParams, SimSettings } from "../../types";
import { defaultParams, defaultSimSettings } from "./defaults";

export function deriveParamsFromBuild(
  simSettings: SimSettings,
  prevParams: DroneParams = defaultParams,
): DroneParams {
  return {
    ...prevParams,
    frameSize: simSettings.buildWheelbaseMm,
    propSize: simSettings.buildPropSizeIn,
    armWidth: simSettings.buildArmWidthMm,
    plateThickness: simSettings.buildBottomPlateThicknessMm,
    topPlateThickness: simSettings.buildTopPlateThicknessMm,
    standoffHeight: simSettings.buildStandoffHeightMm,
    fcMounting: simSettings.buildFcMountMm,
    motorMountPattern: simSettings.buildMotorMountPatternMm,
    motorCenterHole: simSettings.buildMotorShaftHoleMm,
  };
}

export function syncSimSettingsFromParams(
  params: DroneParams,
  prevSimSettings: SimSettings = defaultSimSettings,
): SimSettings {
  return {
    ...prevSimSettings,
    buildWheelbaseMm: params.frameSize,
    buildPropSizeIn: params.propSize,
    buildArmWidthMm: params.armWidth,
    buildBottomPlateThicknessMm: params.plateThickness,
    buildTopPlateThicknessMm: params.topPlateThickness,
    buildStandoffHeightMm: params.standoffHeight,
    buildFcMountMm: params.fcMounting,
    buildMotorMountPatternMm: params.motorMountPattern,
    buildMotorShaftHoleMm: params.motorCenterHole,
  };
}
