export type ViewMode =
  | "assembled"
  | "exploded"
  | "print_layout"
  | "clearance_check"
  | "flight_sim";

export type ComponentFocus =
  | "all"
  | "frame"
  | "propulsion"
  | "electronics"
  | "accessories";

export type InspectTarget =
  | "all"
  | "bottom_plate"
  | "top_plate"
  | "standoffs"
  | "motors_props"
  | "fc_stack"
  | "fpv_camera"
  | "battery_pack"
  | "sensor_mast"
  | "imu_baro"
  | "rangefinder"
  | "wiring_harness"
  | "antenna_routing"
  | "action_mount"
  | "carbon_sheet"
  | "tpu_pack"
  | "reference_hardware";

export interface ComponentVisibility {
  frame: boolean;
  propulsion: boolean;
  electronics: boolean;
  accessories: boolean;
}

export interface ViewSettings {
  wireframe: boolean;
  focus: ComponentFocus;
  inspectTarget: InspectTarget;
  keepContext: boolean;
  visibility: ComponentVisibility;
}

export type EnvironmentPreset =
  | "lab_calm"
  | "wind_tunnel"
  | "field_gusty";

export type RateProfileMode = "actual" | "betaflight";

export type DebugPreset =
  | "custom"
  | "minimal"
  | "sensors"
  | "aero"
  | "collisions"
  | "full";

export interface SimSettings {
  motorAudioEnabled: boolean;
  motorAudioVolume: number; // 0..1
  vibrationAmount: number; // 0..1
  environmentPreset: EnvironmentPreset;
  ambientTempC: number;
  humidityPct: number;
  meanWindMS: number;
  gustAmplitudeMS: number;
  turbulenceMS: number;
  escLatencyMs: number;
  actuatorMismatchPct: number;
  sensorNoiseScale: number;
  gpsRateHz: number;
  gpsEnabled: boolean;
  barometerEnabled: boolean;
  magnetometerEnabled: boolean;
  rangefinderEnabled: boolean;
  motorCurrentLimitA: number;
  motorCoolingScale: number;
  buildWheelbaseMm: number;
  buildPropSizeIn: number;
  buildArmWidthMm: number;
  buildBottomPlateThicknessMm: number;
  buildTopPlateThicknessMm: number;
  buildStandoffHeightMm: number;
  buildFcMountMm: number;
  buildMotorMountPatternMm: number;
  buildMotorShaftHoleMm: number;
  buildBatteryMassG: number;
  buildMotorMassG: number;
  buildPropMassG: number;
  buildStackMassG: number;
  buildMiscMassG: number;
  manufacturingToleranceMm: number;
  materialDensityGcm3: number;
  materialElasticModulusGPa: number;
  materialYieldStrengthMPa: number;
  materialBrittleStrainPct: number;
  impactFragilityScale: number;
  wireOuterDiameterMm: number;
  wiringBundleCount: number;
  wiringMinSpacingMm: number;
  wiringCurrentA: number;
  motorScrewClearanceMm: number;
  stackScrewClearanceMm: number;
  cameraTpuClearanceMm: number;
  antennaTubeClearanceMm: number;
  stackHeightMm: number;
  armFractureForceN: number;
  motorDamageForceN: number;
  batteryDamageForceN: number;
  buildMotorKV: number;
  buildBatteryCells: number;
  buildPropPitchIn: number;
  buildPackResistanceMilliOhm: number;
  rotorInertiaScale: number;
  acroRateDegPerSec: number;
  acroExpo: number;
  airmodeStrength: number;
  propWashCoupling: number;
  rateProfileMode: RateProfileMode;
  betaflightRcRate: number;
  betaflightSuperRate: number;
  betaflightExpo: number;
  betaflightYawRcRate: number;
  betaflightYawSuperRate: number;
  betaflightYawExpo: number;
  throttleMid01: number;
  throttleExpo: number;
  sensorLogSeconds: number;
}

export interface DebugSettings {
  debugPreset: DebugPreset;
  debugInspector: boolean;
  physicsLines: boolean;
  flightTelemetry: boolean;
  sensorOverlays: boolean;
  sensorFrustums: boolean;
  forceVectors: boolean;
  collisionVolumes: boolean;
  impactEvents: boolean;
  windField: boolean;
  flightTrail: boolean;
}

