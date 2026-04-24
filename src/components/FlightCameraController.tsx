import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

export type CameraMode = "chase" | "close" | "hood";

export function FlightCameraController({
  enabled,
  targetRef,
  mode,
}: {
  enabled: boolean;
  targetRef: React.RefObject<THREE.Group | null>;
  mode: CameraMode;
}) {
  const { camera } = useThree();
  const savedPosition = useRef(new THREE.Vector3());
  const savedQuaternion = useRef(new THREE.Quaternion());
  const hasSavedCameraState = useRef(false);
  const worldPos = useRef(new THREE.Vector3());
  const worldQuat = useRef(new THREE.Quaternion());
  const offset = useRef(new THREE.Vector3());
  const desiredPosition = useRef(new THREE.Vector3());
  const localOffset = useRef(new THREE.Vector3());
  const localFocus = useRef(new THREE.Vector3());
  const localBackward = useRef(new THREE.Vector3());
  const localRight = useRef(new THREE.Vector3());
  const localUp = useRef(new THREE.Vector3());
  const lookMatrix = useRef(new THREE.Matrix4());
  const localQuat = useRef(new THREE.Quaternion());
  const desiredQuat = useRef(new THREE.Quaternion());
  const worldUp = useRef(new THREE.Vector3(0, 1, 0));

  useEffect(() => {
    if (enabled) {
      if (!hasSavedCameraState.current) {
        savedPosition.current.copy(camera.position);
        savedQuaternion.current.copy(camera.quaternion);
        hasSavedCameraState.current = true;
      }
      return;
    }

    if (!hasSavedCameraState.current) {
      return;
    }

    camera.position.copy(savedPosition.current);
    camera.quaternion.copy(savedQuaternion.current);
    camera.updateMatrixWorld();
    hasSavedCameraState.current = false;
  }, [camera, enabled]);

  useFrame(() => {
    if (!enabled || !targetRef.current) return;

    const drone = targetRef.current;
    drone.updateWorldMatrix(true, false);
    drone.getWorldPosition(worldPos.current);
    drone.getWorldQuaternion(worldQuat.current);

    const config =
      mode === "hood"
        ? {
            localOffset: [0, 72, 28] as const,
            localFocus: [0, 88, 1800] as const,
          }
        : mode === "close"
          ? {
              localOffset: [0, 140, -520] as const,
              localFocus: [0, 80, 340] as const,
            }
          : {
              localOffset: [0, 260, -980] as const,
              localFocus: [0, 120, 520] as const,
            };

    localOffset.current.set(
      config.localOffset[0],
      config.localOffset[1],
      config.localOffset[2],
    );
    localFocus.current.set(
      config.localFocus[0],
      config.localFocus[1],
      config.localFocus[2],
    );

    localBackward.current
      .copy(localOffset.current)
      .sub(localFocus.current)
      .normalize();
    localRight.current
      .crossVectors(worldUp.current, localBackward.current)
      .normalize();
    if (localRight.current.lengthSq() < 1e-8) {
      localRight.current.set(1, 0, 0);
    }
    localUp.current.crossVectors(localBackward.current, localRight.current).normalize();

    lookMatrix.current.makeBasis(
      localRight.current,
      localUp.current,
      localBackward.current,
    );
    localQuat.current.setFromRotationMatrix(lookMatrix.current);

    offset.current.copy(localOffset.current).applyQuaternion(worldQuat.current);
    desiredPosition.current.copy(worldPos.current).add(offset.current);
    camera.position.copy(desiredPosition.current);
    desiredQuat.current.copy(worldQuat.current).multiply(localQuat.current);
    camera.quaternion.copy(desiredQuat.current);
    camera.updateMatrixWorld();
  });

  return null;
}
