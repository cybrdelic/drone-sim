import { FlightTelemetry } from "../types";

export interface FlightDamageDiagnosis {
  severity: "notice" | "warn" | "critical";
  title: string;
  summary: string;
  detail: string;
}

interface FlightDamageDiagnosisOptions {
  actuatorMismatchPct?: number;
}

export function getFlightDamageDiagnosis(
  telemetry: FlightTelemetry,
  _options: FlightDamageDiagnosisOptions = {},
): FlightDamageDiagnosis | null {
  const structureDamagePct = telemetry.structureDamagePct ?? 0;
  const motorDamagePct = telemetry.motorDamagePct ?? 0;
  const batteryDamagePct = telemetry.batteryDamagePct ?? 0;
  const fracturedArms = telemetry.fracturedArms ?? 0;
  const lastImpactForceN = telemetry.lastImpactForceN ?? 0;
  const lastImpactAgeSec = telemetry.lastImpactAgeSec ?? Number.POSITIVE_INFINITY;
  const visualDamagePct = Math.max(structureDamagePct, motorDamagePct);

  if (visualDamagePct < 2 && fracturedArms < 1) {
    return null;
  }

  const severity = fracturedArms > 0 || visualDamagePct >= 45
    ? "critical"
    : visualDamagePct >= 14 || batteryDamagePct >= 18
      ? "warn"
      : "notice";

  const title = fracturedArms > 0
    ? fracturedArms === 1
      ? "Fractured arm detected"
      : `${fracturedArms} fractured arms detected`
    : "Impact misalignment detected";

  const summary = fracturedArms > 0
    ? "The prop and motor assembly is hanging off-angle because crash damage has fractured arm stiffness and shifted the motor mount."
    : "The prop and motor assembly looks loose or angled because the sim is visualizing post-impact arm flex and motor mount misalignment.";

  const impactDetail = Number.isFinite(lastImpactAgeSec) && lastImpactAgeSec < 8 && lastImpactForceN > 0
    ? ` Last recorded impact: ${lastImpactForceN.toFixed(0)} N, ${lastImpactAgeSec.toFixed(1)} s ago.`
    : "";

  const detail = `Structure damage ${structureDamagePct.toFixed(0)}%, motor damage ${motorDamagePct.toFixed(0)}%, battery damage ${batteryDamagePct.toFixed(0)}%, fractured arms ${fracturedArms}.${impactDetail}`;

  return {
    severity,
    title,
    summary,
    detail,
  };
}
