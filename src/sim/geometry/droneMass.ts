import * as THREE from "three";
import { boxInertiaDiagKgM2 } from "../flightMath";
import type { SimSettings } from "../../types";
import type {
  Matrix3Elements,
  Matrix3Index,
} from "./matrixTypes";
import type { Point3 } from "./droneGeometry";

const matrix3Indices: readonly Matrix3Index[] = [0, 1, 2, 3, 4, 5, 6, 7, 8];

interface DroneMassInputs {
  armWidth: number;
  fcMounting: number;
  frameSize: number;
  motorCenterHole: number;
  motorMountPattern: number;
  motorPositions: Point3[];
  plateThickness: number;
  simSettings: SimSettings;
  standoffHeight: number;
  topPlateThickness: number;
  weightReduction: number;
}

export interface DroneMassProperties {
  massKg: number;
  comMm: THREE.Vector3;
  inertiaKgM2: THREE.Matrix3;
  invInertiaKgM2: THREE.Matrix3;
}

function addMatrix3InPlace(target: THREE.Matrix3, source: THREE.Matrix3) {
  const targetElements = target.elements as Matrix3Elements;
  const sourceElements = source.elements as Matrix3Elements;
  for (const index of matrix3Indices) {
    targetElements[index] += sourceElements[index];
  }
}

function buildParallelAxisShift(massKg: number, offsetM: THREE.Vector3) {
  const radiusSquared = offsetM.lengthSq();
  const radiusOuterProduct = new THREE.Matrix3().set(
    offsetM.x * offsetM.x,
    offsetM.x * offsetM.y,
    offsetM.x * offsetM.z,
    offsetM.y * offsetM.x,
    offsetM.y * offsetM.y,
    offsetM.y * offsetM.z,
    offsetM.z * offsetM.x,
    offsetM.z * offsetM.y,
    offsetM.z * offsetM.z,
  );
  const shifted = new THREE.Matrix3().identity().multiplyScalar(radiusSquared);
  const shiftedElements = shifted.elements as Matrix3Elements;
  const outerElements = radiusOuterProduct.elements as Matrix3Elements;
  for (const index of matrix3Indices) {
    shiftedElements[index] -= outerElements[index];
  }
  return shifted.multiplyScalar(massKg);
}

