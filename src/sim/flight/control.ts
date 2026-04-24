export type FlightKey = "w" | "a" | "s" | "d" | "space" | "shift" | "q" | "e";

export type FlightKeyState = Record<FlightKey, boolean>;

export function createFlightKeyState(): FlightKeyState {
  return {
    w: false,
    a: false,
    s: false,
    d: false,
    space: false,
    shift: false,
    q: false,
    e: false,
  };
}

export function resetFlightKeyState(keys: FlightKeyState) {
  for (const key of Object.keys(keys) as FlightKey[]) {
    keys[key] = false;
  }
}

export function mapFlightKey(event: KeyboardEvent): FlightKey | null {
  const key = event.key.toLowerCase();
  const code = event.code;

  if (code === "Space" || key === " " || key === "space" || key === "spacebar") {
    return "space";
  }
  if (code === "ShiftLeft" || code === "ShiftRight" || key === "shift") {
    return "shift";
  }
  if (
    key === "w" ||
    key === "a" ||
    key === "s" ||
    key === "d" ||
    key === "q" ||
    key === "e"
  ) {
    return key;
  }

  return null;
}

export const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
export const clamp11 = (value: number) => Math.max(-1, Math.min(1, value));

export function applyDeadzone(value: number, deadzone: number) {
  const absValue = Math.abs(value);
  if (absValue <= deadzone) return 0;
  const shaped = (absValue - deadzone) / (1 - deadzone);
  return Math.sign(value) * shaped;
}

export function shapeCenteredCurve(value: number, expo: number) {
  const clamped = clamp11(value);
  const e = Math.max(0, Math.min(0.95, expo));
  return clamped * (1 - e) + clamped * clamped * clamped * e;
}

export function shapeThrottleCurve(value01: number, mid01: number, expo: number) {
  const value = clamp01(value01);
  const mid = Math.max(0.05, Math.min(0.95, mid01));
  const e = Math.max(0, Math.min(0.95, expo));
  const centered = value - mid;
  const sideScale = centered >= 0 ? 1 - mid : mid;
  if (sideScale < 1e-6) return value;
  const normalized = clamp11(centered / sideScale);
  return clamp01(mid + shapeCenteredCurve(normalized, e) * sideScale);
}

function toBetaflightNormalized(value: number) {
  return value > 5 ? value / 100 : value;
}

export function mapBetaflightRateDegPerSec(
  input: number,
  rcRateInput: number,
  superRateInput: number,
  expoInput: number,
) {
  const stick = clamp11(input);
  const rcRateBase = Math.max(0.01, Math.min(3, toBetaflightNormalized(rcRateInput)));
  const superRate = Math.max(0, Math.min(0.95, toBetaflightNormalized(superRateInput)));
  const expo = Math.max(0, Math.min(0.95, toBetaflightNormalized(expoInput)));
  const absStick = Math.abs(stick);
  let rcRate = rcRateBase;
  if (rcRate > 2) {
    rcRate += 14.54 * (rcRate - 2);
  }
  const expoStick = stick * (1 + expo * (stick * stick - 1));
  const baseRate = 200 * rcRate * expoStick;
  const superFactor = 1 / Math.max(0.01, 1 - absStick * superRate);
  return baseRate * superFactor;
}
