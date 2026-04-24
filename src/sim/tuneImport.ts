import { RateProfileMode, SimSettings } from "../types";
import { clampSimNumericSetting } from "./config";

type NumericTuneField = {
  setting: keyof SimSettings;
  aliases: string[];
  normalizePercent?: boolean;
  round?: boolean;
};

const TUNE_NUMERIC_FIELDS: NumericTuneField[] = [
  { setting: "buildMotorKV", aliases: ["motor_kv", "kv", "buildMotorKV"] },
  { setting: "buildWheelbaseMm", aliases: ["frame_wheelbase", "wheelbase_mm", "buildWheelbaseMm"] },
  { setting: "buildPropSizeIn", aliases: ["prop_size", "prop_size_in", "buildPropSizeIn"] },
  { setting: "buildArmWidthMm", aliases: ["arm_width_mm", "buildArmWidthMm"] },
  { setting: "buildBottomPlateThicknessMm", aliases: ["bottom_plate_mm", "buildBottomPlateThicknessMm"] },
  { setting: "buildTopPlateThicknessMm", aliases: ["top_plate_mm", "buildTopPlateThicknessMm"] },
  { setting: "buildStandoffHeightMm", aliases: ["standoff_height_mm", "buildStandoffHeightMm"] },
  { setting: "buildFcMountMm", aliases: ["fc_mount_mm", "buildFcMountMm"] },
  { setting: "buildMotorMountPatternMm", aliases: ["motor_mount_mm", "buildMotorMountPatternMm"] },
  { setting: "buildMotorShaftHoleMm", aliases: ["motor_shaft_hole_mm", "buildMotorShaftHoleMm"] },
  { setting: "buildBatteryMassG", aliases: ["battery_mass_g", "buildBatteryMassG"] },
  { setting: "buildMotorMassG", aliases: ["motor_mass_g", "buildMotorMassG"] },
  { setting: "buildPropMassG", aliases: ["prop_mass_g", "buildPropMassG"] },
  { setting: "buildStackMassG", aliases: ["stack_mass_g", "buildStackMassG"] },
  { setting: "buildMiscMassG", aliases: ["misc_mass_g", "buildMiscMassG"] },
  { setting: "manufacturingToleranceMm", aliases: ["manufacturing_tolerance_mm", "manufacturingToleranceMm"] },
  { setting: "materialDensityGcm3", aliases: ["material_density_gcm3", "materialDensityGcm3"] },
  { setting: "materialElasticModulusGPa", aliases: ["material_elastic_modulus_gpa", "materialElasticModulusGPa"] },
  { setting: "materialYieldStrengthMPa", aliases: ["material_yield_strength_mpa", "materialYieldStrengthMPa"] },
  { setting: "materialBrittleStrainPct", aliases: ["material_brittle_strain_pct", "materialBrittleStrainPct"] },
  { setting: "impactFragilityScale", aliases: ["impact_fragility_scale", "impactFragilityScale"] },
  { setting: "wireOuterDiameterMm", aliases: ["wire_outer_diameter_mm", "wireOuterDiameterMm"] },
  { setting: "wiringBundleCount", aliases: ["wiring_bundle_count", "wiringBundleCount"], round: true },
  { setting: "wiringMinSpacingMm", aliases: ["wiring_min_spacing_mm", "wiringMinSpacingMm"] },
  { setting: "wiringCurrentA", aliases: ["wiring_current_a", "wiringCurrentA"] },
  { setting: "motorScrewClearanceMm", aliases: ["motor_screw_clearance_mm", "motorScrewClearanceMm"] },
  { setting: "stackScrewClearanceMm", aliases: ["stack_screw_clearance_mm", "stackScrewClearanceMm"] },
  { setting: "cameraTpuClearanceMm", aliases: ["camera_tpu_clearance_mm", "cameraTpuClearanceMm"] },
  { setting: "antennaTubeClearanceMm", aliases: ["antenna_tube_clearance_mm", "antennaTubeClearanceMm"] },
  { setting: "stackHeightMm", aliases: ["stack_height_mm", "stackHeightMm"] },
  { setting: "armFractureForceN", aliases: ["arm_fracture_force_n", "armFractureForceN"] },
  { setting: "motorDamageForceN", aliases: ["motor_damage_force_n", "motorDamageForceN"] },
  { setting: "batteryDamageForceN", aliases: ["battery_damage_force_n", "batteryDamageForceN"] },
  { setting: "buildBatteryCells", aliases: ["battery_cells", "cell_count", "vbat_cell_count", "buildBatteryCells"], round: true },
  { setting: "buildPropPitchIn", aliases: ["prop_pitch", "prop_pitch_in", "buildPropPitchIn"] },
  { setting: "buildPackResistanceMilliOhm", aliases: ["pack_resistance_milliohm", "battery_internal_resistance", "buildPackResistanceMilliOhm"] },
  { setting: "rotorInertiaScale", aliases: ["rotor_inertia_scale", "rotorInertiaScale"] },
  { setting: "acroRateDegPerSec", aliases: ["acro_rate_deg_per_sec", "acroRateDegPerSec"] },
  { setting: "acroExpo", aliases: ["acro_expo", "acroExpo"], normalizePercent: true },
  { setting: "airmodeStrength", aliases: ["airmode_strength", "airmodeStrength"], normalizePercent: true },
  { setting: "propWashCoupling", aliases: ["propwash_coupling", "propWashCoupling"], normalizePercent: true },
  { setting: "betaflightRcRate", aliases: ["roll_rc_rate", "pitch_rc_rate", "rcRate", "betaflightRcRate"], normalizePercent: true },
  { setting: "betaflightSuperRate", aliases: ["roll_srate", "pitch_srate", "superRate", "betaflightSuperRate"], normalizePercent: true },
  { setting: "betaflightExpo", aliases: ["roll_expo", "pitch_expo", "expo", "betaflightExpo"], normalizePercent: true },
  { setting: "betaflightYawRcRate", aliases: ["yaw_rc_rate", "yawRate", "betaflightYawRcRate"], normalizePercent: true },
  { setting: "betaflightYawSuperRate", aliases: ["yaw_srate", "yawSuperRate", "betaflightYawSuperRate"], normalizePercent: true },
  { setting: "betaflightYawExpo", aliases: ["yaw_expo", "yawExpo", "betaflightYawExpo"], normalizePercent: true },
  { setting: "throttleMid01", aliases: ["thr_mid", "throttle_mid", "throttleMid", "throttleMid01"], normalizePercent: true },
  { setting: "throttleExpo", aliases: ["thr_expo", "throttle_expo", "throttleExpo"], normalizePercent: true },
];

