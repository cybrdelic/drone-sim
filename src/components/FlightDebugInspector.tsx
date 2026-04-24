import { useMemo } from "react";
import { FlightLogSample, FlightTelemetry } from "../types";

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function buildTracePath(
  points: Array<{ x: number; y: number }>,
  width: number,
  height: number,
) {
  if (points.length === 0) return "";

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);

  return points
    .map((point, index) => {
      const x = ((point.x - minX) / spanX) * width;
      const y = height - ((point.y - minY) / spanY) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function formatSensorAge(ageSec?: number) {
  if (ageSec === undefined || !Number.isFinite(ageSec)) return "off";
  return `${(ageSec * 1000).toFixed(0)} ms`;
}

export function FlightDebugInspector({
  telemetry,
  logSamples,
  replayEnabled,
  replayCursorSec,
}: {
  telemetry: FlightTelemetry;
  logSamples: FlightLogSample[];
  replayEnabled: boolean;
  replayCursorSec: number;
}) {
  const recentSamples = useMemo(() => logSamples.slice(-180), [logSamples]);

  const planTrace = useMemo(() => {
    const tracePoints = recentSamples
      .map((sample) => sample.telemetry.positionMm)
      .filter((point): point is [number, number, number] => Boolean(point))
      .map((point) => ({ x: point[0], y: point[2] }));

    return buildTracePath(tracePoints, 240, 96);
  }, [recentSamples]);

  const altitudeTrace = useMemo(() => {
    const originTimeSec = recentSamples[0]?.timeSec ?? 0;
    const tracePoints = recentSamples.map((sample) => ({
      x: sample.timeSec - originTimeSec,
      y: sample.telemetry.altitudeM ?? 0,
    }));
    return buildTracePath(tracePoints, 240, 96);
  }, [recentSamples]);

  const currentTrace = useMemo(() => {
    const originTimeSec = recentSamples[0]?.timeSec ?? 0;
    const tracePoints = recentSamples.map((sample) => ({
      x: sample.timeSec - originTimeSec,
      y: sample.telemetry.batteryI ?? 0,
    }));
    return buildTracePath(tracePoints, 240, 96);
  }, [recentSamples]);

  const motorTemps = telemetry.motorTempsC ?? [0, 0, 0, 0];
  const maxMotorTemp = Math.max(1, telemetry.peakMotorTempC ?? Math.max(...motorTemps, 1));
  const sensorAges = [
    { name: "GPS", value: telemetry.gpsSampleAgeSec },
    { name: "Baro", value: telemetry.baroSampleAgeSec },
    { name: "Range", value: telemetry.rangefinderSampleAgeSec },
    { name: "Mag", value: telemetry.magnetometerSampleAgeSec },
    { name: "Gyro", value: telemetry.gyroSampleAgeSec },
    { name: "Accel", value: telemetry.accelSampleAgeSec },
  ];

  return (
    <div className="flight-debug-inspector etched-panel-soft text-[10px] text-white/85">
      <div className="flight-debug-inspector__header">
        <div>
          <div className="kicker mb-1">Inspector</div>
          <div className="text-[11px] font-semibold tracking-[0.02em] text-white">
            {replayEnabled ? "Sensor Replay" : "Live Analysis"}
          </div>
        </div>
        <div className="text-right font-mono text-[10px] text-white/65">
          <div>{replayEnabled ? "REPLAY" : "LIVE"}</div>
          <div>{replayCursorSec.toFixed(1)} s</div>
        </div>
      </div>

      <div className="flight-debug-inspector__grid">
        <div className="flight-debug-inspector__scope">
          <div className="kicker mb-2">Top Plan</div>
          <svg viewBox="0 0 240 96" preserveAspectRatio="none">
            <rect x="0" y="0" width="240" height="96" fill="rgba(255,255,255,0.02)" />
            <path d={planTrace} fill="none" stroke="#60a5fa" strokeWidth="1.5" />
            <line x1="120" y1="0" x2="120" y2="96" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
            <line x1="0" y1="48" x2="240" y2="48" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
          </svg>
        </div>

        <div className="flight-debug-inspector__scope">
          <div className="kicker mb-2">Altitude</div>
          <svg viewBox="0 0 240 96" preserveAspectRatio="none">
            <rect x="0" y="0" width="240" height="96" fill="rgba(255,255,255,0.02)" />
            <path d={altitudeTrace} fill="none" stroke="#34d399" strokeWidth="1.5" />
          </svg>
        </div>

        <div className="flight-debug-inspector__scope">
          <div className="kicker mb-2">Current Draw</div>
          <svg viewBox="0 0 240 96" preserveAspectRatio="none">
            <rect x="0" y="0" width="240" height="96" fill="rgba(255,255,255,0.02)" />
            <path d={currentTrace} fill="none" stroke="#f59e0b" strokeWidth="1.5" />
          </svg>
        </div>

        <div className="flight-debug-inspector__scope">
          <div className="kicker mb-2">Motor Thermal</div>
          <div className="flight-debug-inspector__bars">
            {motorTemps.map((motorTempC, index) => (
              <div key={`motor-temp-${index}`} className="flight-debug-inspector__bar">
                <div className="text-white/55">M{index + 1}</div>
                <div className="flight-debug-inspector__bar-track">
                  <div
                    className="flight-debug-inspector__bar-fill"
                    style={{ height: `${(clamp01(motorTempC / maxMotorTemp) * 100).toFixed(1)}%` }}
                  />
                </div>
                <div className="font-mono text-white/75">{motorTempC.toFixed(0)} C</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flight-debug-inspector__sensor-row font-mono text-[9px]">
        {sensorAges.map((sensorAge) => (
          <div key={sensorAge.name} className="flight-debug-inspector__sensor-pill">
            <div className="text-white/45">{sensorAge.name}</div>
            <div className="text-white/85">{formatSensorAge(sensorAge.value)}</div>
          </div>
        ))}
      </div>

      <div className="flight-debug-inspector__legend">
        <span>Peak Motor {(telemetry.peakMotorTempC ?? 0).toFixed(1)} C</span>
        <span>Current Limit {((telemetry.currentLimitScale ?? 1) * 100).toFixed(0)}%</span>
        <span>Thermal Limit {((telemetry.thermalLimitScale ?? 1) * 100).toFixed(0)}%</span>
        <span>Log {telemetry.logSamples ?? logSamples.length} samples</span>
      </div>
    </div>
  );
}
