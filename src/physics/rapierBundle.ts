import type {
  CuboidColliderProps,
  PhysicsProps,
  RapierRigidBody,
  RigidBodyProps,
} from "@react-three/rapier";
import type { ComponentType } from "react";

export type RapierBundle = {
  Physics: ComponentType<PhysicsProps>;
  RigidBody: ComponentType<RigidBodyProps>;
  CuboidCollider: ComponentType<CuboidColliderProps>;
};

export type DroneRapierComponents = Pick<RapierBundle, "RigidBody" | "CuboidCollider">;

export type DroneRigidBodyRef = RapierRigidBody | null;
