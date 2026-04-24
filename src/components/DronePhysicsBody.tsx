import type { MutableRefObject, ReactNode } from "react";
import type { DroneRapierComponents, DroneRigidBodyRef } from "../physics/rapierBundle";

interface DronePhysicsBodyProps {
  rapier?: DroneRapierComponents;
  bodyRef: MutableRefObject<DroneRigidBodyRef>;
  massKg: number;
  flightSpawnLiftY: number;
  colliderDensity: number;
  colliderHalfExtents: [number, number, number];
  colliderPosition: [number, number, number];
  onCollisionEnter: (payload: unknown) => void;
  onCollisionExit: () => void;
  onContactForce: (payload: unknown) => void;
  children: ReactNode;
}

export function DronePhysicsBody({
  rapier,
  bodyRef,
  massKg,
  flightSpawnLiftY,
  colliderDensity,
  colliderHalfExtents,
  colliderPosition,
  onCollisionEnter,
  onCollisionExit,
  onContactForce,
  children,
}: DronePhysicsBodyProps) {
  const RigidBody = rapier?.RigidBody;
  const CuboidCollider = rapier?.CuboidCollider;

  if (!RigidBody || !CuboidCollider) {
    return <group position={[0, flightSpawnLiftY, 0]}>{children}</group>;
  }

  return (
    <RigidBody
      type="dynamic"
      colliders={false}
      ref={bodyRef}
      canSleep={true}
      mass={massKg}
      friction={1.1}
      restitution={0.05}
      linearDamping={0.01}
      angularDamping={0.01}
      gravityScale={1}
      position={[0, flightSpawnLiftY, 0]}
      onCollisionEnter={onCollisionEnter}
      onCollisionExit={onCollisionExit}
      onContactForce={onContactForce}
    >
      <CuboidCollider
        density={colliderDensity}
        args={colliderHalfExtents}
        position={colliderPosition}
        friction={1.1}
        restitution={0.05}
      />
      {children}
    </RigidBody>
  );
}
