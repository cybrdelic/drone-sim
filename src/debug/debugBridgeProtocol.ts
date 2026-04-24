import * as THREE from "three";
import {
  defaultDebugSettings,
  debugPresetValues,
  defaultParams,
  defaultSimSettings,
  defaultViewSettings,
} from "../sim/config";
import type {
  DebugSettings,
  DroneParams,
  SimSettings,
  ViewSettings,
} from "../types";

export const DEBUG_BRIDGE_DEFAULT_URL = "ws://127.0.0.1:8787";
export const DEBUG_BRIDGE_URL =
  import.meta.env.VITE_DRONE_SIM_DEBUG_URL?.trim() ||
  DEBUG_BRIDGE_DEFAULT_URL;
export const DEBUG_BRIDGE_TOKEN =
  import.meta.env.VITE_DRONE_SIM_DEBUG_TOKEN?.trim() || "";
export const DEBUG_BRIDGE_ENABLED =
  import.meta.env.VITE_DRONE_SIM_DEBUG_ENABLED === "true";
export const DEBUG_BRIDGE_VERSION = 3;

const VIEW_MODES = new Set<DroneParams["viewMode"]>([
  "assembled",
  "exploded",
  "print_layout",
  "clearance_check",
  "flight_sim",
]);
const COMPONENT_FOCUS = new Set<ViewSettings["focus"]>([
  "all",
  "frame",
  "propulsion",
  "electronics",
  "accessories",
]);
const INSPECT_TARGETS = new Set<ViewSettings["inspectTarget"]>([
  "all",
  "bottom_plate",
  "top_plate",
  "standoffs",
  "motors_props",
  "fc_stack",
  "fpv_camera",
  "battery_pack",
  "sensor_mast",
  "imu_baro",
  "rangefinder",
  "wiring_harness",
  "antenna_routing",
  "action_mount",
  "carbon_sheet",
  "tpu_pack",
  "reference_hardware",
]);
const DEBUG_PRESETS = new Set(debugPresetValues);
const ENVIRONMENT_PRESETS = new Set<SimSettings["environmentPreset"]>([
  "lab_calm",
  "wind_tunnel",
  "field_gusty",
]);
const RATE_PROFILE_MODES = new Set<SimSettings["rateProfileMode"]>([
  "actual",
  "betaflight",
]);

export type ValidatedPatch = {
  debugSettings?: Partial<DebugSettings>;
  isFlyingPath?: boolean;
  params?: Partial<DroneParams>;
  simSettings?: Partial<SimSettings>;
  viewSettings?: Partial<ViewSettings> & {
    visibility?: Partial<ViewSettings["visibility"]>;
  };
  waypoints?: THREE.Vector3[];
};

export function safeSummary(value: unknown, maxLength = 1800) {
  try {
    const summary = JSON.stringify(
      value,
      (_key, currentValue) => {
        if (typeof currentValue === "function") {
          return "[Function]";
        }
        if (
          typeof AbortSignal !== "undefined" &&
          currentValue instanceof AbortSignal
        ) {
          return `[AbortSignal aborted=${currentValue.aborted}]`;
        }
        if (currentValue instanceof Error) {
          return `[Error ${currentValue.message}]`;
        }
        if (currentValue && typeof currentValue === "object") {
          const ctor = (currentValue as { constructor?: { name?: string } })
            .constructor?.name;
          if (ctor && ctor !== "Object" && ctor !== "Array") {
            return `[${ctor}]`;
          }
        }
        return currentValue;
      },
      2,
    );
    return typeof summary === "string"
      ? summary.slice(0, maxLength)
      : String(summary);
  } catch {
    try {
      return String(value).slice(0, maxLength);
    } catch {
      return "[Unserializable]";
    }
  }
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateVisibilityPatch(value: unknown) {
  if (!isPlainObject(value)) {
    return false;
  }

  return Object.entries(value).every(([key, currentValue]) => {
    return (
      (key === "frame" ||
        key === "propulsion" ||
        key === "electronics" ||
        key === "accessories") &&
      typeof currentValue === "boolean"
    );
  });
}

function validatePatchFragment<T extends object>(
  source: unknown,
  template: T,
  fieldValidators: Partial<Record<keyof T, (value: unknown) => boolean>> = {},
) {
  if (source === undefined) {
    return undefined;
  }
  if (!isPlainObject(source)) {
    throw new Error("Patch fragment must be an object.");
  }

  const patch: Partial<T> = {};
  const templateRecord = template as Record<string, unknown>;
  for (const [rawKey, value] of Object.entries(source)) {
    if (!(rawKey in templateRecord)) {
      throw new Error(`Unsupported patch field "${rawKey}".`);
    }

    const key = rawKey as keyof T;
    const validator = fieldValidators[key];
    if (validator && !validator(value)) {
      throw new Error(`Invalid value for patch field "${rawKey}".`);
    }

    const templateValue = template[key];
    const isSamePrimitiveType =
      templateValue === null
        ? value === null
        : typeof value === typeof templateValue;
    if (!validator && !isSamePrimitiveType) {
      throw new Error(`Patch field "${rawKey}" must be a ${typeof templateValue}.`);
    }

    patch[key] = value as T[keyof T];
  }
  return patch;
}

function validateWaypoints(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error("waypoints must be an array.");
  }

  return value.map((point, index) => {
    if (!isPlainObject(point)) {
      throw new Error(`waypoints[${index}] must be an object.`);
    }
    if (
      !isFiniteNumber(point.x) ||
      !isFiniteNumber(point.y) ||
      !isFiniteNumber(point.z)
    ) {
      throw new Error(
        `waypoints[${index}] must contain finite x/y/z coordinates.`,
      );
    }

    return new THREE.Vector3(point.x, point.y, point.z);
  });
}

