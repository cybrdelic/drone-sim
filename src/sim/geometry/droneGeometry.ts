import * as THREE from "three";
import { ADDITION, Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import {
  computeHarnessBundleDiameterMm,
  computeHarnessConductorsPerArm,
} from "../labModels";
import { SimSettings, ViewMode } from "../../types";

export type Point3 = [number, number, number];
export type MotorIndex = 0 | 1 | 2 | 3;
export type MotorTuple<T> = [T, T, T, T];
export type ClearanceSeverity = "ok" | "warn" | "fail";

export interface DroneGeometryInputs {
  armWidth: number;
  fcMounting: number;
  frameSize: number;
  motorCenterHole: number;
  motorMountPattern: number;
  plateThickness: number;
  topPlateThickness: number;
  weightReduction: number;
}

export interface DroneGeometryData {
  bottomPlateGeo: THREE.BufferGeometry;
  topPlateGeo: THREE.BufferGeometry;
  standoffsData: MotorTuple<Point3>;
  motorPositions: MotorTuple<Point3>;
}

export interface ClearanceDatum {
  type: string;
  distance: number;
  posA: THREE.Vector3;
  posB: THREE.Vector3;
  severity: ClearanceSeverity;
}

interface ClearanceDataInputs {
  armWidth: number;
  fcMounting: number;
  motorPositions: MotorTuple<Point3>;
  plateThickness: number;
  propSize: number;
  simSettings: SimSettings;
  standoffHeight: number;
  viewMode: ViewMode;
}

export const motorIndices: readonly MotorIndex[] = [0, 1, 2, 3];

export function buildMotorTuple<T>(
  factory: (index: MotorIndex) => T,
): MotorTuple<T> {
  return motorIndices.map((index) => factory(index)) as MotorTuple<T>;
}

export function motorAngleRad(index: MotorIndex) {
  return index * (Math.PI / 2) + Math.PI / 4;
}

export function createCsgEvaluator() {
  const evaluator = new Evaluator();
  evaluator.useGroups = false;
  return evaluator;
}

export function buildDroneGeometry(
  {
    armWidth,
    fcMounting,
    frameSize,
    motorCenterHole,
    motorMountPattern,
    plateThickness,
    topPlateThickness,
    weightReduction,
  }: DroneGeometryInputs,
  evaluator: Evaluator,
): DroneGeometryData {
  const centerRadius = fcMounting / 2 + 10;
  const armLength = frameSize / 2;
  const motorPadRadius = motorMountPattern / 2 + 3.5;
  const screwHoleRadius = motorMountPattern >= 16 ? 1.6 : 1.1;
  const motorPositions = buildMotorTuple((index) => {
    const angle = motorAngleRad(index);
    return [
      Math.cos(angle) * armLength,
      plateThickness,
      Math.sin(angle) * armLength,
    ] as Point3;
  });

  const baseGeo = new THREE.CylinderGeometry(
    centerRadius,
    centerRadius,
    plateThickness,
    32,
  );
  let bottomBrush = new Brush(baseGeo);
  bottomBrush.position.y = plateThickness / 2;
  bottomBrush.updateMatrixWorld();

  for (const index of motorIndices) {
    const angle = motorAngleRad(index);
    const centerX = Math.cos(angle) * (armLength / 2);
    const centerZ = Math.sin(angle) * (armLength / 2);

    const armGeo = new THREE.BoxGeometry(armWidth, plateThickness, armLength);
    const armBrush = new Brush(armGeo);
    armBrush.position.set(centerX, plateThickness / 2, centerZ);
    armBrush.lookAt(centerX * 2, plateThickness / 2, centerZ * 2);
    armBrush.updateMatrixWorld();
    bottomBrush = evaluator.evaluate(bottomBrush, armBrush, ADDITION);

    const [motorX, , motorZ] = motorPositions[index];
    const padGeo = new THREE.CylinderGeometry(
      motorPadRadius,
      motorPadRadius,
      plateThickness,
      32,
    );
    const padBrush = new Brush(padGeo);
    padBrush.position.set(motorX, plateThickness / 2, motorZ);
    padBrush.updateMatrixWorld();
    bottomBrush = evaluator.evaluate(bottomBrush, padBrush, ADDITION);
  }

  const holesToSubtract: Brush[] = [];
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

  for (const index of motorIndices) {
    const angle = motorAngleRad(index);
    const [motorX, , motorZ] = motorPositions[index];

    const centerHole = new Brush(
      new THREE.CylinderGeometry(
        motorCenterHole / 2,
        motorCenterHole / 2,
        plateThickness * 4,
        16,
      ),
    );
    centerHole.position.set(motorX, plateThickness / 2, motorZ);
    centerHole.updateMatrixWorld();
    holesToSubtract.push(centerHole);

    for (let screwIndex = 0; screwIndex < 4; screwIndex++) {
      const screwAngle = screwIndex * (Math.PI / 2);
      const screwX =
        motorX + Math.cos(screwAngle) * (motorMountPattern / 2);
      const screwZ =
        motorZ + Math.sin(screwAngle) * (motorMountPattern / 2);
      const screwHole = new Brush(
        new THREE.CylinderGeometry(
          screwHoleRadius,
          screwHoleRadius,
          plateThickness * 4,
          16,
        ),
      );
      screwHole.position.set(screwX, plateThickness / 2, screwZ);
      screwHole.updateMatrixWorld();
      holesToSubtract.push(screwHole);
    }

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
        const cutoutX = Math.cos(angle) * (armLength * 0.45);
        const cutoutZ = Math.sin(angle) * (armLength * 0.45);
        cutout.position.set(cutoutX, plateThickness / 2, cutoutZ);
        cutout.lookAt(cutoutX * 2, plateThickness / 2, cutoutZ * 2);
        cutout.updateMatrixWorld();
        holesToSubtract.push(cutout);
      }
    }
  }

  for (const hole of holesToSubtract) {
    bottomBrush = evaluator.evaluate(bottomBrush, hole, SUBTRACTION);
  }

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

  const topHoles: Brush[] = [];
  for (const dx of [-1, 1]) {
    for (const dz of [-1, 1]) {
      const fcHole = new Brush(fcHoleGeo);
      fcHole.position.set(dx * fcOffset, topPlateThickness / 2, dz * fcOffset);
      fcHole.updateMatrixWorld();
      topHoles.push(fcHole);
    }
  }

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

  const standoffsData: MotorTuple<Point3> = [
    [-fcOffset, 0, -fcOffset],
    [-fcOffset, 0, fcOffset],
    [fcOffset, 0, -fcOffset],
    [fcOffset, 0, fcOffset],
  ];

  return {
    bottomPlateGeo: bottomBrush.geometry,
    topPlateGeo: topBrush.geometry,
    standoffsData,
    motorPositions,
  };
}

