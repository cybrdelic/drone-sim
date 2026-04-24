import { DroneParams } from "../types";

export type PrintPackEntry = {
  name: string;
  qty: string;
  spec: string;
  fit: string;
};

export interface PrintPack {
  carbonSheetSize: number;
  tpuBedSize: number;
  strapPitch: number;
  carbonParts: PrintPackEntry[];
  tpuParts: PrintPackEntry[];
  referenceParts: PrintPackEntry[];
}

export function createPrintPack(params: DroneParams): PrintPack {
  const centerRadius = params.fcMounting / 2 + 10;
  const motorPadRadius = params.motorMountPattern / 2 + 3.5;
  const bottomPlateSpan =
    Math.SQRT1_2 * params.frameSize + motorPadRadius * 2 + 12;
  const topPlateWidth = params.fcMounting + 12;
  const topPlateDepth = params.fcMounting + 30;
  const carbonSheetSize = Math.max(
    300,
    Math.ceil(bottomPlateSpan + topPlateWidth + 72),
  );
  const strapPitch = centerRadius * 1.4;
  const isM3Motor = params.motorMountPattern >= 16;

  const carbonParts: PrintPackEntry[] = [
    {
      name: "Unibody bottom plate",
      qty: "1x",
      spec: `${bottomPlateSpan.toFixed(0)} mm envelope • ${params.plateThickness.toFixed(1)} mm carbon`,
      fit: `${params.motorMountPattern.toFixed(1)}×${params.motorMountPattern.toFixed(1)} mm motor pattern • ${params.motorCenterHole.toFixed(1)} mm center relief`,
    },
    {
      name: "Top plate",
      qty: "1x",
      spec: `${topPlateWidth.toFixed(1)} × ${topPlateDepth.toFixed(1)} mm • ${params.topPlateThickness.toFixed(1)} mm carbon`,
      fit: `${params.fcMounting.toFixed(1)}×${params.fcMounting.toFixed(1)} mm stack • strap slot pitch ${strapPitch.toFixed(1)} mm`,
    },
  ];

  const tpuParts: PrintPackEntry[] = params.showTPU
    ? [
        {
          name: "FPV camera cradle",
          qty: "3 pcs",
          spec: "2 side cheeks + 1 floor rail, all laid flat",
          fit: "19×19 mm micro camera envelope • 22 mm support faces",
        },
        {
          name: "Action cam mount",
          qty: "5 pcs",
          spec: "Base, twin forks, 2 cam lugs separated for clean printing",
          fit: "24×20 mm base • 15 mm fork faces • 15 mm lug discs",
        },
        {
          name: "Antenna mount pack",
          qty: "4 pcs",
          spec: "Rear bridge, VTX tube, 2 RX tubes",
          fit: `${params.standoffHeight.toFixed(0)} mm bridge length reference • 20/30 mm tube lengths`,
        },
        {
          name: "Motor bumpers",
          qty: "4 pcs",
          spec: "Separated TPU guards with cooling gap between copies",
          fit: `${(params.motorMountPattern / 2 + 4.5).toFixed(1)} mm inner radius target`,
        },
      ]
    : [];

  const referenceParts: PrintPackEntry[] = [
    {
      name: "Frame standoffs / spacers",
      qty: "4x",
      spec: `Purchased aluminum hex standoffs • M3 × ${params.standoffHeight.toFixed(0)} mm`,
      fit: `3.2 mm plate clearance • ${params.fcMounting.toFixed(1)}×${params.fcMounting.toFixed(1)} mm bolt square`,
    },
    {
      name: "Propellers",
      qty: "4x",
      spec: `Purchased ${params.propSize.toFixed(1)} in tri-blades; not included in print pack`,
      fit: "13 mm hub OD • 7 mm hub height • 4.4 mm modeled shaft land • 8 mm nyloc nut envelope",
    },
    {
      name: "Motors",
      qty: "4x",
      spec: `Purchased outrunners • ${params.motorMountPattern.toFixed(1)}×${params.motorMountPattern.toFixed(1)} mm bolt pattern`,
      fit: `${isM3Motor ? "M3" : "M2"} fasteners • ${params.motorCenterHole.toFixed(1)} mm center relief through arm pads`,
    },
    {
      name: "FC stack hardware",
      qty: "1 set",
      spec: `Purchased ${params.fcMounting.toFixed(1)}×${params.fcMounting.toFixed(1)} mm stack + screws/grommets`,
      fit: "4× M3 clearance holes • 14 mm screw shaft in model • nyloc top lock",
    },
    {
      name: "Battery retention",
      qty: "2x",
      spec: "Purchased nylon straps; not printed",
      fit: `20 × 3 mm slots on top plate • ${strapPitch.toFixed(1)} mm slot pitch`,
    },
  ];

  return {
    carbonSheetSize,
    tpuBedSize: 220,
    strapPitch,
    carbonParts,
    tpuParts,
    referenceParts,
  };
}
