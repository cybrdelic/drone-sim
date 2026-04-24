import * as THREE from "three";

type MatrixRow4 = [number, number, number, number];
type Matrix4x4 = [MatrixRow4, MatrixRow4, MatrixRow4, MatrixRow4];
type Vector4 = [number, number, number, number];
type MatrixIndex = 0 | 1 | 2 | 3;

const matrix4Indices: readonly MatrixIndex[] = [0, 1, 2, 3];

export function boxInertiaDiagKgM2(
  massKg: number,
  sizeM: THREE.Vector3,
) {
  const x2 = sizeM.x * sizeM.x;
  const y2 = sizeM.y * sizeM.y;
  const z2 = sizeM.z * sizeM.z;
  return new THREE.Vector3(
    (massKg / 12) * (y2 + z2),
    (massKg / 12) * (x2 + z2),
    (massKg / 12) * (x2 + y2),
  );
}

export function mulMat3Vec(
  matrix: THREE.Matrix3,
  vector: THREE.Vector3,
) {
  const elements = matrix.elements as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return new THREE.Vector3(
    elements[0] * vector.x + elements[3] * vector.y + elements[6] * vector.z,
    elements[1] * vector.x + elements[4] * vector.y + elements[7] * vector.z,
    elements[2] * vector.x + elements[5] * vector.y + elements[8] * vector.z,
  );
}

function isFiniteMatrix4x4(matrix: number[][]): matrix is Matrix4x4 {
  return (
    matrix.length === 4 &&
    matrix.every(
      (row): row is MatrixRow4 =>
        row.length === 4 && row.every((value) => Number.isFinite(value)),
    )
  );
}

function isFiniteVector4(rhs: number[]): rhs is Vector4 {
  return rhs.length === 4 && rhs.every((value) => Number.isFinite(value));
}

export function solve4x4(matrix: number[][], rhs: number[]) {
  if (!isFiniteMatrix4x4(matrix) || !isFiniteVector4(rhs)) {
    return null;
  }

  const workingMatrix = matrix.map((row) => row.slice() as MatrixRow4) as Matrix4x4;
  const workingRhs = rhs.slice() as Vector4;

  for (const col of matrix4Indices) {
    let pivot: MatrixIndex = col;
    let pivotAbs = Math.abs(workingMatrix[col][col]);
    for (const row of matrix4Indices) {
      if (row <= col) {
        continue;
      }

      const candidate = Math.abs(workingMatrix[row][col]);
      if (candidate > pivotAbs) {
        pivotAbs = candidate;
        pivot = row;
      }
    }

    if (pivotAbs < 1e-9) {
      return null;
    }

    if (pivot !== col) {
      const tmpRow = workingMatrix[col] as MatrixRow4;
      workingMatrix[col] = workingMatrix[pivot] as MatrixRow4;
      workingMatrix[pivot] = tmpRow;
      const tmpValue = workingRhs[col];
      workingRhs[col] = workingRhs[pivot];
      workingRhs[pivot] = tmpValue;
    }

    const divisor = workingMatrix[col][col];
    for (const currentCol of matrix4Indices) {
      if (currentCol < col) {
        continue;
      }

      workingMatrix[col][currentCol] /= divisor;
    }
    workingRhs[col] /= divisor;

    for (const row of matrix4Indices) {
      if (row === col) {
        continue;
      }

      const factor = workingMatrix[row][col];
      for (const currentCol of matrix4Indices) {
        if (currentCol < col) {
          continue;
        }

        workingMatrix[row][currentCol] -= factor * workingMatrix[col][currentCol];
      }
      workingRhs[row] -= factor * workingRhs[col];
    }
  }

  return workingRhs;
}
