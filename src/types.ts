export type ViewMode =
  | "assembled"
  | "exploded"
  | "print_layout"
  | "clearance_check"
  | "flight_sim";

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