export function computeDroneMassProperties({
  armWidth,
  fcMounting,
  frameSize,
  motorCenterHole,
  motorMountPattern,
  motorPositions,
  plateThickness,
  simSettings,
  standoffHeight,
  topPlateThickness,
  weightReduction,
}: DroneMassInputs): DroneMassProperties {
  const mmToM = 1e-3;
  const mm3ToM3 = 1e-9;
  const carbonDensityKgM3 = Math.max(250, simSettings.materialDensityGcm3 * 1000);
  const centerRadius = fcMounting / 2 + 10;
  const armLength = frameSize / 2;
  const motorPadRadius = motorMountPattern / 2 + 3.5;
  const screwHoleRadius = motorMountPattern >= 16 ? 1.6 : 1.1;
  const fcHoleRadius = 1.6;
  const topPlateWidthMm = fcMounting + 12;
  const topPlateDepthMm = fcMounting + 30;
  const topCornerRadiusMm = 6;

  const centerAreaMm2 = Math.PI * centerRadius * centerRadius;
  const armAreaMm2 = 4 * armWidth * armLength * 0.82;
  const motorPadAreaMm2 = 4 * Math.PI * motorPadRadius * motorPadRadius;
  const fcHolesAreaMm2 = 4 * Math.PI * fcHoleRadius * fcHoleRadius;
  const motorHolesAreaMm2 =
    4 * Math.PI * Math.pow(motorCenterHole / 2, 2) +
    16 * Math.PI * screwHoleRadius * screwHoleRadius;
  const cutoutWidthMm = armWidth * (weightReduction / 100) * 0.7;
  const cutoutLengthMm = armLength * 0.5;
  const cutoutAreaMm2 =
    weightReduction > 0 && cutoutWidthMm > 2
      ? 4 * cutoutWidthMm * cutoutLengthMm * 0.72
      : 0;

  const bottomAreaMm2 = Math.max(
    centerAreaMm2 +
      armAreaMm2 +
      motorPadAreaMm2 -
      fcHolesAreaMm2 -
      motorHolesAreaMm2 -
      cutoutAreaMm2,
    centerAreaMm2,
  );

  const roundedRectAreaMm2 =
    topPlateWidthMm * topPlateDepthMm -
    (4 - Math.PI) * topCornerRadiusMm * topCornerRadiusMm;
  const strapSlotAreaMm2 = 2 * 20 * 3;
  const topAreaMm2 = Math.max(
    roundedRectAreaMm2 - fcHolesAreaMm2 - strapSlotAreaMm2,
    roundedRectAreaMm2 * 0.7,
  );

  const bottomMassKg =
    bottomAreaMm2 * plateThickness * mm3ToM3 * carbonDensityKgM3;
  const topMassKg =
    topAreaMm2 * topPlateThickness * mm3ToM3 * carbonDensityKgM3;

  const bottomPlate = {
    massKg: bottomMassKg,
    comMm: new THREE.Vector3(0, plateThickness / 2, 0),
    inertiaKgM2AboutCOM: (() => {
      const bottomSpanMm = Math.SQRT1_2 * frameSize + motorPadRadius * 2;
      const inertiaDiag = boxInertiaDiagKgM2(
        bottomMassKg,
        new THREE.Vector3(
          bottomSpanMm * mmToM,
          plateThickness * mmToM,
          bottomSpanMm * mmToM,
        ),
      );
      return new THREE.Matrix3().set(
        inertiaDiag.x,
        0,
        0,
        0,
        inertiaDiag.y,
        0,
        0,
        0,
        inertiaDiag.z,
      );
    })(),
  };

  const topPlate = {
    massKg: topMassKg,
    comMm: new THREE.Vector3(0, topPlateThickness / 2, 0),
    inertiaKgM2AboutCOM: (() => {
      const inertiaDiag = boxInertiaDiagKgM2(
        topMassKg,
        new THREE.Vector3(
          topPlateWidthMm * mmToM,
          topPlateThickness * mmToM,
          topPlateDepthMm * mmToM,
        ),
      );
      return new THREE.Matrix3().set(
        inertiaDiag.x,
        0,
        0,
        0,
        inertiaDiag.y,
        0,
        0,
        0,
        inertiaDiag.z,
      );
    })(),
  };

  const bottomOffsetMm = new THREE.Vector3(0, 0, 0);
  const topOffsetMm = new THREE.Vector3(0, plateThickness + standoffHeight, 0);
  const bottomComMm = bottomPlate.comMm.clone().add(bottomOffsetMm);
  const topComMm = topPlate.comMm.clone().add(topOffsetMm);

  const motorMassKg = Math.max(0.005, simSettings.buildMotorMassG / 1000);
  const batteryMassKg = Math.max(0.02, simSettings.buildBatteryMassG / 1000);
  const stackMassKg = Math.max(0.005, simSettings.buildStackMassG / 1000);
  const propMassKg = Math.max(0.001, simSettings.buildPropMassG / 1000);
  const miscMassKg = Math.max(0, simSettings.buildMiscMassG / 1000);
  const motorTotalMassKg = (motorMassKg + propMassKg) * 4;

  const batteryPosMm = new THREE.Vector3(
    0,
    topOffsetMm.y + topPlateThickness + 15,
    0,
  );
  const stackPosMm = new THREE.Vector3(0, plateThickness + 10, 0);
  const motorPositionVectors = motorPositions.map(
    (position) => new THREE.Vector3(position[0], position[1], position[2]),
  );

  const totalMassKg = Math.max(
    0.05,
    bottomPlate.massKg +
      topPlate.massKg +
      motorTotalMassKg +
      batteryMassKg +
      stackMassKg +
      miscMassKg,
  );

  const comMm = new THREE.Vector3(0, 0, 0);
  comMm.add(bottomComMm.clone().multiplyScalar(bottomPlate.massKg));
  comMm.add(topComMm.clone().multiplyScalar(topPlate.massKg));
  comMm.add(batteryPosMm.clone().multiplyScalar(batteryMassKg));
  comMm.add(stackPosMm.clone().multiplyScalar(stackMassKg));
  for (const motorPosition of motorPositionVectors) {
    comMm.add(motorPosition.clone().multiplyScalar(motorMassKg + propMassKg));
  }
  comMm.divideScalar(totalMassKg);

  const inertiaKgM2 = new THREE.Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0);

  {
    const shiftedBottom = buildParallelAxisShift(
      bottomPlate.massKg,
      bottomComMm.clone().sub(comMm).multiplyScalar(mmToM),
    );
    const plateInertia = bottomPlate.inertiaKgM2AboutCOM.clone();
    addMatrix3InPlace(plateInertia, shiftedBottom);
    addMatrix3InPlace(inertiaKgM2, plateInertia);
  }

  {
    const shiftedTop = buildParallelAxisShift(
      topPlate.massKg,
      topComMm.clone().sub(comMm).multiplyScalar(mmToM),
    );
    const plateInertia = topPlate.inertiaKgM2AboutCOM.clone();
    addMatrix3InPlace(plateInertia, shiftedTop);
    addMatrix3InPlace(inertiaKgM2, plateInertia);
  }

  addMatrix3InPlace(
    inertiaKgM2,
    buildParallelAxisShift(
      batteryMassKg,
      batteryPosMm.clone().sub(comMm).multiplyScalar(mmToM),
    ),
  );
  addMatrix3InPlace(
    inertiaKgM2,
    buildParallelAxisShift(
      stackMassKg,
      stackPosMm.clone().sub(comMm).multiplyScalar(mmToM),
    ),
  );
  for (const motorPosition of motorPositionVectors) {
    addMatrix3InPlace(
      inertiaKgM2,
      buildParallelAxisShift(
        motorMassKg + propMassKg,
        motorPosition.clone().sub(comMm).multiplyScalar(mmToM),
      ),
    );
  }
  addMatrix3InPlace(
    inertiaKgM2,
    buildParallelAxisShift(miscMassKg, new THREE.Vector3(0, 0, 0)),
  );

  inertiaKgM2.elements[0] = Math.max(inertiaKgM2.elements[0], 1e-7);
  inertiaKgM2.elements[4] = Math.max(inertiaKgM2.elements[4], 1e-7);
  inertiaKgM2.elements[8] = Math.max(inertiaKgM2.elements[8], 1e-7);

  const invInertiaKgM2 = inertiaKgM2.clone();
  const determinant = invInertiaKgM2.determinant();
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-18) {
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
}