export interface FlightTelemetry {
  throttle01: number;
  thrustN: number;
  weightN: number;
  tw: number;
  altitudeM: number;
  speedMS: number;
  airspeedMS?: number;
  windMS?: number;
  groundEffectMult?: number;
  batteryV?: number;
  batteryI?: number;
  batterySagV?: number;
  totalMassG?: number;
  structureDamagePct?: number;
  motorDamagePct?: number;
  batteryDamagePct?: number;
  fracturedArms?: number;
  armed?: boolean;
  ambientTempC?: number;
  pressurePa?: number;
  airDensityKgM3?: number;
  gustMS?: number;
  actuatorSpreadPct?: number;
  gpsAltitudeM?: number;
  gpsSpeedMS?: number;
  baroAltitudeM?: number;
  rangefinderM?: number;
  headingDeg?: number;
  gyroDps?: number;
  accelMS2?: number;
  motorTempsC?: [number, number, number, number];
  motorCurrentsA?: [number, number, number, number];
  avgMotorTempC?: number;
  peakMotorTempC?: number;
  currentLimitA?: number;
  currentLimitScale?: number;
  thermalLimitScale?: number;
  buildWheelbaseMm?: number;
  buildPropSizeIn?: number;
  buildArmWidthMm?: number;
  buildBottomPlateThicknessMm?: number;
  buildTopPlateThicknessMm?: number;
  buildStandoffHeightMm?: number;
  buildFcMountMm?: number;
  buildMotorMountPatternMm?: number;
  buildMotorShaftHoleMm?: number;
  buildBatteryMassG?: number;
  buildMotorMassG?: number;
  buildPropMassG?: number;
  buildStackMassG?: number;
  buildMiscMassG?: number;
  buildMotorKV?: number;
  buildBatteryCells?: number;
  buildPropPitchIn?: number;
  buildPackResistanceMilliOhm?: number;
  rotorInertiaScale?: number;
  acroRateDegPerSec?: number;
  acroExpo?: number;
  airmodeStrength?: number;
  propWashCoupling?: number;
  propWashLoss?: number;
  rotorReloadLoss?: number;
  rateProfileMode?: RateProfileMode;
  betaflightRcRate?: number;
  betaflightSuperRate?: number;
  betaflightExpo?: number;
  betaflightYawRcRate?: number;
  betaflightYawSuperRate?: number;
  betaflightYawExpo?: number;
  throttleMid01?: number;
  throttleExpo?: number;
  logSamples?: number;
  logDurationSec?: number;
  gpsSampleAgeSec?: number;
  baroSampleAgeSec?: number;
  rangefinderSampleAgeSec?: number;
  magnetometerSampleAgeSec?: number;
  gyroSampleAgeSec?: number;
  accelSampleAgeSec?: number;
  positionMm?: [number, number, number];
  gpsPositionMm?: [number, number, number];
  thrustWorldN?: [number, number, number];
  dragWorldN?: [number, number, number];
  windWorldMS?: [number, number, number];
  velocityWorldMS?: [number, number, number];
  accelWorldMS2?: [number, number, number];
  gyroWorldDpsVec?: [number, number, number];
  bodyUpWorld?: [number, number, number];
  headingWorld?: [number, number, number];
  collisionHalfExtentsMm?: [number, number, number];
  collisionCenterMm?: [number, number, number];
  lastImpactPointMm?: [number, number, number];
  lastImpactNormalWorld?: [number, number, number];
  lastImpactForceWorldN?: [number, number, number];
  lastImpactForceN?: number;
  lastImpactAgeSec?: number;
  contactCount?: number;
}

export interface FlightLogSample {
  timeSec: number;
  telemetry: FlightTelemetry;
}

export interface AssemblyConstraintIssue {
  id: string;
  severity: "warn" | "fail";
  title: string;
  summary: string;
  detail: string;
  targets: InspectTarget[];
}

export interface AssemblyValidationResult {
  isValid: boolean;
  issues: AssemblyConstraintIssue[];
  warnings: AssemblyConstraintIssue[];
  failingTargets: InspectTarget[];
}

export interface DroneParams {
  frameSize: number;
  plateThickness: number;
  topPlateThickness: number;
  standoffHeight: number;
  armWidth: number;
  fcMounting: number;
  motorMountPattern: number;
  motorCenterHole: number;
  weightReduction: number;
  propSize: number;
  showTPU: boolean;
  tpuColor: string;
  viewMode: ViewMode;
}