function normalizeTuneValue(value: number) {
  return value > 5 ? value / 100 : value;
}

function readNumber(source: Record<string, unknown>, aliases: string[]) {
  for (const alias of aliases) {
    const value = source[alias];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = parseFloat(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

function readRateProfileMode(source: Record<string, unknown>) {
  for (const alias of ["rateProfileMode", "rate_profile_mode"]) {
    const value = source[alias];
    if (value === "actual" || value === "betaflight") {
      return value as RateProfileMode;
    }
  }

  return undefined;
}

function extractPatch(source: Record<string, unknown>) {
  const patch: Partial<SimSettings> = {};
  const rateProfileMode = readRateProfileMode(source);
  if (rateProfileMode) {
    patch.rateProfileMode = rateProfileMode;
  }

  for (const field of TUNE_NUMERIC_FIELDS) {
    const rawValue = readNumber(source, field.aliases);
    if (rawValue === undefined) {
      continue;
    }

    const normalizedValue = field.normalizePercent
      ? normalizeTuneValue(rawValue)
      : rawValue;
    const clampedValue = clampSimNumericSetting(
      field.setting as never,
      normalizedValue,
    );

    patch[field.setting] = (
      field.round ? Math.round(clampedValue) : clampedValue
    ) as never;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

export function parseTuneImport(text: string): Partial<SimSettings> | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      return extractPatch(parsed);
    } catch {
      return null;
    }
  }

  const source: Record<string, unknown> = {};
  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) {
      continue;
    }

    const match = line.match(/^(?:set\s+)?([a-z0-9_]+)\s*(?:=|:)\s*([^\s#]+)$/i);
    if (!match) {
      continue;
    }

    const key = match[1];
    const value = match[2];
    if (!key || !value) {
      continue;
    }

    const numericValue = parseFloat(value);
    source[key] = Number.isFinite(numericValue)
      ? numericValue
      : value.toLowerCase();
  }

  return extractPatch(source);
}
