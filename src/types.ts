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

export interface ComponentVisibility {
  frame: boolean;
  propulsion: boolean;
  electronics: boolean;
  accessories: boolean;
}

export interface ViewSettings {
  wireframe: boolean;
  focus: ComponentFocus;
  visibility: ComponentVisibility;
}

export interface SimSettings {
  motorAudioEnabled: boolean;
  motorAudioVolume: number; // 0..1
  vibrationAmount: number; // 0..1
}

export interface DebugSettings {
  physicsLines: boolean;
  flightTelemetry: boolean;
}

export interface FlightTelemetry {
  throttle01: number;
  thrustN: number;
  weightN: number;
  tw: number;
  altitudeM: number;
  speedMS: number;
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