export function normalizePatch(rawPatch: unknown): ValidatedPatch {
  if (!isPlainObject(rawPatch)) {
    throw new Error("Patch payload must be an object.");
  }

  const supportedKeys = new Set([
    "_meta",
    "debugSettings",
    "isFlyingPath",
    "params",
    "simSettings",
    "viewSettings",
    "waypoints",
  ]);
  for (const key of Object.keys(rawPatch)) {
    if (!supportedKeys.has(key)) {
      throw new Error(`Unsupported top-level patch key "${key}".`);
    }
  }

  const params = validatePatchFragment(rawPatch.params, defaultParams, {
    viewMode: (value) =>
      typeof value === "string" &&
      VIEW_MODES.has(value as DroneParams["viewMode"]),
  });
  const simSettings = validatePatchFragment(
    rawPatch.simSettings,
    defaultSimSettings,
    {
      environmentPreset: (value) =>
        typeof value === "string" &&
        ENVIRONMENT_PRESETS.has(value as SimSettings["environmentPreset"]),
      rateProfileMode: (value) =>
        typeof value === "string" &&
        RATE_PROFILE_MODES.has(value as SimSettings["rateProfileMode"]),
    },
  );
  const viewSettings = validatePatchFragment(
    rawPatch.viewSettings,
    defaultViewSettings,
    {
      focus: (value) =>
        typeof value === "string" &&
        COMPONENT_FOCUS.has(value as ViewSettings["focus"]),
      inspectTarget: (value) =>
        typeof value === "string" &&
        INSPECT_TARGETS.has(value as ViewSettings["inspectTarget"]),
      visibility: validateVisibilityPatch,
    },
  );
  const debugSettings = validatePatchFragment(
    rawPatch.debugSettings,
    defaultDebugSettings,
    {
      debugPreset: (value) =>
        typeof value === "string" &&
        DEBUG_PRESETS.has(value as DebugSettings["debugPreset"]),
    },
  );
  const waypoints = validateWaypoints(rawPatch.waypoints);
  const isFlyingPath =
    rawPatch.isFlyingPath === undefined
      ? undefined
      : (() => {
          if (typeof rawPatch.isFlyingPath !== "boolean") {
            throw new Error("isFlyingPath must be a boolean.");
          }
          return rawPatch.isFlyingPath;
        })();

  const normalized: ValidatedPatch = {};
  if (debugSettings) {
    normalized.debugSettings = debugSettings;
  }
  if (typeof isFlyingPath === "boolean") {
    normalized.isFlyingPath = isFlyingPath;
  }
  if (params) {
    normalized.params = params;
  }
  if (simSettings) {
    normalized.simSettings = simSettings;
  }
  if (viewSettings) {
    normalized.viewSettings = viewSettings;
  }
  if (waypoints) {
    normalized.waypoints = waypoints;
  }
  return normalized;
}

export function resolvePatchPayload(command: Record<string, unknown>) {
  if (isPlainObject(command.patch)) {
    return command.patch;
  }

  const {
    command: _command,
    id: _id,
    token: _token,
    type: _type,
    ...rest
  } = command;
  return rest;
}
