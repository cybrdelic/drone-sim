import { getFlightDamageDiagnosis } from "../../sim/flightDamageUx";
import type { FlightTelemetry, SimSettings } from "../../types";

function readoutRow(label: string, value: string, emphasis = false) {
  return {
    label,
    labelClassName: emphasis ? "text-white/45" : "text-neutral-500",
    value,
    valueClassName: emphasis ? "text-right text-[#dbe8ff]" : "text-right",
  };
}

export function FlightTelemetryReadout({
  telemetry,
  simSettings,
}: {
  telemetry: FlightTelemetry;
  simSettings: SimSettings;
}) {
  const flightDamageDiagnosis = getFlightDamageDiagnosis(telemetry, {
    actuatorMismatchPct: simSettings.actuatorMismatchPct,
  });
  const rows = [
    readoutRow("THR", (telemetry.throttle01 ?? 0).toFixed(2), true),
    readoutRow("T/W", (telemetry.tw ?? 0).toFixed(2), true),
    readoutRow("THRUST", `${(telemetry.thrustN ?? 0).toFixed(1)} N`),
    readoutRow("WEIGHT", `${(telemetry.weightN ?? 0).toFixed(1)} N`),
    readoutRow("MASS", `${(telemetry.totalMassG ?? 0).toFixed(0)} g`),
    readoutRow("ALT", `${(telemetry.altitudeM ?? 0).toFixed(2)} m`),
    readoutRow("SPD", `${(telemetry.speedMS ?? 0).toFixed(2)} m/s`),
    readoutRow("AIRS", `${(telemetry.airspeedMS ?? 0).toFixed(2)} m/s`),
    readoutRow("WIND", `${(telemetry.windMS ?? 0).toFixed(2)} m/s`),
    readoutRow("GE", `${(telemetry.groundEffectMult ?? 1).toFixed(2)}x`),
    readoutRow("BAT", `${(telemetry.batteryV ?? 0).toFixed(2)} V`),
    readoutRow("SAG", `${(telemetry.batterySagV ?? 0).toFixed(2)} V`),
    readoutRow("CUR", `${(telemetry.batteryI ?? 0).toFixed(1)} A`),
    readoutRow("CUR LIM", `${(telemetry.currentLimitA ?? 0).toFixed(0)} A`),
    readoutRow("TEMP", `${(telemetry.ambientTempC ?? 0).toFixed(1)} C`),
    readoutRow("PROFILE", telemetry.rateProfileMode ?? "actual"),
    readoutRow("KV", (telemetry.buildMotorKV ?? 0).toFixed(0)),
    readoutRow("CELLS", `${(telemetry.buildBatteryCells ?? 0).toFixed(0)} s`),
    readoutRow("PITCH", `${(telemetry.buildPropPitchIn ?? 0).toFixed(1)} in`),
    readoutRow("PACK R", `${(telemetry.buildPackResistanceMilliOhm ?? 0).toFixed(0)} mOhm`),
    readoutRow("INERTIA", `${(telemetry.rotorInertiaScale ?? 0).toFixed(2)}x`),
    readoutRow("RATE", `${(telemetry.acroRateDegPerSec ?? 0).toFixed(0)} deg/s`),
    readoutRow("EXPO", (telemetry.acroExpo ?? 0).toFixed(2)),
    readoutRow("AIRMODE", `${((telemetry.airmodeStrength ?? 0) * 100).toFixed(0)} %`),
    readoutRow("WASH LOSS", `${((telemetry.propWashLoss ?? 0) * 100).toFixed(0)} %`),
    readoutRow("RELOAD", `${((telemetry.rotorReloadLoss ?? 0) * 100).toFixed(0)} %`),
    readoutRow("MOTOR AVG", `${(telemetry.avgMotorTempC ?? 0).toFixed(1)} C`),
    readoutRow("MOTOR PEAK", `${(telemetry.peakMotorTempC ?? 0).toFixed(1)} C`),
    readoutRow("THERM LIM", `${((telemetry.thermalLimitScale ?? 1) * 100).toFixed(0)} %`),
    readoutRow("CUR LIM %", `${((telemetry.currentLimitScale ?? 1) * 100).toFixed(0)} %`),
    readoutRow("RHO", (telemetry.airDensityKgM3 ?? 0).toFixed(3)),
    readoutRow("GUST", `${(telemetry.gustMS ?? 0).toFixed(2)} m/s`),
    readoutRow("ACT", `${(telemetry.actuatorSpreadPct ?? 0).toFixed(1)} %`),
    readoutRow("GPS ALT", `${(telemetry.gpsAltitudeM ?? 0).toFixed(2)} m`),
    readoutRow("BARO", `${(telemetry.baroAltitudeM ?? 0).toFixed(2)} m`),
    readoutRow("RANGE", `${(telemetry.rangefinderM ?? 0).toFixed(2)} m`),
    readoutRow("HDG", `${(telemetry.headingDeg ?? 0).toFixed(1)} deg`),
    readoutRow("GYRO", `${(telemetry.gyroDps ?? 0).toFixed(1)} dps`),
    readoutRow("ACC", `${(telemetry.accelMS2 ?? 0).toFixed(2)} m/s^2`),
  ];

  return (
    <div className="sidebar-subsection text-[11px] font-mono text-neutral-300">
      {flightDamageDiagnosis && (
        <div className="mb-3 rounded-[4px] border border-[#7f8ea3]/30 bg-[#20242a] px-3 py-2 text-[10px] leading-[1.45] text-[#d6dde8]">
          <div className="mb-1 font-semibold uppercase tracking-[0.08em] text-[#f0b36c]">
            {flightDamageDiagnosis.title}
          </div>
          <div>{flightDamageDiagnosis.summary}</div>
          <div className="mt-1 text-white/45">{flightDamageDiagnosis.detail}</div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <div className={row.labelClassName}>{row.label}</div>
            <div className={row.valueClassName}>{row.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
