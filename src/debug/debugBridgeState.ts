import { Dispatch, MutableRefObject, SetStateAction } from "react";
import * as THREE from "three";
import {
  DEBUG_BRIDGE_VERSION,
  isPlainObject,
  normalizePatch,
  safeSummary,
  type ValidatedPatch,
} from "./debugBridgeProtocol";
import { deriveParamsFromBuild, syncSimSettingsFromParams } from "../sim/config";
import {
  DebugSettings,
  DroneParams,
  FlightTelemetry,
  SimSettings,
  ViewSettings,
} from "../types";

export interface DebugBridgeRefs {
  debugSettingsRef: MutableRefObject<DebugSettings>;
  flightTelemetryRef: MutableRefObject<FlightTelemetry>;
  isFlyingPathRef: MutableRefObject<boolean>;
  paramsRef: MutableRefObject<DroneParams>;
  simSettingsRef: MutableRefObject<SimSettings>;
  viewSettingsRef: MutableRefObject<ViewSettings>;
  waypointsRef: MutableRefObject<THREE.Vector3[]>;
}

export interface DebugBridgeSetters {
  setDebugSettings: Dispatch<SetStateAction<DebugSettings>>;
  setIsFlyingPath: Dispatch<SetStateAction<boolean>>;
  setViewSettings: Dispatch<SetStateAction<ViewSettings>>;
  setWaypoints: Dispatch<SetStateAction<THREE.Vector3[]>>;
}

export interface DebugBridgePatchStats {
  lastPatchAppliedMs: number;
  lastPatchKeys: string[];
  lastPatchSummary: string;
  lastPatchMetaSummary: string;
}

export function createDebugBridgeSnapshot(
  refs: DebugBridgeRefs,
  patchStats: DebugBridgePatchStats,
) {
  return {
    debugBridge: {
      version: DEBUG_BRIDGE_VERSION,
      lastPatchAppliedMs: patchStats.lastPatchAppliedMs,
      lastPatchKeys: patchStats.lastPatchKeys,
      lastPatchMetaSummary: patchStats.lastPatchMetaSummary,
      lastPatchSummary: patchStats.lastPatchSummary,
    },
    params: refs.paramsRef.current,
    viewSettings: refs.viewSettingsRef.current,
    simSettings: refs.simSettingsRef.current,
    debugSettings: refs.debugSettingsRef.current,
    waypoints: refs.waypointsRef.current.map((point) => ({
      x: point.x,
      y: point.y,
      z: point.z,
    })),
    isFlyingPath: refs.isFlyingPathRef.current,
    flightTelemetry: refs.flightTelemetryRef.current,
  };
}

export function applyDebugBridgePatch({
  applyValidatedAssemblyState,
  patchStats,
  rawPatch,
  refs,
  setters,
}: {
  applyValidatedAssemblyState: (
    nextParams: DroneParams,
    nextSimSettings: SimSettings,
    source: string,
  ) => boolean;
  patchStats: DebugBridgePatchStats;
  rawPatch: unknown;
  refs: DebugBridgeRefs;
  setters: DebugBridgeSetters;
}) {
  const normalizedPatch = normalizePatch(rawPatch);
  const patchKeys = Object.keys(normalizedPatch).filter((key) => {
    return normalizedPatch[key as keyof ValidatedPatch] !== undefined;
  });

  let nextParams = refs.paramsRef.current;
  let nextSimSettings = refs.simSettingsRef.current;
  let nextViewSettings = refs.viewSettingsRef.current;
  let nextDebugSettings = refs.debugSettingsRef.current;
  let nextWaypoints = refs.waypointsRef.current;
  let nextIsFlyingPath = refs.isFlyingPathRef.current;

  if (normalizedPatch.simSettings) {
    nextSimSettings = {
      ...nextSimSettings,
      ...normalizedPatch.simSettings,
    };
    nextParams = deriveParamsFromBuild(nextSimSettings, nextParams);
  }

  if (normalizedPatch.params) {
    nextParams = { ...nextParams, ...normalizedPatch.params };
    nextSimSettings = syncSimSettingsFromParams(nextParams, nextSimSettings);
  }

  if (normalizedPatch.viewSettings) {
    nextViewSettings = {
      ...nextViewSettings,
      ...normalizedPatch.viewSettings,
      visibility: normalizedPatch.viewSettings.visibility
        ? {
            ...nextViewSettings.visibility,
            ...normalizedPatch.viewSettings.visibility,
          }
        : nextViewSettings.visibility,
    };
  }

  if (normalizedPatch.debugSettings) {
    nextDebugSettings = {
      ...nextDebugSettings,
      ...normalizedPatch.debugSettings,
    };
  }

  if (normalizedPatch.waypoints) {
    nextWaypoints = normalizedPatch.waypoints;
  }

  if (typeof normalizedPatch.isFlyingPath === "boolean") {
    nextIsFlyingPath = normalizedPatch.isFlyingPath;
  }

  if (
    (normalizedPatch.params || normalizedPatch.simSettings) &&
    !applyValidatedAssemblyState(
      nextParams,
      nextSimSettings,
      "debug bridge patch",
    )
  ) {
    throw new Error(
      "Patch rejected because the resulting build violates assembly constraints.",
    );
  }

  if (normalizedPatch.viewSettings) {
    refs.viewSettingsRef.current = nextViewSettings;
    setters.setViewSettings(nextViewSettings);
  }

  if (normalizedPatch.debugSettings) {
    refs.debugSettingsRef.current = nextDebugSettings;
    setters.setDebugSettings(nextDebugSettings);
  }

  if (normalizedPatch.waypoints) {
    refs.waypointsRef.current = nextWaypoints;
    setters.setWaypoints(nextWaypoints);
  }

  if (typeof normalizedPatch.isFlyingPath === "boolean") {
    refs.isFlyingPathRef.current = nextIsFlyingPath;
    setters.setIsFlyingPath(nextIsFlyingPath);
  }

  patchStats.lastPatchAppliedMs = Date.now();
  patchStats.lastPatchKeys = patchKeys;
  patchStats.lastPatchSummary = safeSummary(rawPatch);
  patchStats.lastPatchMetaSummary = safeSummary(
    isPlainObject(rawPatch) ? rawPatch._meta : undefined,
  );
}