export function computeClearanceData({
  armWidth,
  fcMounting,
  motorPositions,
  plateThickness,
  propSize,
  simSettings,
  standoffHeight,
  viewMode,
}: ClearanceDataInputs): ClearanceDatum[] | null {
  if (viewMode !== "clearance_check") {
    return null;
  }

  const propRadiusMm = (propSize * 25.4) / 2;
  const toleranceMm = Math.max(0, simSettings.manufacturingToleranceMm);
  const harnessConductorsPerArm = computeHarnessConductorsPerArm(
    simSettings.wiringBundleCount,
  );
  const harnessBundleDiameterMm = computeHarnessBundleDiameterMm(
    simSettings.wireOuterDiameterMm,
    harnessConductorsPerArm,
  );
  const harnessKeepoutMm =
    harnessBundleDiameterMm * 0.5 +
    simSettings.wiringMinSpacingMm +
    toleranceMm;
  const results: ClearanceDatum[] = [];
  const cameraCenter = new THREE.Vector3(
    0,
    plateThickness + standoffHeight / 2,
    fcMounting / 2 + 18,
  );
  const gpsMastTop = new THREE.Vector3(
    0,
    plateThickness + standoffHeight + simSettings.buildTopPlateThicknessMm + 24,
    -fcMounting / 2 - 18,
  );
  const imuBaroCenter = new THREE.Vector3(6, plateThickness + 13, 4);
  const rangefinderCenter = new THREE.Vector3(0, -6, 6);
  const antennaTubeLeft = new THREE.Vector3(
    -12,
    plateThickness + standoffHeight * 0.72,
    -fcMounting / 2 - 26,
  );
  const antennaTubeRight = new THREE.Vector3(
    12,
    plateThickness + standoffHeight * 0.72,
    -fcMounting / 2 - 26,
  );
  const strapCenters = [
    new THREE.Vector3(
      0,
      plateThickness + standoffHeight + simSettings.buildTopPlateThicknessMm + 31,
      -20,
    ),
    new THREE.Vector3(
      0,
      plateThickness + standoffHeight + simSettings.buildTopPlateThicknessMm + 31,
      20,
    ),
  ];

  const segmentDistanceToPoint = (
    start: THREE.Vector3,
    end: THREE.Vector3,
    point: THREE.Vector3,
  ) => {
    const direction = end.clone().sub(start);
    const lengthSq = Math.max(1e-6, direction.lengthSq());
    const t = THREE.MathUtils.clamp(
      point.clone().sub(start).dot(direction) / lengthSq,
      0,
      1,
    );
    return start
      .clone()
      .add(direction.multiplyScalar(t))
      .distanceTo(point);
  };

  for (const firstIndex of motorIndices) {
    for (const secondIndex of motorIndices) {
      if (secondIndex <= firstIndex) {
        continue;
      }

      const a = new THREE.Vector3(...motorPositions[firstIndex]);
      const b = new THREE.Vector3(...motorPositions[secondIndex]);
      const distance2D = Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
      const gap = distance2D - 2 * propRadiusMm - toleranceMm * 2;
      results.push({
        type: `Prop ${firstIndex + 1}↔${secondIndex + 1}`,
        distance: gap,
        posA: a,
        posB: b,
        severity:
          gap < 0 ? "fail" : gap < Math.max(3, toleranceMm * 3) ? "warn" : "ok",
      });
    }
  }

  const centerRadius = fcMounting / 2 + 10;
  for (const motorIndex of motorIndices) {
    const motorPosition = new THREE.Vector3(...motorPositions[motorIndex]);
    const distanceToCenter = Math.sqrt(
      motorPosition.x ** 2 + motorPosition.z ** 2,
    );
    const tipInward = distanceToCenter - propRadiusMm;
    const gap = tipInward - centerRadius - toleranceMm;
    results.push({
      type: `Prop ${motorIndex + 1}↔Body`,
      distance: gap,
      posA: motorPosition,
      posB: new THREE.Vector3(0, motorPosition.y, 0),
      severity:
        gap < 0 ? "fail" : gap < Math.max(2, toleranceMm * 2) ? "warn" : "ok",
    });
  }

  for (const motorIndex of motorIndices) {
    const motorPosition = new THREE.Vector3(...motorPositions[motorIndex]);
    for (const offset of [-1, 1]) {
      const armIndex = (motorIndex + offset + 4) % 4;
      const armAngle = armIndex * (Math.PI / 2) + Math.PI / 4;
      const armDirection = new THREE.Vector2(
        Math.cos(armAngle),
        Math.sin(armAngle),
      );
      const motorPosition2D = new THREE.Vector2(motorPosition.x, motorPosition.z);
      const projection = armDirection
        .clone()
        .multiplyScalar(motorPosition2D.dot(armDirection));
      const perpendicularDistance = motorPosition2D
        .clone()
        .sub(projection)
        .length();
      const gap =
        perpendicularDistance - propRadiusMm - armWidth / 2 - toleranceMm;
      results.push({
        type: `Prop ${motorIndex + 1}↔Arm ${armIndex + 1}`,
        distance: gap,
        posA: motorPosition,
        posB: new THREE.Vector3(projection.x, motorPosition.y, projection.y),
        severity:
          gap < 0
            ? "fail"
            : gap < Math.max(2.5, toleranceMm * 2.5)
              ? "warn"
              : "ok",
      });
    }
  }

  for (const motorIndex of motorIndices) {
    const propCenter = new THREE.Vector3(...motorPositions[motorIndex]);
    const componentTargets = [
      { label: "Camera", center: cameraCenter, radius: 10 },
      { label: "GPS Mast", center: gpsMastTop, radius: 6 },
      { label: "IMU/Baro", center: imuBaroCenter, radius: 8 },
      { label: "Rangefinder", center: rangefinderCenter, radius: 9 },
      { label: "Antenna L", center: antennaTubeLeft, radius: 4 },
      { label: "Antenna R", center: antennaTubeRight, radius: 4 },
      ...strapCenters.map((center, index) => ({
        label: `Strap ${index + 1}`,
        center,
        radius: 6,
      })),
    ];

    for (const target of componentTargets) {
      const gap =
        propCenter.distanceTo(target.center) - propRadiusMm - target.radius - toleranceMm;
      results.push({
        type: `Prop ${motorIndex + 1}↔${target.label}`,
        distance: gap,
        posA: propCenter,
        posB: target.center,
        severity:
          gap < 0 ? "fail" : gap < Math.max(3, toleranceMm * 2) ? "warn" : "ok",
      });
    }
  }

  for (const motorIndex of motorIndices) {
    const propCenter = new THREE.Vector3(...motorPositions[motorIndex]);
    const armStart = new THREE.Vector3(0, plateThickness / 2, 0);
    const armEnd = propCenter.clone();
    const wiringGap =
      segmentDistanceToPoint(armStart, armEnd, propCenter) -
      propRadiusMm -
      harnessKeepoutMm;
    results.push({
      type: `Prop ${motorIndex + 1}↔Wiring`,
      distance: wiringGap,
      posA: propCenter,
      posB: armStart.clone().lerp(armEnd, 0.55),
      severity:
        wiringGap < 0
          ? "fail"
          : wiringGap < Math.max(2, toleranceMm * 2)
            ? "warn"
            : "ok",
    });
  }

  return results.sort((left, right) => left.distance - right.distance);
}
