import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RapierRigidBody, RigidBody } from "@react-three/rapier";
import React, { useDeferredValue, useMemo, useRef } from "react";
import * as THREE from "three";
import { ADDITION, Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import { DroneParams, FlightTelemetry, SimSettings, ViewSettings } from "../types";

function forEachTriangle(
  geometry: THREE.BufferGeometry,
  cb: (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => void,
) {
  const posAttr = geometry.getAttribute("position");
  if (!posAttr) return;
  const indexAttr = geometry.getIndex();

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  if (indexAttr) {
    for (let i = 0; i < indexAttr.count; i += 3) {
      const ia = indexAttr.getX(i);
      const ib = indexAttr.getX(i + 1);
      const ic = indexAttr.getX(i + 2);

      a.fromBufferAttribute(posAttr, ia);
      b.fromBufferAttribute(posAttr, ib);
      c.fromBufferAttribute(posAttr, ic);
      cb(a, b, c);
    }
    return;
  }

  for (let i = 0; i < posAttr.count; i += 3) {
    a.fromBufferAttribute(posAttr, i);
    b.fromBufferAttribute(posAttr, i + 1);
    c.fromBufferAttribute(posAttr, i + 2);
    cb(a, b, c);
  }
}

function computePolyMassPropsMm(
  geometry: THREE.BufferGeometry,
  densityKgM3: number,
) {
  // Computes volume/COM/inertia from a closed triangle mesh by summing signed tetrahedra (0,a,b,c).
  // Geometry coordinates are assumed to be in millimeters.
  const mmToM = 1e-3;

  let signedVolumeM3 = 0;
  const centroidTimesVolM4 = new THREE.Vector3(0, 0, 0);

  let intX2 = 0;
  let intY2 = 0;
  let intZ2 = 0;
  let intXY = 0;
  let intYZ = 0;
  let intZX = 0;

  forEachTriangle(geometry, (aMm, bMm, cMm) => {
    const ax = aMm.x * mmToM;
    const ay = aMm.y * mmToM;
    const az = aMm.z * mmToM;
    const bx = bMm.x * mmToM;
    const by = bMm.y * mmToM;
    const bz = bMm.z * mmToM;
    const cx = cMm.x * mmToM;
    const cy = cMm.y * mmToM;
    const cz = cMm.z * mmToM;

    const crossBxCx = by * cz - bz * cy;
    const crossByCy = bz * cx - bx * cz;
    const crossBzCz = bx * cy - by * cx;
    const v6 = ax * crossBxCx + ay * crossByCy + az * crossBzCz;
    const v = v6 / 6;
    if (!Number.isFinite(v) || Math.abs(v) < 1e-18) return;

    signedVolumeM3 += v;
    centroidTimesVolM4.x += (ax + bx + cx) * (v / 4);
    centroidTimesVolM4.y += (ay + by + cy) * (v / 4);
    centroidTimesVolM4.z += (az + bz + cz) * (v / 4);

    const f1 = (p: number, q: number, r: number) =>
      p * p + q * q + r * r + p * q + q * r + r * p;
    const f2 = (
      px: number,
      py: number,
      qx: number,
      qy: number,
      rx: number,
      ry: number,
    ) =>
      2 * (px * py + qx * qy + rx * ry) +
      (px * qy + py * qx) +
      (px * ry + py * rx) +
      (qx * ry + qy * rx);

    intX2 += (v / 10) * f1(ax, bx, cx);
    intY2 += (v / 10) * f1(ay, by, cy);
    intZ2 += (v / 10) * f1(az, bz, cz);
    intXY += (v / 20) * f2(ax, ay, bx, by, cx, cy);
    intYZ += (v / 20) * f2(ay, az, by, bz, cy, cz);
    intZX += (v / 20) * f2(az, ax, bz, bx, cz, cx);
  });

  if (!Number.isFinite(signedVolumeM3) || Math.abs(signedVolumeM3) < 1e-18) {
    return {
      signedVolumeMm3: 0,
      massKg: 0,
      comMm: new THREE.Vector3(0, 0, 0),
      inertiaKgM2_aboutCOM: new THREE.Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0),
    };
  }

  const sign = signedVolumeM3 < 0 ? -1 : 1;
  const volumeM3 = Math.abs(signedVolumeM3);
  const massKg = volumeM3 * densityKgM3;
  const comM = centroidTimesVolM4.clone().multiplyScalar(1 / signedVolumeM3);
  const comMm = comM.clone().multiplyScalar(1 / mmToM);

  const Ixx0 = sign * densityKgM3 * (intY2 + intZ2);
  const Iyy0 = sign * densityKgM3 * (intX2 + intZ2);
  const Izz0 = sign * densityKgM3 * (intX2 + intY2);
  const Ixy0 = -sign * densityKgM3 * intXY;
  const Iyz0 = -sign * densityKgM3 * intYZ;
  const Ixz0 = -sign * densityKgM3 * intZX;

  const I0 = new THREE.Matrix3().set(
    Ixx0,
    Ixy0,
    Ixz0,
    Ixy0,
    Iyy0,
    Iyz0,
    Ixz0,
    Iyz0,
    Izz0,
  );

  // Parallel-axis shift: inertia about COM.
  const r2 = comM.lengthSq();
  const rrT = new THREE.Matrix3().set(
    comM.x * comM.x,
    comM.x * comM.y,
    comM.x * comM.z,
    comM.y * comM.x,
    comM.y * comM.y,
    comM.y * comM.z,
    comM.z * comM.x,
    comM.z * comM.y,
    comM.z * comM.z,
  );
  const I3 = new THREE.Matrix3().identity();
  const shift = I3.multiplyScalar(r2);
  {
    const d = shift.elements;
    const s = rrT.elements;
    for (let i = 0; i < 9; i++) d[i] -= s[i];
  }
  shift.multiplyScalar(massKg);

  const Icom = I0.clone();
  {
    const d = Icom.elements;
    const s = shift.elements;
    for (let i = 0; i < 9; i++) d[i] -= s[i];
  }

  return {
    signedVolumeMm3: signedVolumeM3 / (mmToM * mmToM * mmToM),
    massKg,
    comMm,
    inertiaKgM2_aboutCOM: Icom,
  };
}

function boxInertiaDiagKgM2(massKg: number, sizeM: THREE.Vector3) {
  const x = sizeM.x;
  const y = sizeM.y;
  const z = sizeM.z;
  return new THREE.Vector3(
    (1 / 12) * massKg * (y * y + z * z),
    (1 / 12) * massKg * (x * x + z * z),
    (1 / 12) * massKg * (x * x + y * y),
  );
}

function Annotation({
  title,
  description,
  position,
  flip = false,
}: {
  title: string;
  description: string;
  position: [number, number, number];
  flip?: boolean;
}) {
  return (
    <Html position={position} center distanceFactor={100}>
      <div
        className={`flex items-center gap-2 pointer-events-none ${
          flip ? "flex-row-reverse" : "flex-row"
        }`}
      >
        <div className="w-16 h-[1px] bg-emerald-500/50" />
        <div className="bg-neutral-900/90 backdrop-blur border border-emerald-500/30 p-2 rounded text-left min-w-[120px]">
          <div className="text-[9px] font-bold text-emerald-400 uppercase tracking-wider">
            {title}
          </div>
          <div className="text-[8px] text-neutral-400 leading-tight mt-0.5">
            {description}
          </div>
        </div>
      </div>
    </Html>
  );
}

interface DroneModelProps {
  params: DroneParams;
  viewSettings?: ViewSettings;
  simSettings?: SimSettings;
  groupRef: React.RefObject<THREE.Group | null>;
  flightTelemetryRef?: React.MutableRefObject<FlightTelemetry>;
  waypoints?: THREE.Vector3[];
  isFlyingPath?: boolean;
  onFlightComplete?: () => void;
  controlSensitivity?: number;
}

export function DroneModel({
  params,
  viewSettings,
  simSettings,
  groupRef,
  flightTelemetryRef,
  waypoints = [],
  isFlyingPath = false,
  onFlightComplete,
  controlSensitivity = 0.45,
}: DroneModelProps) {
  const effectiveViewSettings: ViewSettings =
    viewSettings ??
    ({
      wireframe: false,
      focus: "all",
      visibility: {
        frame: true,
        propulsion: true,
        electronics: true,
        accessories: true,
      },
    } as ViewSettings);

  const effectiveSimSettings: SimSettings =
    simSettings ??
    ({
      motorAudioEnabled: false,
      motorAudioVolume: 0.35,
      vibrationAmount: 0.35,
    } as SimSettings);

  const deferredParams = useDeferredValue(params);

  const {
    frameSize,
    plateThickness,
    topPlateThickness,
    standoffHeight,
    armWidth,
    fcMounting,
    motorMountPattern,
    motorCenterHole,
    weightReduction,
    propSize,
    showTPU,
    tpuColor,
    viewMode,
  } = deferredParams;

  const propGroupRefs = useRef<Array<THREE.Group | null>>([]);
  const propSpinRad = useRef<number[]>([0, 0, 0, 0]);
  const flightBodyRef = useRef<RapierRigidBody | null>(null);
  const flightInitDone = useRef(false);

  const visualJitterRef = useRef<THREE.Group | null>(null);

  const audioRef = useRef<{
    ctx: AudioContext;
    master: GainNode;
    motorOsc: OscillatorNode[];
    motorGain: GainNode[];
    noiseSrc: AudioBufferSourceNode;
    noiseGain: GainNode;
    noiseHp: BiquadFilterNode;
  } | null>(null);

  const audioTelemetry = useRef({
    omegaRad: [0, 0, 0, 0] as number[],
    omegaMaxRad: 1 as number,
    mechPowerW: 0 as number,
    thrustTotalN: 0 as number,
  });

  // Materials
  const carbonMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#1a1a1a",
        roughness: 0.7,
        metalness: 0.3,
      }),
    [],
  );

  const aluminumMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#e11d48", // Anodized Red
        roughness: 0.3,
        metalness: 0.8,
      }),
    [],
  );

  const propMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#10b981", // Emerald green
        transparent: true,
        opacity: 0.2,
        roughness: 0.1,
        metalness: 0.1,
        side: THREE.DoubleSide,
      }),
    [],
  );

  const fcMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#262626", // Dark grey PCB
        roughness: 0.9,
        metalness: 0.1,
      }),
    [],
  );

  const tpuMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: tpuColor,
        roughness: 0.8,
        metalness: 0.1,
      }),
    [tpuColor],
  );

  // --- Fastener materials ---
  const steelMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#2a2a2a",
        roughness: 0.25,
        metalness: 0.95,
      }),
    [],
  );

  const nylonMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#f5f5f5",
        roughness: 0.7,
        metalness: 0.05,
      }),
    [],
  );

  const rubberMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#333333",
        roughness: 0.95,
        metalness: 0.0,
      }),
    [],
  );

  const brassMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#d4a017",
        roughness: 0.3,
        metalness: 0.9,
      }),
    [],
  );

  // --- Reusable fastener geometries ---
  const screwGeos = useMemo(() => {
    // M3 button-head cap screw (BHCS): head ⌀5.7×1.65mm, shaft ⌀3×variable
    const m3HeadGeo = new THREE.CylinderGeometry(2.85, 2.85, 1.65, 16);
    // Socket drive hex recess (cosmetic)
    const m3DriveGeo = new THREE.CylinderGeometry(1.3, 1.3, 0.8, 6);
    // M3 shaft (length parameterized at render time via scale)
    const m3ShaftGeo = new THREE.CylinderGeometry(1.5, 1.5, 1, 12);
    // M3 nylon lock nut: ⌀6.01 hex × 4mm (modeled as cylinder for perf)
    const m3NutGeo = new THREE.CylinderGeometry(3.0, 3.0, 4, 6);
    // M3 nylon insert ring
    const m3NylonRingGeo = new THREE.CylinderGeometry(2.8, 2.8, 1.2, 16);
    // FC soft-mount grommet: ⌀7×3mm rubber with ⌀3.2 through-hole
    const m3GrommetGeo = new THREE.TorusGeometry(3.5, 1.5, 8, 16);
    // M2 screw head (for smaller motor patterns)
    const m2HeadGeo = new THREE.CylinderGeometry(2.0, 2.0, 1.2, 16);
    const m2ShaftGeo = new THREE.CylinderGeometry(1.0, 1.0, 1, 12);
    // Prop nut (self-locking): ⌀8 flange × 5mm
    const propNutGeo = new THREE.CylinderGeometry(4.0, 3.5, 5, 6);
    // Battery strap (nylon webbing): flat box, rendered at usage site
    const strapGeo = new THREE.BoxGeometry(12, 1.5, 3);

    return {
      m3HeadGeo, m3DriveGeo, m3ShaftGeo, m3NutGeo, m3NylonRingGeo,
      m3GrommetGeo, m2HeadGeo, m2ShaftGeo, propNutGeo, strapGeo,
    };
  }, []);

  const propBladeGeo = useMemo(() => {
    const propR = (propSize * 25.4) / 2;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.bezierCurveTo(
      propR * 0.2,
      propR * 0.2,
      propR * 0.8,
      propR * 0.15,
      propR,
      0,
    );
    shape.bezierCurveTo(
      propR * 0.8,
      -propR * 0.1,
      propR * 0.2,
      -propR * 0.15,
      0,
      0,
    );

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.4,
      bevelEnabled: true,
      bevelThickness: 0.1,
      bevelSize: 0.1,
      bevelSegments: 2,
    });
    geo.rotateX(-Math.PI / 2); // Lay it flat
    return geo;
  }, [propSize]);

  const evaluator = useMemo(() => {
    const ev = new Evaluator();
    ev.useGroups = false;
    return ev;
  }, []);

  // Generate Geometry
  const { bottomPlateGeo, topPlateGeo, standoffsData, motorPositions } =
    useMemo(() => {
      const centerRadius = fcMounting / 2 + 10;
      const armLength = frameSize / 2;
      const motorPadRadius = motorMountPattern / 2 + 3.5;
      const screwHoleRadius = motorMountPattern >= 16 ? 1.6 : 1.1; // M3 vs M2
      const mPositions: [number, number, number][] = [];

      // --- 1. BOTTOM PLATE (Unibody) ---
      // Central Body
      const baseGeo = new THREE.CylinderGeometry(
        centerRadius,
        centerRadius,
        plateThickness,
        32,
      );
      let bottomBrush = new Brush(baseGeo);
      bottomBrush.position.y = plateThickness / 2;
      bottomBrush.updateMatrixWorld();

      // Arms & Motor Pads
      for (let i = 0; i < 4; i++) {
        const angle = i * (Math.PI / 2) + Math.PI / 4;
        const cX = Math.cos(angle) * (armLength / 2);
        const cZ = Math.sin(angle) * (armLength / 2);

        // Arm
        const armGeo = new THREE.BoxGeometry(
          armWidth,
          plateThickness,
          armLength,
        );
        const armBrush = new Brush(armGeo);
        armBrush.position.set(cX, plateThickness / 2, cZ);
        armBrush.lookAt(cX * 2, plateThickness / 2, cZ * 2);
        armBrush.updateMatrixWorld();
        bottomBrush = evaluator.evaluate(bottomBrush, armBrush, ADDITION);

        // Motor Pad
        const mX = Math.cos(angle) * armLength;
        const mZ = Math.sin(angle) * armLength;
        mPositions.push([mX, plateThickness, mZ]);

        const padGeo = new THREE.CylinderGeometry(
          motorPadRadius,
          motorPadRadius,
          plateThickness,
          32,
        );
        const padBrush = new Brush(padGeo);
        padBrush.position.set(mX, plateThickness / 2, mZ);
        padBrush.updateMatrixWorld();
        bottomBrush = evaluator.evaluate(bottomBrush, padBrush, ADDITION);
      }

      // Subtractions (Holes)
      const holesToSubtract: Brush[] = [];

      // FC Stack Holes
      const fcOffset = fcMounting / 2;
      const fcHoleGeo = new THREE.CylinderGeometry(
        1.6,
        1.6,
        plateThickness * 4,
        16,
      );
      for (const dx of [-1, 1]) {
        for (const dz of [-1, 1]) {
          const fcHole = new Brush(fcHoleGeo);
          fcHole.position.set(dx * fcOffset, plateThickness / 2, dz * fcOffset);
          fcHole.updateMatrixWorld();
          holesToSubtract.push(fcHole);
        }
      }

      // Motor Holes & Weight Reduction
      for (let i = 0; i < 4; i++) {
        const angle = i * (Math.PI / 2) + Math.PI / 4;
        const mX = Math.cos(angle) * armLength;
        const mZ = Math.sin(angle) * armLength;

        // Center Shaft Hole
        const cHole = new Brush(
          new THREE.CylinderGeometry(
            motorCenterHole / 2,
            motorCenterHole / 2,
            plateThickness * 4,
            16,
          ),
        );
        cHole.position.set(mX, plateThickness / 2, mZ);
        cHole.updateMatrixWorld();
        holesToSubtract.push(cHole);

        // Motor Screw Holes (4 per motor)
        for (let j = 0; j < 4; j++) {
          const sAngle = j * (Math.PI / 2);
          const sX = mX + Math.cos(sAngle) * (motorMountPattern / 2);
          const sZ = mZ + Math.sin(sAngle) * (motorMountPattern / 2);
          const sHole = new Brush(
            new THREE.CylinderGeometry(
              screwHoleRadius,
              screwHoleRadius,
              plateThickness * 4,
              16,
            ),
          );
          sHole.position.set(sX, plateThickness / 2, sZ);
          sHole.updateMatrixWorld();
          holesToSubtract.push(sHole);
        }

        // Arm Weight Reduction Cutouts
        if (weightReduction > 0) {
          const cutoutWidth = armWidth * (weightReduction / 100) * 0.7;
          const cutoutLength = armLength * 0.5;
          if (cutoutWidth > 2) {
            const cutoutGeo = new THREE.CapsuleGeometry(
              cutoutWidth / 2,
              cutoutLength,
              8,
              16,
            );
            cutoutGeo.rotateX(Math.PI / 2);
            const cutout = new Brush(cutoutGeo);
            const cX_cut = Math.cos(angle) * (armLength * 0.45);
            const cZ_cut = Math.sin(angle) * (armLength * 0.45);
            cutout.position.set(cX_cut, plateThickness / 2, cZ_cut);
            cutout.lookAt(cX_cut * 2, plateThickness / 2, cZ_cut * 2);
            cutout.updateMatrixWorld();
            holesToSubtract.push(cutout);
          }
        }
      }

      for (const hole of holesToSubtract) {
        bottomBrush = evaluator.evaluate(bottomBrush, hole, SUBTRACTION);
      }

      // --- 2. TOP PLATE ---
      // Create a rounded rectangle
      const topBaseGeo = new THREE.BoxGeometry(
        fcMounting + 12,
        topPlateThickness,
        fcMounting + 30,
      );
      let topBrush = new Brush(topBaseGeo);
      topBrush.position.y = topPlateThickness / 2;
      topBrush.updateMatrixWorld();

      for (const dx of [-1, 1]) {
        for (const dz of [-1, 1]) {
          const corner = new Brush(
            new THREE.CylinderGeometry(6, 6, topPlateThickness, 16),
          );
          corner.position.set(
            dx * (fcMounting / 2),
            topPlateThickness / 2,
            dz * (fcMounting / 2 + 9),
          );
          corner.updateMatrixWorld();
          topBrush = evaluator.evaluate(topBrush, corner, ADDITION);
        }
      }

      // Top Plate Subtractions
      const topHoles: Brush[] = [];

      // Standoff Screw Holes
      for (const dx of [-1, 1]) {
        for (const dz of [-1, 1]) {
          const fcHole = new Brush(fcHoleGeo);
          fcHole.position.set(
            dx * fcOffset,
            topPlateThickness / 2,
            dz * fcOffset,
          );
          fcHole.updateMatrixWorld();
          topHoles.push(fcHole);
        }
      }

      // Battery Strap Slots
      const strapGeo = new THREE.BoxGeometry(20, topPlateThickness * 4, 3);
      for (const dz of [-centerRadius * 0.7, centerRadius * 0.7]) {
        const strap = new Brush(strapGeo);
        strap.position.set(0, topPlateThickness / 2, dz);
        strap.updateMatrixWorld();
        topHoles.push(strap);
      }

      for (const hole of topHoles) {
        topBrush = evaluator.evaluate(topBrush, hole, SUBTRACTION);
      }

      // --- 3. STANDOFFS DATA ---
      const standoffs = [];
      for (const dx of [-1, 1]) {
        for (const dz of [-1, 1]) {
          standoffs.push([dx * fcOffset, 0, dz * fcOffset] as [
            number,
            number,
            number,
          ]);
        }
      }

      return {
        bottomPlateGeo: bottomBrush.geometry,
        topPlateGeo: topBrush.geometry,
        standoffsData: standoffs,
        motorPositions: mPositions,
      };
    }, [
      frameSize,
      plateThickness,
      topPlateThickness,
      standoffHeight,
      armWidth,
      fcMounting,
      motorMountPattern,
      motorCenterHole,
      weightReduction,
      evaluator,
    ]);

  // Clearance check: compute prop-to-prop and prop-to-frame distances
  const clearanceData = useMemo(() => {
    if (viewMode !== "clearance_check") return null;
    const propR = (propSize * 25.4) / 2;
    const results: { type: string; distance: number; posA: THREE.Vector3; posB: THREE.Vector3; severity: "ok" | "warn" | "fail" }[] = [];

    // Prop-to-prop clearance
    for (let i = 0; i < motorPositions.length; i++) {
      for (let j = i + 1; j < motorPositions.length; j++) {
        const a = new THREE.Vector3(...motorPositions[i]);
        const b = new THREE.Vector3(...motorPositions[j]);
        const dist2D = Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
        const gap = dist2D - 2 * propR;
        results.push({
          type: `Prop ${i + 1}↔${j + 1}`,
          distance: gap,
          posA: a,
          posB: b,
          severity: gap < 0 ? "fail" : gap < 3 ? "warn" : "ok",
        });
      }
    }

    // Prop-to-frame body clearance (prop tip to center body edge)
    const centerRadius = fcMounting / 2 + 10;
    for (let i = 0; i < motorPositions.length; i++) {
      const mp = new THREE.Vector3(...motorPositions[i]);
      const distToCenter = Math.sqrt(mp.x ** 2 + mp.z ** 2);
      const tipInward = distToCenter - propR;
      const gap = tipInward - centerRadius;
      results.push({
        type: `Prop ${i + 1}↔Body`,
        distance: gap,
        posA: mp,
        posB: new THREE.Vector3(0, mp.y, 0),
        severity: gap < 0 ? "fail" : gap < 2 ? "warn" : "ok",
      });
    }

    // Prop-to-arm clearance: distance from prop disk edge to neighboring arm
    for (let i = 0; i < motorPositions.length; i++) {
      const mp = new THREE.Vector3(...motorPositions[i]);
      for (const offset of [-1, 1]) {
        const j = (i + offset + 4) % 4;
        const armAngle = j * (Math.PI / 2) + Math.PI / 4;
        const armDir = new THREE.Vector2(Math.cos(armAngle), Math.sin(armAngle));
        const mPos2D = new THREE.Vector2(mp.x, mp.z);
        const proj = armDir.clone().multiplyScalar(mPos2D.dot(armDir));
        const perpDist = mPos2D.clone().sub(proj).length();
        const gap = perpDist - propR - armWidth / 2;
        if (gap < 5) {
          results.push({
            type: `Prop ${i + 1}↔Arm ${j + 1}`,
            distance: gap,
            posA: mp,
            posB: new THREE.Vector3(proj.x, mp.y, proj.y),
            severity: gap < 0 ? "fail" : gap < 2 ? "warn" : "ok",
          });
        }
      }
    }

    return results;
  }, [viewMode, propSize, motorPositions, fcMounting, armWidth]);

  const bottomPlateTopY = useMemo(() => {
    bottomPlateGeo.computeBoundingBox();
    const bb = bottomPlateGeo.boundingBox;
    return bb ? bb.max.y : plateThickness;
  }, [bottomPlateGeo, plateThickness]);

  const bottomPlateMinY = useMemo(() => {
    bottomPlateGeo.computeBoundingBox();
    const bb = bottomPlateGeo.boundingBox;
    return bb ? bb.min.y : -plateThickness;
  }, [bottomPlateGeo, plateThickness]);

  const topPlateTopY = useMemo(() => {
    topPlateGeo.computeBoundingBox();
    const bb = topPlateGeo.boundingBox;
    return bb ? bb.max.y : topPlateThickness;
  }, [topPlateGeo, topPlateThickness]);

  // Layout Logic based on viewMode
  let bottomPos: [number, number, number] = [0, 0, 0];
  let topPos: [number, number, number] = [
    0,
    bottomPlateTopY + standoffHeight,
    0,
  ];
  let standoffY = bottomPlateTopY + standoffHeight / 2;
  let showStandoffs = true;

  const exploded = viewMode === "exploded";
  const explodeMotorY = exploded ? 18 : 0;
  const explodeStackY = exploded ? 28 : 0;
  const explodeCameraY = exploded ? 38 : 0;
  const explodeBatteryY = exploded ? 48 : 0;
  const explodeTpuY = exploded ? 34 : 0;

  // Physics should be enabled in all modes except exploded + print layout.
  // Exploded is intentionally non-physical; print layout is a CAD layout view.
  const physicsEnabled = viewMode !== "exploded" && viewMode !== "print_layout";

  // Coarse single-body collider for assembled/clearance views.
  const assemblyHalfExtents: [number, number, number] = [
    frameSize * 0.5,
    35,
    frameSize * 0.5,
  ];
  const assemblyColliderCenterY = bottomPlateMinY + assemblyHalfExtents[1];
  const assemblySpawnLiftY = -bottomPlateMinY + 1;

  if (viewMode === "exploded") {
    topPos = [0, bottomPlateTopY + standoffHeight + 30, 0];
    standoffY = bottomPlateTopY + standoffHeight / 2 + 15;
  } else if (viewMode === "print_layout") {
    bottomPos = [0, 0, 0];
    topPos = [fcMounting + 40, 0, 0]; // Place next to bottom plate
    showStandoffs = false; // Don't print aluminum standoffs
  }

  // Flight Simulator Logic
  const keys = useRef({
    w: false,
    a: false,
    s: false,
    d: false,
    space: false,
    shift: false,
    q: false,
    e: false,
  });

  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

  React.useEffect(() => {
    // Wireframe toggle for all materials (including inline materials).
    if (!groupRef.current) return;
    groupRef.current.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (!material) return;
      const apply = (m: THREE.Material) => {
        const anyMat = m as any;
        if (typeof anyMat.wireframe === "boolean") {
          anyMat.wireframe = effectiveViewSettings.wireframe;
          m.needsUpdate = true;
        }
      };
      if (Array.isArray(material)) material.forEach(apply);
      else apply(material);
    });
  }, [groupRef, effectiveViewSettings.wireframe]);

  React.useEffect(() => {
    // Create/tear down motor audio nodes.
    if (!effectiveSimSettings.motorAudioEnabled) {
      if (audioRef.current) {
        try {
          audioRef.current.motorOsc.forEach((o) => o.stop());
          audioRef.current.noiseSrc.stop();
          audioRef.current.ctx.close();
        } catch {
          // ignore
        }
        audioRef.current = null;
      }
      return;
    }

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx: AudioContext = new AudioCtx({ latencyHint: "interactive" });
    void ctx.resume().catch(() => {
      // Autoplay policies: user interaction is still required.
    });

    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);

    const motorOsc: OscillatorNode[] = [];
    const motorGain: GainNode[] = [];
    for (let i = 0; i < 4; i++) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = 60;
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(g);
      g.connect(master);
      osc.start();
      motorOsc.push(osc);
      motorGain.push(g);
    }

    // Broadband noise component for "whoosh" / turbulence.
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;
    noiseSrc.loop = true;

    const noiseHp = ctx.createBiquadFilter();
    noiseHp.type = "highpass";
    noiseHp.frequency.value = 400;
    noiseHp.Q.value = 0.7;

    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;

    noiseSrc.connect(noiseHp);
    noiseHp.connect(noiseGain);
    noiseGain.connect(master);
    noiseSrc.start();

    audioRef.current = { ctx, master, motorOsc, motorGain, noiseSrc, noiseGain, noiseHp };

    return () => {
      if (!audioRef.current) return;
      try {
        audioRef.current.motorOsc.forEach((o) => o.stop());
        audioRef.current.noiseSrc.stop();
        audioRef.current.ctx.close();
      } catch {
        // ignore
      }
      audioRef.current = null;
    };
  }, [effectiveSimSettings.motorAudioEnabled]);

  const massProps = useMemo(() => {
    const mmToM = 1e-3;
    const carbonDensityKgM3 = 1600;

    // Plate mass properties from the actual generated CAD triangle meshes.
    const bottomPlate = computePolyMassPropsMm(bottomPlateGeo, carbonDensityKgM3);
    const topPlate = computePolyMassPropsMm(topPlateGeo, carbonDensityKgM3);

    // Assembled offsets (mm)
    const bottomOffsetMm = new THREE.Vector3(0, 0, 0);
    const topOffsetMm = new THREE.Vector3(0, plateThickness + standoffHeight, 0);

    const bottomComMm = bottomPlate.comMm.clone().add(bottomOffsetMm);
    const topComMm = topPlate.comMm.clone().add(topOffsetMm);

    // Other components as point masses.
    const motorMassKg = (propSize >= 7 ? 45 : propSize >= 5 ? 32 : 12) / 1000;
    const batteryMassKg = (propSize >= 7 ? 250 : propSize >= 5 ? 180 : 65) / 1000;
    const stackMassKg = 18 / 1000;
    const propMassKg = (propSize * 0.8) / 1000;
    const miscMassKg = 20 / 1000;

    const motorTotalMassKg = (motorMassKg + propMassKg) * 4;

    const batteryPosMm = new THREE.Vector3(
      0,
      topOffsetMm.y + topPlateThickness + 15,
      0,
    );
    const stackPosMm = new THREE.Vector3(0, plateThickness + 10, 0);
    const motorPosMm = motorPositions.map((p) => new THREE.Vector3(p[0], p[1], p[2]));

    const totalMassKg = Math.max(
      0.05,
      bottomPlate.massKg +
        topPlate.massKg +
        motorTotalMassKg +
        batteryMassKg +
        stackMassKg +
        miscMassKg,
    );

    // Total COM (mm)
    const comMm = new THREE.Vector3(0, 0, 0);
    comMm.add(bottomComMm.clone().multiplyScalar(bottomPlate.massKg));
    comMm.add(topComMm.clone().multiplyScalar(topPlate.massKg));
    comMm.add(batteryPosMm.clone().multiplyScalar(batteryMassKg));
    comMm.add(stackPosMm.clone().multiplyScalar(stackMassKg));
    for (const mp of motorPosMm) {
      comMm.add(mp.clone().multiplyScalar(motorMassKg + propMassKg));
    }
    comMm.divideScalar(totalMassKg);

    const I3 = new THREE.Matrix3().identity();
    const addShift = (m: number, rM: THREE.Vector3) => {
      const r2 = rM.lengthSq();
      const rrT = new THREE.Matrix3().set(
        rM.x * rM.x,
        rM.x * rM.y,
        rM.x * rM.z,
        rM.y * rM.x,
        rM.y * rM.y,
        rM.y * rM.z,
        rM.z * rM.x,
        rM.z * rM.y,
        rM.z * rM.z,
      );
      const out = I3.clone().multiplyScalar(r2);
      {
        const d = out.elements;
        const s = rrT.elements;
        for (let i = 0; i < 9; i++) d[i] -= s[i];
      }
      return out.multiplyScalar(m);
    };

    const addMat3InPlace = (dst: THREE.Matrix3, src: THREE.Matrix3) => {
      const d = dst.elements;
      const s = src.elements;
      for (let i = 0; i < 9; i++) d[i] += s[i];
    };

    // Total inertia about total COM
    const inertiaKgM2 = new THREE.Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0);

    // Plates: shift each plate's inertia-about-its-own-COM to total COM.
    {
      const shiftB = addShift(
        bottomPlate.massKg,
        bottomComMm.clone().sub(comMm).multiplyScalar(mmToM),
      );
      const plateB = bottomPlate.inertiaKgM2_aboutCOM.clone();
      addMat3InPlace(plateB, shiftB);
      addMat3InPlace(inertiaKgM2, plateB);
    }

    {
      const shiftT = addShift(
        topPlate.massKg,
        topComMm.clone().sub(comMm).multiplyScalar(mmToM),
      );
      const plateT = topPlate.inertiaKgM2_aboutCOM.clone();
      addMat3InPlace(plateT, shiftT);
      addMat3InPlace(inertiaKgM2, plateT);
    }

    // Point masses
    addMat3InPlace(
      inertiaKgM2,
      addShift(
        batteryMassKg,
        batteryPosMm.clone().sub(comMm).multiplyScalar(mmToM),
      ),
    );
    addMat3InPlace(
      inertiaKgM2,
      addShift(stackMassKg, stackPosMm.clone().sub(comMm).multiplyScalar(mmToM)),
    );
    for (const mp of motorPosMm) {
      addMat3InPlace(
        inertiaKgM2,
        addShift(
          motorMassKg + propMassKg,
          mp.clone().sub(comMm).multiplyScalar(mmToM),
        ),
      );
    }
    addMat3InPlace(inertiaKgM2, addShift(miscMassKg, new THREE.Vector3(0, 0, 0)));

    // Clamp diagonal to avoid singularities.
    inertiaKgM2.elements[0] = Math.max(inertiaKgM2.elements[0], 1e-7);
    inertiaKgM2.elements[4] = Math.max(inertiaKgM2.elements[4], 1e-7);
    inertiaKgM2.elements[8] = Math.max(inertiaKgM2.elements[8], 1e-7);

    // Invert once for angular dynamics.
    const invInertiaKgM2 = inertiaKgM2.clone();
    const det = invInertiaKgM2.determinant();
    if (!Number.isFinite(det) || Math.abs(det) < 1e-18) {
      inertiaKgM2.elements[0] += 1e-6;
      inertiaKgM2.elements[4] += 1e-6;
      inertiaKgM2.elements[8] += 1e-6;
      invInertiaKgM2.copy(inertiaKgM2);
    }
    invInertiaKgM2.invert();

    return {
      massKg: totalMassKg,
      comMm,
      inertiaKgM2,
      invInertiaKgM2,
    };
  }, [
    bottomPlateGeo,
    motorPositions,
    plateThickness,
    propSize,
    standoffHeight,
    topPlateGeo,
    topPlateThickness,
  ]);

  const flightColliderOffset: [number, number, number] = [
    -massProps.comMm.x,
    -massProps.comMm.y,
    -massProps.comMm.z,
  ];
  // Flight sim should start on the ground, stationary.
  // Ground plane top surface is at y=0 (mm). Place the cuboid collider so its bottom
  // just touches the ground (slight epsilon avoids initial penetration).
  const flightSpawnLiftY = useMemo(() => {
    const halfY = assemblyHalfExtents[1];
    const colliderLocalY = assemblyColliderCenterY - massProps.comMm.y;
    const epsilonMm = 0.2;
    return halfY - colliderLocalY + epsilonMm;
  }, [assemblyHalfExtents[1], assemblyColliderCenterY, massProps.comMm.y]);

  // Compute the correct collider density so Rapier gets the right total mass.
  // Volume of the cuboid = 8 * hx * hy * hz (in mm³ since world is mm-scale).
  const colliderVolumeMm3 =
    8 * assemblyHalfExtents[0] * assemblyHalfExtents[1] * assemblyHalfExtents[2];
  const colliderDensity = colliderVolumeMm3 > 0 ? massProps.massKg / colliderVolumeMm3 : 1e-7;

  const propulsion = useMemo(() => {
    const airDensityKgM3 = 1.225;
    const diameterM = propSize * 0.0254;

    // Default pitch assumptions by class (edit these if you know your actual prop pitch)
    const propPitchIn = propSize >= 7 ? 4.0 : propSize >= 5 ? 4.3 : 3.1;
    const pitchM = propPitchIn * 0.0254;
    const pitchRatio = diameterM > 1e-6 ? pitchM / diameterM : 0.4;

    // Typical-ish coefficient ranges for small multirotor props.
    const Ct0 = THREE.MathUtils.clamp(0.08 + 0.08 * (pitchRatio - 0.4), 0.06, 0.16);
    const Cq0 = THREE.MathUtils.clamp(Ct0 * 0.09, 0.005, 0.03);

    // Default motor KV + battery based on prop class (edit to match your build)
    const motorKV = propSize >= 7 ? 1300 : propSize >= 5 ? 1950 : 3800;
    const batteryCells = propSize >= 5 ? 6 : 4;
    const vOpenPerCell = 3.85;
    const packRintOhm = propSize >= 5 ? 0.02 : 0.028;
    const motorEff = 0.85;
    const motorTauSec = 0.055;

    // Frame flex + tolerances
    const staticMisalignDeg = 0.6;
    const flexRadPerN = propSize >= 5 ? 0.00035 : 0.0006;
    const flexTauSec = 0.08;

    // IMU vib/noise
    const imuRateNoiseStdRad = 0.03;
    const vibRateAmpRad = 0.22;

    return {
      airDensityKgM3,
      diameterM,
      propPitchIn,
      Ct0,
      Cq0,
      motorKV,
      batteryCells,
      vOpenPerCell,
      packRintOhm,
      motorEff,
      motorTauSec,
      staticMisalignDeg,
      flexRadPerN,
      flexTauSec,
      imuRateNoiseStdRad,
      vibRateAmpRad,
    };
  }, [propSize]);

  const mulMat3Vec = (m: THREE.Matrix3, v: THREE.Vector3) => {
    const e = m.elements;
    return new THREE.Vector3(
      e[0] * v.x + e[3] * v.y + e[6] * v.z,
      e[1] * v.x + e[4] * v.y + e[7] * v.z,
      e[2] * v.x + e[5] * v.y + e[8] * v.z,
    );
  };

  const solve4x4 = (A: number[][], b: number[]) => {
    // Gaussian elimination with partial pivoting. Mutates copies only.
    const M = A.map((row) => row.slice());
    const x = b.slice();

    for (let col = 0; col < 4; col++) {
      let pivot = col;
      let pivotAbs = Math.abs(M[col][col]);
      for (let r = col + 1; r < 4; r++) {
        const v = Math.abs(M[r][col]);
        if (v > pivotAbs) {
          pivotAbs = v;
          pivot = r;
        }
      }

      if (pivotAbs < 1e-9) return null;

      if (pivot !== col) {
        const tmpRow = M[col];
        M[col] = M[pivot];
        M[pivot] = tmpRow;
        const tmpX = x[col];
        x[col] = x[pivot];
        x[pivot] = tmpX;
      }

      const div = M[col][col];
      for (let c = col; c < 4; c++) M[col][c] /= div;
      x[col] /= div;

      for (let r = 0; r < 4; r++) {
        if (r === col) continue;
        const f = M[r][col];
        for (let c = col; c < 4; c++) M[r][c] -= f * M[col][c];
        x[r] -= f * x[col];
      }
    }

    return x;
  };

  const flightState = useRef({
    posM: new THREE.Vector3(0, 0, 0),
    velM: new THREE.Vector3(0, 0, 0),
    quat: new THREE.Quaternion(),
    omegaBody: new THREE.Vector3(0, 0, 0),
    armed: false as boolean,
    motorOmegaRad: [0, 0, 0, 0] as number[],
    motorTiltRad: [0, 0, 0, 0] as number[],
    motorPhaseRad: [0, 0, 0, 0] as number[],
    batteryV: 0 as number,
    batteryI: 0 as number,
    throttle01: 0 as number,
    targetWpIndex: 1 as number,
    rng: 123456789 as number,
    // Wind model state
    windPhase: null as number[] | null,
    windTime: 0 as number,
  });

  const prevViewModeRef = useRef(viewMode);

  React.useEffect(() => {
    const prev = prevViewModeRef.current;
    prevViewModeRef.current = viewMode;

    // Reset flight state when ENTERING flight sim.
    // This guarantees a consistent start: on the ground, not moving, motors disarmed.
    if (prev !== "flight_sim" && viewMode === "flight_sim") {
      flightInitDone.current = false;
      flightState.current.posM.set(0, 0, 0);
      flightState.current.velM.set(0, 0, 0);
      flightState.current.omegaBody.set(0, 0, 0);
      flightState.current.quat.identity();
      flightState.current.armed = false;
      flightState.current.motorOmegaRad = [0, 0, 0, 0];
      flightState.current.motorTiltRad = [0, 0, 0, 0];
      flightState.current.motorPhaseRad = [0, 0, 0, 0];
      flightState.current.batteryV = propulsion.batteryCells * propulsion.vOpenPerCell;
      flightState.current.batteryI = 0;
      flightState.current.throttle01 = 0;
      flightState.current.targetWpIndex = 1;
      flightState.current.rng = 123456789;
      flightState.current.windPhase = null;
      flightState.current.windTime = 0;
    }

    // Reset flight state when leaving flight sim or when a new flight starts.
    if (viewMode !== "flight_sim") {
      flightState.current.posM.set(0, 0, 0);
      flightState.current.velM.set(0, 0, 0);
      flightState.current.omegaBody.set(0, 0, 0);
      flightState.current.quat.identity();
      flightState.current.armed = false;
      flightState.current.motorOmegaRad = [0, 0, 0, 0];
      flightState.current.motorTiltRad = [0, 0, 0, 0];
      flightState.current.motorPhaseRad = [0, 0, 0, 0];
      flightState.current.batteryV = propulsion.batteryCells * propulsion.vOpenPerCell;
      flightState.current.batteryI = 0;
      flightState.current.throttle01 = 0;
      flightState.current.targetWpIndex = 1;
      flightState.current.rng = 123456789;
      flightState.current.windPhase = null;
      flightState.current.windTime = 0;
    }
    if (!isFlyingPath) {
      flightState.current.targetWpIndex = 1;
    }
  }, [viewMode, isFlyingPath, propulsion]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const code = e.code;

      const isSpace = code === "Space" || key === " " || key === "space" || key === "spacebar";
      const isShift = code === "ShiftLeft" || code === "ShiftRight" || key === "shift";

      if (isSpace) keys.current.space = true;
      else if (isShift) keys.current.shift = true;
      else if (keys.current.hasOwnProperty(key)) (keys.current as any)[key] = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const code = e.code;

      const isSpace = code === "Space" || key === " " || key === "space" || key === "spacebar";
      const isShift = code === "ShiftLeft" || code === "ShiftRight" || key === "shift";

      if (isSpace) keys.current.space = false;
      else if (isShift) keys.current.shift = false;
      else if (keys.current.hasOwnProperty(key)) (keys.current as any)[key] = false;
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const flightTelemetryTickRef = useRef({ t: 0 });

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    const drone = groupRef.current;

    if (viewMode === "flight_sim") {
      const dt = Math.min(delta, 1 / 30);
      const g = 9.81;
      const s = flightState.current;
      const massKg = massProps.massKg;

      const body = flightBodyRef.current;
      if (!body) return;

      if (!flightInitDone.current) {
        const spawnY = Number.isFinite(flightSpawnLiftY)
          ? flightSpawnLiftY
          : Number.isFinite(assemblySpawnLiftY)
            ? assemblySpawnLiftY
            : 80;
        try {
          body.setTranslation({ x: 0, y: spawnY, z: 0 }, true);
          body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
          s.armed = false;
          flightInitDone.current = true;
        } catch {
          // If Rapier is in a bad state (e.g. after a hot reload), avoid crashing the render loop.
          flightInitDone.current = false;
          return;
        }
      }

      // Read state from Rapier (world units are mm).
      {
        const t = body.translation();
        const lv = body.linvel();
        const av = body.angvel();
        const r = body.rotation();

        s.posM.set(t.x * 1e-3, t.y * 1e-3, t.z * 1e-3);
        s.velM.set(lv.x * 1e-3, lv.y * 1e-3, lv.z * 1e-3);
        s.quat.set(r.x, r.y, r.z, r.w);

        const omegaWorld = new THREE.Vector3(av.x, av.y, av.z);
        const invQuat = s.quat.clone().invert();
        s.omegaBody.copy(omegaWorld.applyQuaternion(invQuat));
      }

      const rho = propulsion.airDensityKgM3;
      const D = propulsion.diameterM;
      const Ct0 = propulsion.Ct0;
      const Cq0 = propulsion.Cq0;

      const Vopen = propulsion.batteryCells * propulsion.vOpenPerCell;
      if (!s.batteryV || !Number.isFinite(s.batteryV)) s.batteryV = Vopen;
      const Vpack = Math.max(propulsion.batteryCells * 3.3, Math.min(Vopen, s.batteryV));
      const omegaMaxRad = (propulsion.motorKV * Vpack) * ((2 * Math.PI) / 60);

      const nMax = omegaMaxRad / (2 * Math.PI);
      const thrustMaxPerMotorN = Ct0 * rho * nMax * nMax * Math.pow(D, 4);
      const totalMaxThrustN = thrustMaxPerMotorN * 4;

      // Compute effective vertical thrust efficiency using the same static misalignment + flex model
      // as the aero loop (small but enough to make hover trim slightly under 1.0 if ignored).
      const mmToM = 1e-3;
      const comMm = massProps.comMm;
      const expectedHoverPerMotorN = (massKg * g) / 4;
      const up = new THREE.Vector3(0, 1, 0);
      let verticalEff = 0;
      for (let i = 0; i < 4; i++) {
        // Static motor tilt/misalignment
        const deg = propulsion.staticMisalignDeg;
        const tiltX = THREE.MathUtils.degToRad(((i < 2 ? -1 : 1) * deg) * 0.35);
        const tiltZ = THREE.MathUtils.degToRad(((i % 2 === 0 ? -1 : 1) * deg) * 0.45);
        const staticQuat = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(tiltX, 0, tiltZ),
        );

        // Flex tilt around axis derived from arm direction
        const r = new THREE.Vector3(
          (motorPositions[i][0] - comMm.x) * mmToM,
          0,
          (motorPositions[i][2] - comMm.z) * mmToM,
        );
        if (r.lengthSq() < 1e-9) r.set(1, 0, 0);
        r.normalize();
        const flexAxis = r.clone().cross(up).normalize();
        const flexRad = expectedHoverPerMotorN * propulsion.flexRadPerN;
        const flexQuat = new THREE.Quaternion().setFromAxisAngle(flexAxis, flexRad);

        const tiltQuat = staticQuat.clone().multiply(flexQuat);
        const axis = up.clone().applyQuaternion(tiltQuat);
        verticalEff += axis.y;
      }
      verticalEff /= 4;
      verticalEff = THREE.MathUtils.clamp(verticalEff, 0.9, 1);

      // Reaction yaw torque per thrust: Q/T = (Cq/Ct)*D
      const yawCoeffNmPerN = (Cq0 / Math.max(1e-6, Ct0)) * D;
      const yawSign = [1, -1, 1, -1];

      // --- Control inputs (manual or waypoint autopilot) ---
      let throttleCmd01: number;
      let desiredRateBody = new THREE.Vector3(0, 0, 0); // x=pitch, y=yaw, z=roll

      const hoverThrottle01 = Math.sqrt(
        Math.min(
          1,
          (massKg * g) / Math.max(1e-6, totalMaxThrustN * verticalEff),
        ),
      );

      if (isFlyingPath && waypoints.length >= 2) {
        // Autopilot implies the motors are armed.
        s.armed = true;
        const idx = Math.min(
          Math.max(1, s.targetWpIndex),
          waypoints.length - 1,
        );
        const wp = waypoints[idx];
        const targetM = new THREE.Vector3(
          wp.x / 1000,
          Math.max((wp.y + 20) / 1000, 0.02),
          wp.z / 1000,
        );

        const toTarget = targetM.clone().sub(s.posM);
        const dist = toTarget.length();

        if (dist < 0.15) {
          if (idx >= waypoints.length - 1) {
            if (onFlightComplete) onFlightComplete();
          } else {
            s.targetWpIndex = idx + 1;
          }
        }

        const maxSpeed = 4.0;
        const desiredVel = dist > 1e-6
          ? toTarget.clone().normalize().multiplyScalar(Math.min(maxSpeed, dist * 2.0))
          : new THREE.Vector3();

        const kpVel = 2.2;
        const desiredAccel = desiredVel.sub(s.velM).multiplyScalar(kpVel);

        // Thrust command in world coordinates (N)
        const gravityVec = new THREE.Vector3(0, -g, 0);
        const thrustCmdWorldN = desiredAccel.clone().sub(gravityVec).multiplyScalar(massKg);
        const thrustMagN = Math.min(totalMaxThrustN * 0.95, Math.max(0, thrustCmdWorldN.length()));

        // Convert thrust magnitude to throttle (thrust ~ throttle^2)
        throttleCmd01 = clamp01(
          Math.sqrt(
            thrustMagN / Math.max(1e-6, totalMaxThrustN * verticalEff),
          ),
        );

        // Desired attitude: body-up aligns with thrust direction, yaw aligns with velocity direction
        const desiredUpWorld = thrustCmdWorldN.lengthSq() > 1e-8
          ? thrustCmdWorldN.clone().normalize()
          : new THREE.Vector3(0, 1, 0);

        const vFlat = s.velM.clone();
        vFlat.y = 0;
        const yawTarget = vFlat.lengthSq() > 1e-6
          ? Math.atan2(vFlat.x, vFlat.z)
          : 0;
        const desiredForward = new THREE.Vector3(Math.sin(yawTarget), 0, Math.cos(yawTarget)).multiplyScalar(-1);
        const desiredRight = desiredForward.clone().cross(desiredUpWorld).normalize();
        const desiredForwardOrtho = desiredUpWorld.clone().cross(desiredRight).normalize();

        const desiredMat = new THREE.Matrix4().makeBasis(
          desiredRight,
          desiredUpWorld,
          desiredForwardOrtho,
        );
        const desiredQuat = new THREE.Quaternion().setFromRotationMatrix(desiredMat);

        // Attitude error in body frame
        const qInv = s.quat.clone().invert();
        const qErr = desiredQuat.clone().multiply(qInv);
        if (qErr.w < 0) {
          qErr.x = -qErr.x;
          qErr.y = -qErr.y;
          qErr.z = -qErr.z;
          qErr.w = -qErr.w;
        }

        const angle = 2 * Math.acos(Math.max(-1, Math.min(1, qErr.w)));
        const sinHalf = Math.sqrt(1 - qErr.w * qErr.w);
        const axisWorld = sinHalf < 1e-6
          ? new THREE.Vector3(0, 0, 0)
          : new THREE.Vector3(qErr.x, qErr.y, qErr.z).divideScalar(sinHalf);
        const axisBody = axisWorld.clone().applyQuaternion(qInv);

        const attErrBody = axisBody.multiplyScalar(angle);
        const kpAtt = 10.0;
        const kdAtt = 2.5;
        desiredRateBody = attErrBody.multiplyScalar(kpAtt).add(s.omegaBody.clone().multiplyScalar(-kdAtt));

        // Convert desiredRateBody into a bounded rate command
        const maxRate = 4.0;
        if (desiredRateBody.length() > maxRate) desiredRateBody.setLength(maxRate);
      } else {
        // Manual: throttle around hover + stick input
        const sens = THREE.MathUtils.clamp(controlSensitivity, 0.2, 1);
        const throttleDelta = (keys.current.space ? 1 : 0) - (keys.current.shift ? 1 : 0);
        // Start on the ground with motors off until the user commands throttle-up.
        if (!s.armed) {
          if (throttleDelta > 0) s.armed = true;
          throttleCmd01 = 0;
          desiredRateBody.set(0, 0, 0);
        } else {
          // Neutral throttle aims for hover, but small modeling biases can create a slow climb/sink.
          // Add a light vertical-velocity damper when the user is not actively commanding throttle.
          const kVzDamp = 0.045; // throttle fraction per (m/s) vertical speed
          const vzDamp = throttleDelta === 0
            ? THREE.MathUtils.clamp(-s.velM.y * kVzDamp, -0.08, 0.08)
            : 0;
          const targetThrottle = hoverThrottle01 + throttleDelta * (0.18 * sens) + vzDamp;
          throttleCmd01 = clamp01(targetThrottle);

        const pitchCmd = (keys.current.s ? 1 : 0) - (keys.current.w ? 1 : 0);
        const rollCmd = (keys.current.a ? 1 : 0) - (keys.current.d ? 1 : 0);
        const yawCmd = (keys.current.q ? 1 : 0) - (keys.current.e ? 1 : 0);

        const maxPitchRate = 2.2 * sens;
        const maxRollRate = 2.6 * sens;
        const maxYawRate = 2.2 * sens;

        // Self-level: angle-mode attitude hold (like Betaflight angle mode)
        // Computes tilt error between body-up and world-up, and additionally
        // leans into horizontal velocity to provide velocity damping.
        const bodyUp = new THREE.Vector3(0, 1, 0).applyQuaternion(s.quat);
        const worldUp = new THREE.Vector3(0, 1, 0);

        // Tilt axis (world) = bodyUp × worldUp, angle = acos(dot)
        const tiltCross = bodyUp.clone().cross(worldUp);
        const tiltDot = THREE.MathUtils.clamp(bodyUp.dot(worldUp), -1, 1);
        const tiltAngle = Math.acos(tiltDot); // 0 = level

        // Convert tilt correction axis to body frame
        const kpLevel = 8.0; // proportional self-level gain (rad/s per rad error)
        const kdLevel = 2.0; // derivative damping on angular rate
        let levelRateBody = new THREE.Vector3(0, 0, 0);
        if (tiltAngle > 0.002) {
          const corrAxis = tiltCross.normalize().multiplyScalar(tiltAngle * kpLevel);
          levelRateBody = corrAxis.applyQuaternion(s.quat.clone().invert());
        }
        // Derivative damping: oppose current angular rate for stability
        levelRateBody.add(s.omegaBody.clone().multiplyScalar(-kdLevel));

        // Velocity damping: lean into horizontal velocity to oppose drift
        // This simulates GPS-assisted position hold behavior
        const vHoriz = new THREE.Vector3(s.velM.x, 0, s.velM.z);
        const hSpeed = vHoriz.length();
        if (hSpeed > 0.02) {
          const kVelDamp = 1.5; // rad/s per m/s of horizontal speed
          const maxLean = 0.8; // max lean rate contribution
          const dampRate = Math.min(maxLean, hSpeed * kVelDamp);
          // To oppose velocity V, we tilt the drone so thrust has a -V component.
          // Tilt axis in world = up × normalize(V), and we rotate by a positive angle.
          const vDir = vHoriz.clone().normalize();
          const tiltAxis = vDir.clone().cross(worldUp).normalize().multiplyScalar(dampRate);
          const dampRateBody = tiltAxis.applyQuaternion(s.quat.clone().invert());
          levelRateBody.add(dampRateBody);
        }

          // Blend: stick input overrides self-level on the corresponding axis
          desiredRateBody.set(
            pitchCmd !== 0 ? pitchCmd * maxPitchRate : levelRateBody.x,
            yawCmd * maxYawRate,
            rollCmd !== 0 ? rollCmd * maxRollRate : levelRateBody.z,
          );
        }
      }

      // Smooth throttle (motor spool)
      {
        if (!s.armed) {
          // Motors off on the ground until armed.
          s.throttle01 = 0;
          s.motorOmegaRad = [0, 0, 0, 0];
        } else {
          const tau = 0.12;
          const a = 1 - Math.exp(-dt / tau);
          s.throttle01 = THREE.MathUtils.lerp(s.throttle01, throttleCmd01, a);
        }
      }

      // Motor positions relative to COM (body), including deterministic tolerance offsets.
      const tolMm = 0.05;
      // comMm already defined above

      const rBody = motorPositions.map((p, i) => {
        const tx = (i % 2 === 0 ? -1 : 1) * tolMm;
        const tz = (i < 2 ? -1 : 1) * tolMm;
        return new THREE.Vector3(
          (p[0] + tx - comMm.x) * mmToM,
          (p[1] - comMm.y) * mmToM,
          (p[2] + tz - comMm.z) * mmToM,
        );
      });

      // --- IMU (measured angular velocity) with vibration + noise ---
      const rand01 = () => {
        s.rng = (1664525 * s.rng + 1013904223) >>> 0;
        return s.rng / 4294967296;
      };
      const randN = (std: number) => {
        // 4-sample Irwin-Hall approx; std normalization ~= 0.57735
        const u = rand01() + rand01() + rand01() + rand01();
        return ((u - 2) / 0.577350269) * std;
      };

      const omegaMeas = s.omegaBody.clone();
      omegaMeas.x += randN(propulsion.imuRateNoiseStdRad);
      omegaMeas.y += randN(propulsion.imuRateNoiseStdRad);
      omegaMeas.z += randN(propulsion.imuRateNoiseStdRad);

      // Motor-frequency vibration injected into IMU rates (uses last-step motor omega/phase)
      {
        const up = new THREE.Vector3(0, 1, 0);
        for (let i = 0; i < 4; i++) {
          const omega = Math.max(0, s.motorOmegaRad[i] ?? 0);
          const vib = Math.sin((s.motorPhaseRad[i] ?? 0) * 3);
          const vibAmp = propulsion.vibRateAmpRad * (omegaMaxRad > 1e-6 ? omega / omegaMaxRad : 0);

          const armDir = rBody[i].clone();
          armDir.y = 0;
          if (armDir.lengthSq() < 1e-9) armDir.set(1, 0, 0);
          armDir.normalize();
          const vibAxis = armDir.clone().cross(up).normalize();
          omegaMeas.add(vibAxis.multiplyScalar(vib * vibAmp));
        }
      }

      // --- Rate controller (body) using full inertia tensor ---
      const kpRate = 6.0;
      const rateErr = desiredRateBody.clone().sub(omegaMeas);
      const alphaCmd = rateErr.multiplyScalar(kpRate);

      const Iomega = mulMat3Vec(massProps.inertiaKgM2, s.omegaBody);
      const gyro = s.omegaBody.clone().cross(Iomega);
      const torqueCmdBodyNm = mulMat3Vec(massProps.inertiaKgM2, alphaCmd).add(gyro);

      // Desired total thrust (N)
      const thrustCmdN = clamp01(s.throttle01) ** 2 * totalMaxThrustN;

      // Mixer: solve linear system for per-motor thrusts.
      // Σf = T
      // Σ(-z_i f_i) = τx
      // Σ(x_i f_i) = τz
      // yawCoeff * Σ(sign_i f_i) = τy
      const A = [
        [1, 1, 1, 1],
        [-rBody[0].z, -rBody[1].z, -rBody[2].z, -rBody[3].z],
        [rBody[0].x, rBody[1].x, rBody[2].x, rBody[3].x],
        [
          yawCoeffNmPerN * yawSign[0],
          yawCoeffNmPerN * yawSign[1],
          yawCoeffNmPerN * yawSign[2],
          yawCoeffNmPerN * yawSign[3],
        ],
      ];
      const b = [thrustCmdN, torqueCmdBodyNm.x, torqueCmdBodyNm.z, torqueCmdBodyNm.y];

      const mix = solve4x4(A, b);
      const fTargetN = mix ?? [thrustCmdN / 4, thrustCmdN / 4, thrustCmdN / 4, thrustCmdN / 4];

      for (let i = 0; i < 4; i++) {
        fTargetN[i] = Math.max(0, Math.min(thrustMaxPerMotorN, fTargetN[i]));
      }

      // Convert thrust targets to omega targets (assume Ct0 for command inversion)
      const motorA = 1 - Math.exp(-dt / propulsion.motorTauSec);
      for (let i = 0; i < 4; i++) {
        const f = fTargetN[i];
        const omegaTarget =
          f > 0
            ? 2 * Math.PI * Math.sqrt(f / Math.max(1e-9, Ct0 * rho * Math.pow(D, 4)))
            : 0;
        const omegaClamped = Math.max(0, Math.min(omegaTarget, omegaMaxRad));
        s.motorOmegaRad[i] = THREE.MathUtils.lerp(s.motorOmegaRad[i] ?? 0, omegaClamped, motorA);
      }

      // Aerodynamics: thrust/torque from omega and advance ratio, plus frame flex + static motor misalignment.
      const vBody = s.velM.clone().applyQuaternion(s.quat.clone().invert());

      const Fbody = new THREE.Vector3(0, 0, 0);
      const torqueBodyNm = new THREE.Vector3(0, 0, 0);
      let mechPowerW = 0;

      const tmpAxis = new THREE.Vector3();
      const tmpF = new THREE.Vector3();
      const tmpTau = new THREE.Vector3();

      const aFlex = 1 - Math.exp(-dt / propulsion.flexTauSec);
      for (let i = 0; i < 4; i++) {
        const omega = Math.max(0, s.motorOmegaRad[i] ?? 0);
        const n = omega / (2 * Math.PI);

        // Flex target derived from commanded thrust (keeps it causal but stable)
        const flexTarget = fTargetN[i] * propulsion.flexRadPerN;
        s.motorTiltRad[i] = THREE.MathUtils.lerp(s.motorTiltRad[i] ?? 0, flexTarget, aFlex);

        // Static motor tilt/misalignment (print/assembly realism)
        const deg = propulsion.staticMisalignDeg;
        const tiltX = THREE.MathUtils.degToRad(((i < 2 ? -1 : 1) * deg) * 0.35);
        const tiltZ = THREE.MathUtils.degToRad(((i % 2 === 0 ? -1 : 1) * deg) * 0.45);
        const staticQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, 0, tiltZ));

        // Flex tilt axis based on arm direction
        const armDir = rBody[i].clone();
        armDir.y = 0;
        if (armDir.lengthSq() < 1e-9) armDir.set(1, 0, 0);
        armDir.normalize();
        const flexAxis = armDir.clone().cross(up).normalize();
        const flexQuat = new THREE.Quaternion().setFromAxisAngle(
          flexAxis,
          s.motorTiltRad[i] ?? 0,
        );

        const tiltQuat = staticQuat.multiply(flexQuat);
        tmpAxis.copy(up).applyQuaternion(tiltQuat).normalize();

        // Advance ratio along the actual thrust axis
        const vIn = Math.max(0, -vBody.dot(tmpAxis));
        const J = n > 1e-6 && D > 1e-6 ? vIn / (n * D) : 0;
        const Ct = Ct0 * THREE.MathUtils.clamp(1 - 0.6 * J, 0, 1.25);
        const Cq = Cq0 * THREE.MathUtils.clamp(1 - 0.5 * J, 0, 1.25);

        const thrustN = Ct * rho * n * n * Math.pow(D, 4);
        const torqueNm = Cq * rho * n * n * Math.pow(D, 5);
        mechPowerW += torqueNm * omega;

        tmpF.copy(tmpAxis).multiplyScalar(thrustN);
        Fbody.add(tmpF);

        tmpTau.copy(rBody[i]).cross(tmpF);
        torqueBodyNm.add(tmpTau);
        torqueBodyNm.y += yawSign[i] * torqueNm;

        // Advance motor phase for next step (drives IMU vibration)
        s.motorPhaseRad[i] = ((s.motorPhaseRad[i] ?? 0) + omega * dt) % (Math.PI * 2);
      }

      // Export audio telemetry (physics-driven).
      audioTelemetry.current.omegaRad = [
        s.motorOmegaRad[0] ?? 0,
        s.motorOmegaRad[1] ?? 0,
        s.motorOmegaRad[2] ?? 0,
        s.motorOmegaRad[3] ?? 0,
      ];
      audioTelemetry.current.omegaMaxRad = omegaMaxRad;
      audioTelemetry.current.mechPowerW = mechPowerW;
      audioTelemetry.current.thrustTotalN = Math.max(0, Fbody.y);

      // Net force in world (gravity is handled by Rapier).
      const thrustWorld = Fbody.clone().applyQuaternion(s.quat);

      // Ground effect: thrust augmentation when altitude < 1 rotor diameter.
      // Based on Cheeseman & Bennett (1955): T_ge/T = 1 / (1 - (R/(4*z))^2)
      // where z = altitude, R = rotor radius.
      {
        const rotorR = (propSize * 25.4 / 2) * 1e-3; // prop radius in meters
        const z = Math.max(0.01, s.posM.y); // altitude in meters
        if (z < rotorR * 2) {
          const ratio = rotorR / (4 * z);
          const geMultiplier = 1 / Math.max(0.5, 1 - ratio * ratio);
          // Only augment the vertical component
          thrustWorld.y *= THREE.MathUtils.clamp(geMultiplier, 1.0, 1.4);
        }
      }

      // Quadratic aerodynamic drag (parasitic + induced)
      const CdA = (frameSize / 210) * 0.012; // parasitic drag area
      const v = s.velM;
      const speed = v.length();
      const dragWorld = speed > 1e-6
        ? v.clone().multiplyScalar(-0.5 * rho * CdA * speed)
        : new THREE.Vector3(0, 0, 0);

      // Simple wind model: light random gusts that slowly vary
      {
        if (!s.windPhase) s.windPhase = [Math.random() * 100, Math.random() * 100, Math.random() * 100];
        const windT = (s.windTime ?? 0) + dt;
        s.windTime = windT;
        // Perlin-like smooth wind using sin of different frequencies
        const wx = 0.12 * Math.sin(windT * 0.4 + s.windPhase[0]) + 0.06 * Math.sin(windT * 1.1 + 7);
        const wz = 0.12 * Math.sin(windT * 0.35 + s.windPhase[2]) + 0.06 * Math.sin(windT * 0.9 + 3);
        // Scale wind force with altitude (ground shielding below ~0.5m)
        const altFactor = THREE.MathUtils.smoothstep(s.posM.y, 0, 0.5);
        const windForceN = new THREE.Vector3(wx * altFactor, 0, wz * altFactor);
        dragWorld.add(windForceN);
      }

      // Apply forces/torques to Rapier.
      // Rapier world uses mm, so: 1 N -> 1000 (kg*mm/s^2), 1 N*m -> 1e6 (kg*mm^2/s^2)
      {
        const forceWorldN = thrustWorld.clone().add(dragWorld);
        const torqueWorldNm = torqueBodyNm.clone().applyQuaternion(s.quat);

        body.resetForces(true);
        body.resetTorques(true);
        body.addForce(
          {
            x: forceWorldN.x * 1000,
            y: forceWorldN.y * 1000,
            z: forceWorldN.z * 1000,
          },
          true,
        );
        body.addTorque(
          {
            x: torqueWorldNm.x * 1e6,
            y: torqueWorldNm.y * 1e6,
            z: torqueWorldNm.z * 1e6,
          },
          true,
        );
      }

      // Publish flight telemetry for UI (no DevTools required).
      if (flightTelemetryRef) {
        flightTelemetryTickRef.current.t += dt;
        if (flightTelemetryTickRef.current.t >= 0.05) {
          flightTelemetryTickRef.current.t = 0;
          const weightN = massKg * g;
          const thrustN = Math.max(0, thrustWorld.y);
          const tw = weightN > 1e-6 ? thrustN / weightN : 0;
          // Report altitude as height above ground (AGL) of the collider bottom.
          const colliderLocalY = assemblyColliderCenterY - massProps.comMm.y; // mm
          const bottomAGLM =
            s.posM.y + (colliderLocalY - assemblyHalfExtents[1]) * 1e-3;
          flightTelemetryRef.current = {
            throttle01: s.throttle01,
            thrustN,
            weightN,
            tw,
            altitudeM: Math.max(0, bottomAGLM),
            speedMS: s.velM.length(),
          };
        }
      }

      // Battery sag (very simplified but causal): V = Voc - I*R, I from mechanical power/eff.
      {
        const Pel = mechPowerW / Math.max(0.2, propulsion.motorEff);
        let V = Vpack;
        let I = 0;
        for (let k = 0; k < 2; k++) {
          I = Pel / Math.max(1, V);
          V = Math.max(
            propulsion.batteryCells * 3.3,
            Math.min(Vopen, Vopen - I * propulsion.packRintOhm),
          );
        }
        s.batteryV = V;
        s.batteryI = I;
      }

      // Visual: spin propellers based on motor angular velocity
      for (let i = 0; i < 4; i++) {
        const propGroup = propGroupRefs.current[i];
        if (!propGroup) continue;
        const isCW = i === 0 || i === 2;
        const dir = isCW ? 1 : -1;
        const omega = Math.max(0, s.motorOmegaRad[i] ?? 0);
        propSpinRad.current[i] = (propSpinRad.current[i] + dir * omega * dt) % (Math.PI * 2);
        propGroup.rotation.y = propSpinRad.current[i];
      }

      // Procedural vibration (visual-only): derived from motor phase + omega.
      if (visualJitterRef.current) {
        const vib = clamp01(effectiveSimSettings.vibrationAmount);
        const o0 = Math.max(0, s.motorOmegaRad[0] ?? 0);
        const o1 = Math.max(0, s.motorOmegaRad[1] ?? 0);
        const o2 = Math.max(0, s.motorOmegaRad[2] ?? 0);
        const o3 = Math.max(0, s.motorOmegaRad[3] ?? 0);
        const oAvg = (o0 + o1 + o2 + o3) * 0.25;
        const oNorm = omegaMaxRad > 1e-6 ? clamp01(oAvg / omegaMaxRad) : 0;

        const ph0 = s.motorPhaseRad[0] ?? 0;
        const ph1 = s.motorPhaseRad[1] ?? 0;
        const ph2 = s.motorPhaseRad[2] ?? 0;
        const ph3 = s.motorPhaseRad[3] ?? 0;

        const ax = (Math.sin(ph0) - Math.sin(ph1) + Math.sin(ph2) - Math.sin(ph3)) * 0.25;
        const az = (Math.cos(ph0) + Math.cos(ph1) - Math.cos(ph2) - Math.cos(ph3)) * 0.25;

        // mm translation jitter + small roll/pitch shake.
        const tMm = 0.35 * vib * oNorm;
        visualJitterRef.current.position.set(ax * tMm, 0, az * tMm);
        const rRad = 0.012 * vib * oNorm;
        visualJitterRef.current.rotation.set(az * rRad, 0, -ax * rRad);
      }
    } else {
      flightInitDone.current = false;
      if (visualJitterRef.current) {
        visualJitterRef.current.position.set(0, 0, 0);
        visualJitterRef.current.rotation.set(0, 0, 0);
      }
      // Non-flight modes: don't kinematically override transforms (Rapier may be driving bodies).
      // Idle: stop prop spin visuals
      for (let i = 0; i < 4; i++) {
        const propGroup = propGroupRefs.current[i];
        if (!propGroup) continue;
        propGroup.rotation.y = 0;
        propSpinRad.current[i] = 0;
      }
    }

    // Audio update (runs in all modes; audible only when enabled).
    if (audioRef.current) {
      const nodes = audioRef.current;
      const tel = audioTelemetry.current;

      const enabled = effectiveSimSettings.motorAudioEnabled && viewMode === "flight_sim";
      const masterTarget = enabled ? clamp01(effectiveSimSettings.motorAudioVolume) : 0;
      nodes.master.gain.setTargetAtTime(Math.max(0.0001, masterTarget), nodes.ctx.currentTime, 0.02);

      const blades = 3;
      const omegaMax = Math.max(1e-3, tel.omegaMaxRad);
      for (let i = 0; i < 4; i++) {
        const omega = Math.max(0, tel.omegaRad[i] ?? 0);
        const rps = omega / (2 * Math.PI);
        const bpf = Math.max(0, rps * blades);
        nodes.motorOsc[i].frequency.setTargetAtTime(bpf, nodes.ctx.currentTime, 0.015);

        const oNorm = clamp01(omega / omegaMax);
        const gain = enabled ? 0.08 * Math.pow(oNorm, 1.3) : 0;
        nodes.motorGain[i].gain.setTargetAtTime(gain, nodes.ctx.currentTime, 0.02);
      }

      const powerNorm = clamp01(Math.sqrt(Math.max(0, tel.mechPowerW)) / 80);
      const noiseGain = enabled ? 0.05 * powerNorm : 0;
      nodes.noiseGain.gain.setTargetAtTime(noiseGain, nodes.ctx.currentTime, 0.03);
    }
  });

  const v = effectiveViewSettings.visibility;
  const droneVisual = (
    <group
      ref={groupRef}
      position={
        viewMode === "flight_sim"
          ? [-massProps.comMm.x, -massProps.comMm.y, -massProps.comMm.z]
          : [0, 0, 0]
      }
    >
      <group ref={visualJitterRef}>
      {(viewMode === "exploded" || viewMode === "flight_sim") && (
        <group position={[0, bottomPlateTopY + 2, 0]}>
          <axesHelper args={[90]} />
          {/* Forward marker: points toward +Z in model space */}
          <group position={[0, 0, fcMounting / 2 + 40]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <coneGeometry args={[4, 14, 10]} />
              <meshStandardMaterial
                color="#eab308"
                metalness={0.1}
                roughness={0.4}
              />
            </mesh>
          </group>
        </group>
      )}
      {/* Bottom Plate */}
      {v.frame && (
        <mesh
          geometry={bottomPlateGeo}
          position={bottomPos}
          castShadow
          receiveShadow
          material={carbonMaterial}
        />
      )}
      {viewMode === "exploded" && (
        <Annotation
          title="Unibody Bottom Plate"
          description={`${plateThickness}mm Toray T700 Carbon Fiber`}
          position={[frameSize / 2 + 10, bottomPos[1], 0]}
        />
      )}

      {/* Top Plate */}
      {v.frame && (
        <mesh
          geometry={topPlateGeo}
          position={topPos}
          castShadow
          receiveShadow
          material={carbonMaterial}
        />
      )}
      {viewMode === "exploded" && (
        <Annotation
          title="Top Plate"
          description={`${topPlateThickness}mm Carbon Fiber`}
          position={[fcMounting / 2 + 15, topPos[1], 0]}
        />
      )}

      {/* Standoffs with hex profile + top/bottom M3 screws */}
      {v.frame && showStandoffs &&
        standoffsData.map((pos, i) => {
          const screwShaftLen = plateThickness + 2;
          const explodeScrewSpread = exploded ? 12 : 0;
          return (
            <group key={`standoff-${i}`}>
              {/* Hex standoff body */}
              <mesh
                position={[pos[0], standoffY, pos[2]]}
                castShadow
                receiveShadow
                material={aluminumMaterial}
              >
                <cylinderGeometry args={[3.0, 3.0, standoffHeight, 6]} />
              </mesh>
              {/* Bottom screw (through bottom plate, into standoff) */}
              <group position={[pos[0], bottomPlateTopY - plateThickness - explodeScrewSpread, pos[2]]}>
                {/* Screw head */}
                <mesh position={[0, -screwGeos.m3HeadGeo.parameters.height / 2, 0]} material={steelMaterial}>
                  <cylinderGeometry args={[2.85, 2.85, 1.65, 16]} />
                </mesh>
                {/* Socket drive recess */}
                <mesh position={[0, 0.1, 0]} material={steelMaterial}>
                  <cylinderGeometry args={[1.3, 1.3, 0.8, 6]} />
                </mesh>
                {/* Shaft */}
                <mesh position={[0, screwShaftLen / 2, 0]} material={steelMaterial}>
                  <cylinderGeometry args={[1.5, 1.5, screwShaftLen, 12]} />
                </mesh>
              </group>
              {/* Top screw (through top plate, into standoff) */}
              <group position={[pos[0], topPos[1] + topPlateThickness + explodeScrewSpread, pos[2]]}>
                <mesh position={[0, screwGeos.m3HeadGeo.parameters.height / 2, 0]} material={steelMaterial}>
                  <cylinderGeometry args={[2.85, 2.85, 1.65, 16]} />
                </mesh>
                <mesh position={[0, -0.1, 0]} material={steelMaterial}>
                  <cylinderGeometry args={[1.3, 1.3, 0.8, 6]} />
                </mesh>
                <mesh position={[0, -(screwShaftLen / 2), 0]} material={steelMaterial}>
                  <cylinderGeometry args={[1.5, 1.5, screwShaftLen, 12]} />
                </mesh>
              </group>
            </group>
          );
        })}
      {viewMode === "exploded" && showStandoffs && (
        <>
          <Annotation
            title="Knurled Standoffs"
            description={`M3 × ${standoffHeight}mm 7075-T6 Aluminum`}
            position={[standoffsData[0][0] + 10, standoffY, standoffsData[0][2]]}
          />
          <Annotation
            title="M3×8 BHCS"
            description="Grade 12.9 Steel, 4× top + 4× bottom"
            position={[standoffsData[1][0] + 10, bottomPlateTopY - plateThickness, standoffsData[1][2]]}
          />
        </>
      )}

      {/* Rigorous Clearance & Payload Visualization (Visible in all modes) */}
      <group>
        {/* Motors & Propellers */}
        {v.propulsion && motorPositions.map((pos, i) => {
          const isCW = i === 0 || i === 2; // Standard Betaflight motor direction
          const motorRadius =
            motorMountPattern >= 16
              ? 13.5
              : motorMountPattern >= 12
                ? 7
                : 5.5;
          const motorHeight =
            motorMountPattern >= 16 ? 15 : motorMountPattern >= 12 ? 10 : 8;
          const propR = (propSize * 25.4) / 2;

          const armLen = Math.max(1e-6, Math.hypot(pos[0], pos[2]));
          const armDirX = pos[0] / armLen;
          const armDirZ = pos[2] / armLen;
          const explodeMotorRad = exploded ? 22 : 0;
          const explodeMotorX = armDirX * explodeMotorRad;
          const explodeMotorZ = armDirZ * explodeMotorRad;

          return (
            <group
              key={`motor-prop-${i}`}
              position={[
                pos[0] + bottomPos[0] + explodeMotorX,
                bottomPos[1] + bottomPlateTopY + explodeMotorY,
                pos[2] + bottomPos[2] + explodeMotorZ,
              ]}
            >
              <group>
                {exploded && i === 0 && (
                  <Annotation
                    title="Motors + Props"
                    description={`${motorMountPattern}×${motorMountPattern}mm mount • ${propSize.toFixed(1)}in tri-blade`}
                    position={[motorRadius + 20, motorHeight + 18, 0]}
                  />
                )}
                {/* Motor mount screws (4× M3/M2 through bottom plate) */}
                {[0, 1, 2, 3].map((j) => {
                  const sAngle = j * (Math.PI / 2);
                  const sX = Math.cos(sAngle) * (motorMountPattern / 2);
                  const sZ = Math.sin(sAngle) * (motorMountPattern / 2);
                  const isM3 = motorMountPattern >= 16;
                  const headR = isM3 ? 2.85 : 2.0;
                  const headH = isM3 ? 1.65 : 1.2;
                  const shaftR = isM3 ? 1.5 : 1.0;
                  const shaftLen = plateThickness + 3;
                  const explodeScrewY = exploded ? -8 : 0;
                  return (
                    <group key={`mscrew-${j}`} position={[sX, explodeScrewY, sZ]}>
                      {/* Screw head (underside of plate) */}
                      <mesh position={[0, -plateThickness - headH / 2, 0]} material={steelMaterial}>
                        <cylinderGeometry args={[headR, headR, headH, isM3 ? 16 : 12]} />
                      </mesh>
                      {/* Shaft up through plate into motor */}
                      <mesh position={[0, -plateThickness / 2 + 1, 0]} material={steelMaterial}>
                        <cylinderGeometry args={[shaftR, shaftR, shaftLen, 12]} />
                      </mesh>
                    </group>
                  );
                })}
                {/* Prop nut (self-locking, on top of shaft) */}
                <mesh position={[0, motorHeight + 10, 0]} castShadow material={steelMaterial}>
                  <cylinderGeometry args={[4.0, 3.5, 5, 6]} />
                </mesh>
                {/* Motor Stator/Base */}
                <mesh position={[0, motorHeight * 0.2, 0]} castShadow receiveShadow>
                  <cylinderGeometry
                    args={[motorRadius, motorRadius, motorHeight * 0.4, 32]}
                  />
                  <meshStandardMaterial color="#404040" roughness={0.6} metalness={0.2} />
                </mesh>
                {/* Motor Bell */}
                <mesh position={[0, motorHeight * 0.75, 0]} castShadow receiveShadow>
                  <cylinderGeometry
                    args={[
                      motorRadius * 0.95,
                      motorRadius * 0.95,
                      motorHeight * 0.5,
                      32,
                    ]}
                  />
                  <meshStandardMaterial
                    color="#1f2937"
                    metalness={0.9}
                    roughness={0.15}
                  />
                </mesh>
                {/* Motor Shaft */}
                <mesh position={[0, motorHeight + 8, 0]} castShadow receiveShadow>
                  <cylinderGeometry args={[2.2, 2.2, 16, 18]} />
                  <meshStandardMaterial
                    color="#e5e7eb"
                    metalness={1}
                    roughness={0.1}
                  />
                </mesh>

                {/* Axle / shaft extension through prop hub (visual aid) */}
                <mesh position={[0, motorHeight + 3, 0]} castShadow receiveShadow>
                  <cylinderGeometry args={[1.1, 1.1, 20, 12]} />
                  <meshStandardMaterial color="#f8fafc" metalness={1} roughness={0.15} />
                </mesh>

                {/* Propeller */}
                <group
                  position={[0, motorHeight + 3, 0]}
                  ref={(el) => {
                    propGroupRefs.current[i] = el;
                  }}
                >
                  {/* Hub */}
                  <mesh>
                    <cylinderGeometry args={[6.5, 6.5, 7, 32]} />
                    <meshStandardMaterial
                      color={isCW ? "#0ea5e9" : "#f43f5e"}
                    />
                  </mesh>
                  {/* Blades */}
                  {[0, 1, 2].map((b) => (
                    <group key={b} rotation={[0, (b * Math.PI * 2) / 3, 0]}>
                      <group
                        position={[0, 0, 0]}
                        rotation={[isCW ? 0.3 : -0.3, 0, 0]}
                      >
                        <mesh geometry={propBladeGeo}>
                          <meshStandardMaterial
                            color={isCW ? "#0ea5e9" : "#f43f5e"}
                            transparent
                            opacity={0.8}
                          />
                        </mesh>
                      </group>
                    </group>
                  ))}
                  {/* Swept Volume Disk */}
                  <mesh rotation={[0, 0, 0]}>
                    <cylinderGeometry args={[propR, propR, 2, 64]} />
                    <meshStandardMaterial
                      color={isCW ? "#0ea5e9" : "#f43f5e"}
                      transparent
                      opacity={0.15}
                      side={THREE.DoubleSide}
                      depthWrite={false}
                    />
                  </mesh>
                </group>
              </group>
            </group>
          );
          })}

          {/* FC Stack with soft-mount grommets & stack screws */}
          {v.electronics && (
          <group
            position={[
              bottomPos[0],
              bottomPos[1] + bottomPlateTopY + explodeStackY,
              bottomPos[2],
            ]}
          >
            {/* FC Stack M3 screws + grommets (4×) */}
            {[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([dx, dz], si) => {
              const sx = dx * fcMounting / 2;
              const sz = dz * fcMounting / 2;
              return (
                <group key={`fc-screw-${si}`} position={[sx, 0, sz]}>
                  {/* Bottom grommet (between plate and ESC) */}
                  <mesh position={[0, 1.5, 0]} material={rubberMaterial}>
                    <cylinderGeometry args={[3.5, 3.5, 3, 16]} />
                  </mesh>
                  {/* Middle grommet (between ESC and FC) */}
                  <mesh position={[0, 9, 0]} material={rubberMaterial}>
                    <cylinderGeometry args={[3.5, 3.5, 3, 16]} />
                  </mesh>
                  {/* Stack screw shaft */}
                  <mesh position={[0, 7, 0]} material={steelMaterial}>
                    <cylinderGeometry args={[1.5, 1.5, 14, 12]} />
                  </mesh>
                  {/* Nylon lock nut on top */}
                  <mesh position={[0, 14.5, 0]} material={steelMaterial}>
                    <cylinderGeometry args={[3.0, 3.0, 3, 6]} />
                  </mesh>
                  {/* Nylon insert ring */}
                  <mesh position={[0, 16.5, 0]} material={nylonMaterial}>
                    <cylinderGeometry args={[2.8, 2.8, 1, 16]} />
                  </mesh>
                </group>
              );
            })}
            {/* ESC board */}
            <mesh position={[0, 4, 0]}>
              <boxGeometry args={[fcMounting + 6, 4, fcMounting + 8]} />
              <meshStandardMaterial color="#171717" roughness={0.9} metalness={0.1} />
            </mesh>
            {/* ESC Capacitor */}
            <mesh
              position={[0, 4, fcMounting / 2 + 6]}
              rotation={[0, 0, Math.PI / 2]}
            >
              <cylinderGeometry args={[4, 4, 12, 16]} />
              <meshStandardMaterial color="#0f172a" />
            </mesh>
            {/* Capacitor leads (wires) */}
            <mesh position={[0, 4, fcMounting / 2 + 1]} material={brassMaterial}>
              <cylinderGeometry args={[0.4, 0.4, 8, 8]} />
            </mesh>

            {/* FC board */}
            <mesh position={[0, 12, 0]}>
              <boxGeometry args={[fcMounting + 4, 2, fcMounting + 4]} />
              <meshStandardMaterial color="#171717" roughness={0.9} metalness={0.1} />
            </mesh>
            {/* FC component detail: gyro chip */}
            <mesh position={[3, 13.2, 2]}>
              <boxGeometry args={[4, 0.4, 4]} />
              <meshStandardMaterial color="#222" />
            </mesh>
            {/* FC component detail: MCU */}
            <mesh position={[-4, 13.2, -3]}>
              <boxGeometry args={[5, 0.5, 5]} />
              <meshStandardMaterial color="#1a1a1a" />
            </mesh>
            {/* USB-C Port */}
            <mesh position={[fcMounting / 2 + 2, 12, 0]}>
              <boxGeometry args={[3, 2.5, 9]} />
              <meshStandardMaterial color="#cbd5e1" metalness={0.8} roughness={0.2} />
            </mesh>
            {viewMode === "exploded" && (
              <>
                <Annotation
                  title="Flight Controller Stack"
                  description={`${fcMounting}×${fcMounting}mm • ESC + FC + Soft Mount Grommets`}
                  position={[fcMounting / 2 + 10, 12, 0]}
                />
                <Annotation
                  title="M3 Stack Hardware"
                  description="4× M3×20 BHCS + Rubber Grommets + Nyloc Nuts"
                  position={[-(fcMounting / 2 + 10), 8, 0]}
                />
              </>
            )}
            {viewMode !== "exploded" && (
              <Annotation
                title="Flight Controller Stack"
                description={`${fcMounting}×${fcMounting}mm ESC & FC`}
                position={[fcMounting / 2 + 10, 12, 0]}
              />
            )}
          </group>
          )}

          {/* FPV Camera with TPU mount and adjustable tilt */}
          {v.electronics && (
          <group
            position={[
              bottomPos[0],
              bottomPos[1] + bottomPlateTopY + standoffHeight / 2 + explodeCameraY,
              bottomPos[2] + fcMounting / 2 + 18,
            ]}
          >
            {/* TPU camera mount cradle */}
            {showTPU && viewMode !== "print_layout" && (
              <group>
                {/* Side plates */}
                <mesh position={[-12, 0, 0]} material={tpuMaterial} castShadow>
                  <boxGeometry args={[2, 22, 22]} />
                </mesh>
                <mesh position={[12, 0, 0]} material={tpuMaterial} castShadow>
                  <boxGeometry args={[2, 22, 22]} />
                </mesh>
                {/* Bottom cradle */}
                <mesh position={[0, -10, 0]} material={tpuMaterial} castShadow>
                  <boxGeometry args={[22, 2, 22]} />
                </mesh>
              </group>
            )}
            {/* Camera body with 30° uptilt (standard FPV angle) */}
            <group rotation={[-Math.PI * 30 / 180, 0, 0]}>
              <mesh>
                <boxGeometry args={[19, 19, 19]} />
                <meshStandardMaterial color="#111" roughness={0.8} />
              </mesh>
              {/* Lens barrel */}
              <mesh position={[0, 0, 10]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[7, 7, 8, 32]} />
                <meshStandardMaterial color="#000" roughness={0.3} />
              </mesh>
              {/* Lens glass */}
              <mesh position={[0, 0, 14.5]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[5.5, 5.5, 1, 32]} />
                <meshStandardMaterial color="#1e3a5f" roughness={0.1} metalness={0.3} />
              </mesh>
              {/* FOV Cone */}
              <mesh position={[0, 0, 35]} rotation={[-Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[40, 0.1, 40, 32]} />
                <meshStandardMaterial
                  color="#eab308"
                  transparent
                  opacity={0.08}
                  depthWrite={false}
                />
              </mesh>
            </group>
            <Annotation
              title="FPV Camera"
              description="19×19mm Micro • 30° Uptilt • 160° FOV"
              position={[15, 0, 0]}
            />
          </group>
          )}

          {/* LiPo Battery with straps, anti-slip pad, XT60 connector */}
          {v.electronics && (
          <group
            position={[
              topPos[0],
              topPos[1] + topPlateTopY + 15 + explodeBatteryY,
              topPos[2],
            ]}
          >
            {/* Anti-slip battery pad */}
            <mesh position={[0, -15.5, 0]}>
              <boxGeometry args={[38, 1, 78]} />
              <meshStandardMaterial color="#333" roughness={0.95} metalness={0} />
            </mesh>
            {/* Battery cell body */}
            <mesh>
              <boxGeometry args={[35, 30, 75]} />
              <meshStandardMaterial color="#475569" roughness={0.6} />
            </mesh>
            {/* Heat shrink wrap */}
            <mesh>
              <boxGeometry args={[36, 31, 76]} />
              <meshStandardMaterial color="#1e293b" transparent opacity={0.4} />
            </mesh>
            {/* Battery label */}
            <mesh position={[18.1, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
              <planeGeometry args={[40, 18]} />
              <meshStandardMaterial color="#dc2626" roughness={0.9} />
            </mesh>
            {/* XT60 Connector */}
            <group position={[0, 0, -40]}>
              <mesh material={brassMaterial}>
                <boxGeometry args={[16, 8, 7]} />
              </mesh>
              {/* XT60 pins */}
              <mesh position={[-3, 0, -4]} material={brassMaterial}>
                <cylinderGeometry args={[1.5, 1.5, 4, 8]} />
              </mesh>
              <mesh position={[3, 0, -4]} material={brassMaterial}>
                <cylinderGeometry args={[1.5, 1.5, 4, 8]} />
              </mesh>
              {/* Silicone wires from XT60 */}
              <mesh position={[-3, 0, -8]}>
                <cylinderGeometry args={[1.8, 1.8, 12, 8]} />
                <meshStandardMaterial color="#dc2626" roughness={0.8} />
              </mesh>
              <mesh position={[3, 0, -8]}>
                <cylinderGeometry args={[1.8, 1.8, 12, 8]} />
                <meshStandardMaterial color="#111" roughness={0.8} />
              </mesh>
            </group>
            {/* Balance lead */}
            <mesh position={[18, 3, 10]}>
              <boxGeometry args={[3, 6, 14]} />
              <meshStandardMaterial color="#f5f5f5" roughness={0.7} />
            </mesh>
            {/* Battery straps (×2) */}
            {[-20, 20].map((zOff, si) => (
              <group key={`strap-${si}`} position={[0, 0, zOff]}>
                {/* Strap around battery */}
                <mesh position={[0, 16, 0]}>
                  <boxGeometry args={[38, 1.5, 12]} />
                  <meshStandardMaterial color="#dc2626" roughness={0.6} />
                </mesh>
                <mesh position={[-19, 0, 0]}>
                  <boxGeometry args={[1.5, 32, 12]} />
                  <meshStandardMaterial color="#dc2626" roughness={0.6} />
                </mesh>
                <mesh position={[19, 0, 0]}>
                  <boxGeometry args={[1.5, 32, 12]} />
                  <meshStandardMaterial color="#dc2626" roughness={0.6} />
                </mesh>
                {/* Strap buckle */}
                <mesh position={[0, 16.5, 0]} material={steelMaterial}>
                  <boxGeometry args={[14, 2, 12]} />
                </mesh>
              </group>
            ))}
            {viewMode === "exploded" ? (
              <>
                <Annotation
                  title="LiPo Battery"
                  description={`6S ${propSize >= 7 ? '1800' : propSize >= 5 ? '1300' : '650'}mAh • XT60 Connector`}
                  position={[25, 0, 0]}
                />
                <Annotation
                  title="Battery Straps"
                  description="2× Non-Slip Rubberized Nylon"
                  position={[-25, 16, 0]}
                />
              </>
            ) : (
              <Annotation
                title="LiPo Battery"
                description={`6S ${propSize >= 7 ? '1800' : propSize >= 5 ? '1300' : '650'}mAh Top Mount`}
                position={[25, 0, 0]}
              />
            )}
          </group>
          )}
        </group>

        {/* Clearance Check Visualization */}
        {viewMode === "clearance_check" && clearanceData && (
          <group>
            {/* Prop sweep disks with clearance-colored rings */}
            {motorPositions.map((pos, i) => {
              const propR = (propSize * 25.4) / 2;
              // Find worst severity for this prop
              const propResults = clearanceData.filter(r => r.type.includes(`Prop ${i + 1}`));
              const worstSeverity = propResults.some(r => r.severity === "fail") ? "fail"
                : propResults.some(r => r.severity === "warn") ? "warn" : "ok";
              const diskColor = worstSeverity === "fail" ? "#ef4444"
                : worstSeverity === "warn" ? "#f59e0b" : "#22c55e";
              return (
                <group key={`clearance-disk-${i}`} position={[pos[0] + bottomPos[0], bottomPlateTopY + 18 + bottomPos[1], pos[2] + bottomPos[2]]}>
                  {/* Clearance envelope disk */}
                  <mesh>
                    <cylinderGeometry args={[propR + 1, propR + 1, 1, 64]} />
                    <meshStandardMaterial
                      color={diskColor}
                      transparent
                      opacity={0.25}
                      side={THREE.DoubleSide}
                      depthWrite={false}
                    />
                  </mesh>
                  {/* Outer ring */}
                  <mesh>
                    <torusGeometry args={[propR, 0.5, 8, 64]} />
                    <meshStandardMaterial color={diskColor} />
                  </mesh>
                </group>
              );
            })}
            {/* Clearance measurement lines */}
            {clearanceData.map((item, ci) => {
              const color = item.severity === "fail" ? "#ef4444"
                : item.severity === "warn" ? "#f59e0b" : "#22c55e";
              const mid = item.posA.clone().add(item.posB).multiplyScalar(0.5);
              return (
                <group key={`clearance-line-${ci}`}>
                  <Annotation
                    title={item.type}
                    description={`${item.distance.toFixed(1)}mm ${item.severity === "fail" ? "⚠ INTERFERENCE" : item.severity === "warn" ? "⚠ TIGHT" : "✓ OK"}`}
                    position={[mid.x, bottomPlateTopY + 25, mid.z]}
                  />
                </group>
              );
            })}
            {/* Frame body clearance envelope */}
            <mesh position={[0, bottomPlateTopY + 18, 0]}>
              <cylinderGeometry args={[fcMounting / 2 + 10, fcMounting / 2 + 10, 1, 32]} />
              <meshStandardMaterial color="#3b82f6" transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} />
            </mesh>
          </group>
        )}
        {v.accessories && showTPU && viewMode !== "print_layout" && (
          <group>
            {/* Action Camera Mount (GoPro) */}
            <group
              position={[
                topPos[0],
                topPos[1] + topPlateTopY + 2 + explodeTpuY,
                topPos[2] + fcMounting / 2 + 10,
              ]}
            >
              <mesh castShadow receiveShadow material={tpuMaterial}>
                <boxGeometry args={[24, 4, 20]} />
              </mesh>
              <mesh
                position={[-4, 8, 0]}
                castShadow
                receiveShadow
                material={tpuMaterial}
              >
                <boxGeometry args={[3, 16, 15]} />
              </mesh>
              <mesh
                position={[4, 8, 0]}
                castShadow
                receiveShadow
                material={tpuMaterial}
              >
                <boxGeometry args={[3, 16, 15]} />
              </mesh>
              <mesh
                position={[-4, 16, 0]}
                rotation={[Math.PI / 2, 0, Math.PI / 2]}
                castShadow
                receiveShadow
                material={tpuMaterial}
              >
                <cylinderGeometry args={[7.5, 7.5, 3, 16]} />
              </mesh>
              <mesh
                position={[4, 16, 0]}
                rotation={[Math.PI / 2, 0, Math.PI / 2]}
                castShadow
                receiveShadow
                material={tpuMaterial}
              >
                <cylinderGeometry args={[7.5, 7.5, 3, 16]} />
              </mesh>
              {viewMode === "exploded" && (
                <Annotation
                  title="Action Cam Mount"
                  description="Flexible TPU GoPro Base"
                  position={[15, 10, 0]}
                />
              )}
            </group>

            {/* Rear Antenna Mount */}
            <group
              position={[
                bottomPos[0],
                standoffY + explodeTpuY,
                bottomPos[2] - fcMounting / 2 - 8,
              ]}
            >
              <mesh castShadow receiveShadow material={tpuMaterial}>
                <boxGeometry args={[20, standoffHeight, 6]} />
              </mesh>
              {/* VTX Antenna Tube */}
              <mesh
                position={[0, standoffHeight / 2 + 5, -5]}
                rotation={[Math.PI / 6, 0, 0]}
                castShadow
                receiveShadow
                material={tpuMaterial}
              >
                <cylinderGeometry args={[3, 3, 20, 16]} />
              </mesh>
              {/* RX Antenna Tubes (Crossfire/ELRS) */}
              <mesh
                position={[-8, 0, -5]}
                rotation={[Math.PI / 4, -Math.PI / 4, 0]}
                castShadow
                receiveShadow
                material={tpuMaterial}
              >
                <cylinderGeometry args={[2, 2, 30, 12]} />
              </mesh>
              <mesh
                position={[8, 0, -5]}
                rotation={[Math.PI / 4, Math.PI / 4, 0]}
                castShadow
                receiveShadow
                material={tpuMaterial}
              >
                <cylinderGeometry args={[2, 2, 30, 12]} />
              </mesh>
              <Annotation
                title="Antenna Array"
                description="VTX + Diversity RX Tubes"
                position={[15, 0, 0]}
              />
            </group>

            {/* Arm Guards / Motor Bumpers */}
            {motorPositions.map((pos, i) => {
              const angle = i * (Math.PI / 2) + Math.PI / 4;
              const motorPadRadius = motorMountPattern / 2 + 3.5;

              const armLen = Math.max(1e-6, Math.hypot(pos[0], pos[2]));
              const armDirX = pos[0] / armLen;
              const armDirZ = pos[2] / armLen;
              const explodeMotorRad = exploded ? 22 : 0;
              const explodeMotorX = armDirX * explodeMotorRad;
              const explodeMotorZ = armDirZ * explodeMotorRad;

              return (
                <group
                  key={`guard-${i}`}
                  position={[
                    pos[0] + bottomPos[0] + explodeMotorX,
                    bottomPos[1] + bottomPlateTopY + explodeMotorY,
                    pos[2] + bottomPos[2] + explodeMotorZ,
                  ]}
                >
                  <mesh
                    rotation={[Math.PI / 2, 0, -angle - Math.PI / 2]}
                    castShadow
                    receiveShadow
                    material={tpuMaterial}
                  >
                    <torusGeometry
                      args={[motorPadRadius + 1, 2.5, 12, 24, Math.PI * 1.2]}
                    />
                  </mesh>
                  {viewMode === "exploded" && i === 0 && (
                    <Annotation
                      title="Motor Bumpers"
                      description="TPU Impact Protection"
                      position={[15, 0, 0]}
                    />
                  )}
                </group>
              );
            })}
          </group>
        )}
      </group>
    </group>
  );

  return physicsEnabled ? (
    <RigidBody
      type="dynamic"
      colliders={false}
      ref={viewMode === "flight_sim" ? flightBodyRef : undefined}
      canSleep={true}
      mass={massProps.massKg}
      friction={1.1}
      restitution={0.05}
      linearDamping={viewMode === "flight_sim" ? 0.01 : 2.2}
      angularDamping={viewMode === "flight_sim" ? 0.01 : 2.2}
      gravityScale={1}
      position={[0, viewMode === "flight_sim" ? flightSpawnLiftY : assemblySpawnLiftY, 0]}
    >
      <CuboidCollider
        density={viewMode === "flight_sim" ? colliderDensity : 1e-6}
        args={assemblyHalfExtents}
        position={
          viewMode === "flight_sim"
            ? [
                flightColliderOffset[0],
                assemblyColliderCenterY + flightColliderOffset[1],
                flightColliderOffset[2],
              ]
            : [0, assemblyColliderCenterY, 0]
        }
        friction={1.1}
        restitution={0.05}
      />
      {droneVisual}
    </RigidBody>
  ) : (
    droneVisual
  );
}
