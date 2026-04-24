import {
  MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DebugSettings, FlightLogSample, FlightTelemetry, SimSettings } from "../types";

interface UseFlightLogOptions {
  arePanelsVisible: boolean;
  debugSettings: DebugSettings;
  defaultFlightTelemetry: FlightTelemetry;
  flightTelemetryRef: MutableRefObject<FlightTelemetry>;
  isFlightSimView: boolean;
  simSettingsRef: MutableRefObject<SimSettings>;
}

export function useFlightLog({
  arePanelsVisible,
  debugSettings,
  defaultFlightTelemetry,
  flightTelemetryRef,
  isFlightSimView,
  simSettingsRef,
}: UseFlightLogOptions) {
  const flightLogRef = useRef<FlightLogSample[]>([]);
  const lastSampleAtMsRef = useRef<number | null>(null);
  const [flightLog, setFlightLog] = useState<FlightLogSample[]>([]);
  const [flightTelemetry, setFlightTelemetry] = useState<FlightTelemetry>(
    defaultFlightTelemetry,
  );
  const [flightLogSummary, setFlightLogSummary] = useState({
    samples: 0,
    durationSec: 0,
  });
  const [isReplayEnabled, setIsReplayEnabled] = useState(false);
  const [replayCursorSec, setReplayCursorSec] = useState(0);

  useEffect(() => {
    setFlightTelemetry(defaultFlightTelemetry);
  }, [defaultFlightTelemetry]);

  useEffect(() => {
    const shouldStreamTelemetry =
      isFlightSimView ||
      (
        (arePanelsVisible || debugSettings.debugInspector) &&
        (
          debugSettings.flightTelemetry ||
          debugSettings.sensorOverlays ||
          debugSettings.sensorFrustums ||
          debugSettings.forceVectors ||
          debugSettings.collisionVolumes ||
          debugSettings.impactEvents ||
          debugSettings.windField ||
          debugSettings.flightTrail
        )
      );

    if (!shouldStreamTelemetry) {
      lastSampleAtMsRef.current = null;
      return;
    }

    const intervalId = window.setInterval(() => {
      const liveTelemetry = { ...flightTelemetryRef.current };

      if (isFlightSimView) {
        const sampleTimeMs = performance.now();
        const lastSampleAtMs = lastSampleAtMsRef.current;
        lastSampleAtMsRef.current = sampleTimeMs;
        const dtSec =
          lastSampleAtMs === null
            ? 0
            : Math.max(0, Math.min(1, (sampleTimeMs - lastSampleAtMs) / 1000));
        const nextTimeSec = (flightLogRef.current[flightLogRef.current.length - 1]?.timeSec ?? 0) + dtSec;
        const nextSample: FlightLogSample = {
          timeSec: nextTimeSec,
          telemetry: liveTelemetry,
        };

        const maxSamples = Math.max(
          80,
          Math.round(Math.max(5, simSettingsRef.current.sensorLogSeconds) / 0.05),
        );
        const nextLog = [...flightLogRef.current, nextSample].slice(-maxSamples);
        flightLogRef.current = nextLog;
        setFlightLog(nextLog);

        const firstSample = nextLog[0];
        const lastSample = nextLog.at(-1);
        const durationSec =
          firstSample && lastSample && nextLog.length > 1
            ? Math.max(0, lastSample.timeSec - firstSample.timeSec)
            : 0;

        liveTelemetry.logSamples = nextLog.length;
        liveTelemetry.logDurationSec = durationSec;

        setFlightLogSummary({ samples: nextLog.length, durationSec });
      }

      setFlightTelemetry(liveTelemetry);
    }, 50);

    return () => window.clearInterval(intervalId);
  }, [
    arePanelsVisible,
    debugSettings.collisionVolumes,
    debugSettings.debugInspector,
    debugSettings.flightTelemetry,
    debugSettings.flightTrail,
    debugSettings.forceVectors,
    debugSettings.impactEvents,
    debugSettings.sensorFrustums,
    debugSettings.sensorOverlays,
    debugSettings.windField,
    flightTelemetryRef,
    isFlightSimView,
    simSettingsRef,
  ]);

  const clearFlightLog = useCallback(() => {
    flightLogRef.current = [];
    lastSampleAtMsRef.current = null;
    setFlightLog([]);
    setFlightLogSummary({ samples: 0, durationSec: 0 });
    setReplayCursorSec(0);
    setIsReplayEnabled(false);
  }, []);

  const resetFlightTelemetry = useCallback(() => {
    const nextTelemetry = { ...defaultFlightTelemetry };
    flightTelemetryRef.current = nextTelemetry;
    setFlightTelemetry(nextTelemetry);
    clearFlightLog();
  }, [clearFlightLog, defaultFlightTelemetry, flightTelemetryRef]);

  useEffect(() => {
    if (!isReplayEnabled) {
      setReplayCursorSec(flightLogSummary.durationSec);
    }
  }, [flightLogSummary.durationSec, isReplayEnabled]);

  const replaySample = useMemo(() => {
    if (!isReplayEnabled) {
      return null;
    }

    if (flightLog.length === 0) {
      return null;
    }

    const firstSample = flightLog[0];
    if (!firstSample) {
      return null;
    }

    const originTimeSec = firstSample.timeSec;
    let nearest = firstSample;
    let nearestDistance = Math.abs(replayCursorSec);

    for (const sample of flightLog) {
      const localTimeSec = sample.timeSec - originTimeSec;
      const distance = Math.abs(localTimeSec - replayCursorSec);
      if (distance < nearestDistance) {
        nearest = sample;
        nearestDistance = distance;
      }
    }

    return nearest;
  }, [flightLog, isReplayEnabled, replayCursorSec]);

  const inspectorTelemetry = replaySample?.telemetry ?? flightTelemetry;

  return {
    clearFlightLog,
    flightLog,
    flightLogSummary,
    flightTelemetry,
    inspectorTelemetry,
    isReplayEnabled,
    replayCursorSec,
    resetFlightTelemetry,
    setIsReplayEnabled,
    setReplayCursorSec,
  };
}
