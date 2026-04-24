import {
  AssemblyConstraintIssue,
  AssemblyValidationResult,
  DroneParams,
  InspectTarget,
  SimSettings,
} from "../../types";
import { computeDroneEngineeringData } from "./engineering";

export function computeAssemblyFitChecks(
  params: DroneParams,
  simSettings: SimSettings,
) {
  const tol = Math.max(0.01, simSettings.manufacturingToleranceMm);
  const toleranceStackMm = tol * Math.sqrt(2);
  const motorScrewDiaMm = params.motorMountPattern >= 16 ? 3 : 2;
  const stackScrewDiaMm = 3;
  const cameraBodyWidthMm = 19;
  const antennaElementDiaMm = 3.2;
  const stackHeightMm = Math.max(4, simSettings.stackHeightMm);
  const plateGapMm = params.standoffHeight;

  const checks = [
    {
      label: "Motor screw fit",
      nominalClearanceMm: simSettings.motorScrewClearanceMm,
      minClearanceMm: simSettings.motorScrewClearanceMm - toleranceStackMm,
      targetMm: motorScrewDiaMm,
    },
    {
      label: "Stack hardware fit",
      nominalClearanceMm: simSettings.stackScrewClearanceMm,
      minClearanceMm: simSettings.stackScrewClearanceMm - toleranceStackMm,
      targetMm: stackScrewDiaMm,
    },
    {
      label: "Standoff stack margin",
      nominalClearanceMm: plateGapMm - stackHeightMm,
      minClearanceMm: plateGapMm - stackHeightMm - toleranceStackMm,
      targetMm: stackHeightMm,
    },
    {
      label: "Camera TPU cradle",
      nominalClearanceMm: simSettings.cameraTpuClearanceMm,
      minClearanceMm: simSettings.cameraTpuClearanceMm - toleranceStackMm,
      targetMm: cameraBodyWidthMm,
    },
    {
      label: "Antenna tube fit",
      nominalClearanceMm: simSettings.antennaTubeClearanceMm,
      minClearanceMm: simSettings.antennaTubeClearanceMm - toleranceStackMm,
      targetMm: antennaElementDiaMm,
    },
  ].map((check) => ({
    ...check,
    severity:
      check.minClearanceMm < 0
        ? "fail"
        : check.minClearanceMm < Math.max(0.15, tol)
          ? "warn"
          : "ok",
  }));

  return checks;
}

function uniqueTargets(targets: InspectTarget[]) {
  return [...new Set(targets)];
}

function fitCheckTargets(label: string): InspectTarget[] {
  switch (label) {
    case "Motor screw fit":
      return ["motors_props", "bottom_plate", "reference_hardware"];
    case "Stack hardware fit":
      return ["fc_stack", "standoffs", "reference_hardware"];
    case "Standoff stack margin":
      return ["fc_stack", "standoffs", "top_plate"];
    case "Camera TPU cradle":
      return ["fpv_camera", "tpu_pack"];
    case "Antenna tube fit":
      return ["antenna_routing", "sensor_mast", "tpu_pack"];
    default:
      return ["all"];
  }
}

function buildIssue(
  id: string,
  severity: "warn" | "fail",
  title: string,
  summary: string,
  detail: string,
  targets: InspectTarget[],
): AssemblyConstraintIssue {
  return {
    id,
    severity,
    title,
    summary,
    detail,
    targets: uniqueTargets(targets),
  };
}

export function validateAssemblyConfiguration(
  params: DroneParams,
  simSettings: SimSettings,
): AssemblyValidationResult {
  const fitChecks = computeAssemblyFitChecks(params, simSettings);
  const engineering = computeDroneEngineeringData(params, simSettings);
  const issues: AssemblyConstraintIssue[] = [];
  const warnings: AssemblyConstraintIssue[] = [];

  for (const check of fitChecks) {
    if (check.severity === "ok") {
      continue;
    }

    const issueSeverity: "warn" | "fail" =
      check.severity === "fail" ? "fail" : "warn";
    const targetIssues = issueSeverity === "fail" ? issues : warnings;
    const clearanceSummary = issueSeverity === "fail"
      ? `${check.label} goes negative after tolerance stack (${check.minClearanceMm.toFixed(2)} mm minimum clearance).`
      : `${check.label} is down to ${check.minClearanceMm.toFixed(2)} mm worst-case clearance, which is inside the warning band.`;
    const clearanceDetail = issueSeverity === "fail"
      ? "Adjust the mating geometry or clearance budget until the worst-case clearance stays above 0 mm."
      : "Adjust the mating geometry or clearance budget until the worst-case clearance stays comfortably above the tolerance floor.";
    targetIssues.push(
      buildIssue(
        check.label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        issueSeverity,
        check.label,
        clearanceSummary,
        clearanceDetail,
        fitCheckTargets(check.label),
      ),
    );
  }

  const propRadiusMm = (params.propSize * 25.4) / 2;
  const adjacentMotorSpacingMm = params.frameSize / Math.SQRT2;
  const propToPropClearanceMm = adjacentMotorSpacingMm - propRadiusMm * 2;
  if (propToPropClearanceMm < 0) {
    issues.push(
      buildIssue(
        "prop-disk-overlap",
        "fail",
        "Prop disks overlap",
        `Adjacent propeller envelopes intersect by ${Math.abs(propToPropClearanceMm).toFixed(2)} mm.`,
        "Increase wheelbase or reduce prop diameter before this airframe can be assembled safely.",
        ["motors_props", "bottom_plate"],
      ),
    );
  }

  const centerBodyRadiusMm = params.fcMounting / 2 + 10;
  const propToBodyClearanceMm = params.frameSize / 2 - centerBodyRadiusMm - propRadiusMm;
  if (propToBodyClearanceMm < 1.5) {
    issues.push(
      buildIssue(
        "prop-body-clearance",
        "fail",
        "Prop arc clips the center stack envelope",
        `Prop-to-body clearance is only ${propToBodyClearanceMm.toFixed(2)} mm; the assembly gate requires at least 1.50 mm.`,
        "Increase wheelbase, shrink the center stack envelope, or step down prop size.",
        ["motors_props", "fc_stack", "top_plate", "bottom_plate"],
      ),
    );
  }

  if (engineering.wiringMargin_mm < 0) {
    issues.push(
      buildIssue(
        "wiring-channel-overfill",
        "fail",
        "Wiring harness does not fit the arm channel",
        `Per-arm harness margin is ${engineering.wiringMargin_mm.toFixed(2)} mm, so the routed conductors still exceed the available arm channel space.`,
        "Widen the arm channel, reduce bundle count, or reduce wire outer diameter.",
        ["wiring_harness", "bottom_plate", "standoffs"],
      ),
    );
  }

  if (engineering.safetyFactor < 1.35) {
    issues.push(
      buildIssue(
        "frame-safety-factor",
        "fail",
        "Frame section is below structural reserve",
        `Calculated arm safety factor is ${engineering.safetyFactor.toFixed(2)}, below the 1.35 assembly gate.`,
        "Increase plate thickness, increase arm width, reduce cutout weight reduction, or increase material strength.",
        ["bottom_plate", "top_plate", "carbon_sheet"],
      ),
    );
  }

  const failingTargets = uniqueTargets(issues.flatMap((issue) => issue.targets));

  return {
    isValid: issues.length === 0,
    issues,
    warnings,
    failingTargets,
  };
}
