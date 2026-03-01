import React, { useDeferredValue, useMemo, useRef } from "react";
import * as THREE from "three";
import { Evaluator, Brush, ADDITION, SUBTRACTION } from "three-bvh-csg";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { DroneParams } from "../types";

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
  groupRef: React.RefObject<THREE.Group | null>;
  waypoints?: THREE.Vector3[];
  isFlyingPath?: boolean;
  onFlightComplete?: () => void;
}

export function DroneModel({
  params,
  groupRef,
  waypoints = [],
  isFlyingPath = false,
  onFlightComplete,
}: DroneModelProps) {
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

  // Layout Logic based on viewMode
  let bottomPos: [number, number, number] = [0, 0, 0];
  let topPos: [number, number, number] = [
    0,
    plateThickness + standoffHeight,
    0,
  ];
  let standoffY = plateThickness + standoffHeight / 2;
  let showStandoffs = true;

  if (viewMode === "exploded") {
    topPos = [0, plateThickness + standoffHeight + 30, 0];
    standoffY = plateThickness + standoffHeight / 2 + 15;
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

  const velocity = useRef(new THREE.Vector3());
  const pathProgress = useRef(0);
  const curveRef = useRef<THREE.CatmullRomCurve3 | null>(null);

  React.useEffect(() => {
    if (waypoints.length >= 2) {
      const points = waypoints.map(
        (p) => new THREE.Vector3(p.x, Math.max(p.y + 20, 20), p.z),
      );
      curveRef.current = new THREE.CatmullRomCurve3(points);
    } else {
      curveRef.current = null;
    }
    if (!isFlyingPath) {
      pathProgress.current = 0;
      velocity.current.set(0, 0, 0);
    }
  }, [waypoints, isFlyingPath]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === " ") keys.current.space = true;
      else if (key === "shift") keys.current.shift = true;
      else if (keys.current.hasOwnProperty(key))
        (keys.current as any)[key] = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === " ") keys.current.space = false;
      else if (key === "shift") keys.current.shift = false;
      else if (keys.current.hasOwnProperty(key))
        (keys.current as any)[key] = false;
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    const drone = groupRef.current;

    if (viewMode === "flight_sim") {
      if (isFlyingPath && curveRef.current) {
        const deltaT = Math.min(delta, 0.1);
        pathProgress.current += deltaT * 0.15;
        const targetT = Math.min(pathProgress.current + 0.05, 1);

        if (pathProgress.current >= 1) {
          if (onFlightComplete) onFlightComplete();
          return;
        }

        const targetPos = curveRef.current.getPointAt(targetT);
        const currentPos = drone.position.clone();

        const dir = targetPos.clone().sub(currentPos);
        const dist = dir.length();
        if (dist > 0) dir.normalize();

        const maxSpeed = 200;
        const desiredVelocity = dir.multiplyScalar(
          Math.min(maxSpeed, dist * 10),
        );

        const steer = desiredVelocity.clone().sub(velocity.current);
        const maxForce = 400;
        if (steer.length() > maxForce) steer.setLength(maxForce);

        const dragCoeff = 0.03;
        const drag = velocity.current
          .clone()
          .multiplyScalar(-dragCoeff * velocity.current.length());

        const acceleration = steer.add(drag);
        velocity.current.add(acceleration.multiplyScalar(deltaT));
        drone.position.add(velocity.current.clone().multiplyScalar(deltaT));

        if (velocity.current.lengthSq() > 1) {
          const targetYaw = Math.atan2(velocity.current.x, velocity.current.z);
          let diff = targetYaw - drone.rotation.y;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          drone.rotation.y += diff * deltaT * 5;
        }

        const localAccel = acceleration
          .clone()
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), -drone.rotation.y);
        const targetPitch = Math.max(
          -Math.PI / 3,
          Math.min(Math.PI / 3, localAccel.z * 0.005),
        );
        const targetRoll = Math.max(
          -Math.PI / 3,
          Math.min(Math.PI / 3, -localAccel.x * 0.005),
        );

        drone.rotation.x = THREE.MathUtils.lerp(
          drone.rotation.x,
          targetPitch,
          deltaT * 8,
        );
        drone.rotation.z = THREE.MathUtils.lerp(
          drone.rotation.z,
          targetRoll,
          deltaT * 8,
        );
      } else {
        const speed = 150 * delta;
        const rotSpeed = 2.5 * delta;

        // Kinematics
        if (keys.current.w) drone.translateZ(-speed);
        if (keys.current.s) drone.translateZ(speed);
        if (keys.current.a) drone.translateX(-speed);
        if (keys.current.d) drone.translateX(speed);
        if (keys.current.space) drone.translateY(speed);
        if (keys.current.shift) drone.translateY(-speed);
        if (keys.current.q) drone.rotateY(rotSpeed);
        if (keys.current.e) drone.rotateY(-rotSpeed);

        // Tilt based on movement
        const targetPitch =
          (keys.current.w ? -0.4 : 0) + (keys.current.s ? 0.4 : 0);
        const targetRoll =
          (keys.current.a ? 0.4 : 0) + (keys.current.d ? -0.4 : 0);

        drone.rotation.x = THREE.MathUtils.lerp(
          drone.rotation.x,
          targetPitch,
          0.1,
        );
        drone.rotation.z = THREE.MathUtils.lerp(
          drone.rotation.z,
          targetRoll,
          0.1,
        );

        // Floor collision
        if (drone.position.y < 0) drone.position.y = 0;
      }
    } else {
      // Reset position and rotation when not in flight sim
      drone.position.lerp(new THREE.Vector3(0, 0, 0), 0.1);
      drone.rotation.x = THREE.MathUtils.lerp(drone.rotation.x, 0, 0.1);
      drone.rotation.y = THREE.MathUtils.lerp(drone.rotation.y, 0, 0.1);
      drone.rotation.z = THREE.MathUtils.lerp(drone.rotation.z, 0, 0.1);
    }
  });

  return (
    <group ref={groupRef}>
      {/* Bottom Plate */}
      <mesh
        geometry={bottomPlateGeo}
        position={bottomPos}
        castShadow
        receiveShadow
        material={carbonMaterial}
      />
      {viewMode === "exploded" && (
        <Annotation
          title="Unibody Bottom Plate"
          description={`${plateThickness}mm Toray T700 Carbon Fiber`}
          position={[frameSize / 2 + 10, bottomPos[1], 0]}
        />
      )}

      {/* Top Plate */}
      <mesh
        geometry={topPlateGeo}
        position={topPos}
        castShadow
        receiveShadow
        material={carbonMaterial}
      />
      {viewMode === "exploded" && (
        <Annotation
          title="Top Plate"
          description={`${topPlateThickness}mm Carbon Fiber`}
          position={[fcMounting / 2 + 15, topPos[1], 0]}
        />
      )}

      {/* Standoffs */}
      {showStandoffs &&
        standoffsData.map((pos, i) => (
          <mesh
            key={i}
            position={[pos[0], standoffY, pos[2]]}
            castShadow
            receiveShadow
            material={aluminumMaterial}
          >
            <cylinderGeometry args={[2.5, 2.5, standoffHeight, 16]} />
          </mesh>
        ))}
      {viewMode === "exploded" && showStandoffs && (
        <Annotation
          title="Knurled Standoffs"
          description={`M3 x ${standoffHeight}mm 7075 Aluminum`}
          position={[standoffsData[0][0] + 10, standoffY, standoffsData[0][2]]}
        />
      )}

      {/* Rigorous Clearance & Payload Visualization (Visible in all modes) */}
      <group>
        {/* Motors & Propellers */}
        {motorPositions.map((pos, i) => {
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

          return (
            <group
              key={`motor-prop-${i}`}
              position={[pos[0] + bottomPos[0], bottomPos[1], pos[2] + bottomPos[2]]}
            >
                {/* Motor Stator/Base */}
                <mesh position={[0, motorHeight * 0.2, 0]}>
                  <cylinderGeometry
                    args={[motorRadius, motorRadius, motorHeight * 0.4, 32]}
                  />
                  <meshStandardMaterial color="#333" roughness={0.8} />
                </mesh>
                {/* Motor Bell */}
                <mesh position={[0, motorHeight * 0.75, 0]}>
                  <cylinderGeometry
                    args={[
                      motorRadius * 0.95,
                      motorRadius * 0.95,
                      motorHeight * 0.5,
                      32,
                    ]}
                  />
                  <meshStandardMaterial
                    color="#111"
                    metalness={0.8}
                    roughness={0.2}
                  />
                </mesh>
                {/* Motor Shaft */}
                <mesh position={[0, motorHeight + 3, 0]}>
                  <cylinderGeometry args={[2.5, 2.5, 6, 16]} />
                  <meshStandardMaterial
                    color="#ccc"
                    metalness={1}
                    roughness={0}
                  />
                </mesh>

                {/* Propeller */}
                <group position={[0, motorHeight + 3, 0]}>
                  {/* Hub */}
                  <mesh>
                    <cylinderGeometry args={[6.5, 6.5, 7, 32]} />
                    <meshStandardMaterial
                      color={isCW ? "#0ea5e9" : "#f43f5e"}
                    />
                  </mesh>
                  {/* Blades */}
                  {[0, 1, 2].map((b) => (
                    <mesh key={b} rotation={[0, (b * Math.PI * 2) / 3, 0]}>
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
                    </mesh>
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
            );
          })}

          {/* FC Stack (Rigorous) */}
          <group position={[bottomPos[0], bottomPos[1] + plateThickness, bottomPos[2]]}>
            {/* ESC */}
            <mesh position={[0, 4, 0]}>
              <boxGeometry args={[fcMounting + 6, 4, fcMounting + 8]} />
              <meshStandardMaterial color="#171717" />
            </mesh>
            {/* ESC Capacitor */}
            <mesh
              position={[0, 4, fcMounting / 2 + 6]}
              rotation={[0, 0, Math.PI / 2]}
            >
              <cylinderGeometry args={[4, 4, 12, 16]} />
              <meshStandardMaterial color="#0f172a" />
            </mesh>

            {/* FC */}
            <mesh position={[0, 12, 0]}>
              <boxGeometry args={[fcMounting + 4, 2, fcMounting + 4]} />
              <meshStandardMaterial color="#171717" />
            </mesh>
            {/* USB Port */}
            <mesh position={[fcMounting / 2 + 2, 12, 0]}>
              <boxGeometry args={[3, 3, 8]} />
              <meshStandardMaterial color="#cbd5e1" metalness={0.8} />
            </mesh>
            <Annotation
              title="Flight Controller Stack"
              description={`${fcMounting}x${fcMounting}mm ESC & FC`}
              position={[fcMounting / 2 + 10, 12, 0]}
            />
          </group>

          {/* FPV Camera (Micro 19x19) */}
          <group
            position={[
              bottomPos[0],
              bottomPos[1] + plateThickness + standoffHeight / 2,
              bottomPos[2] + fcMounting / 2 + 25,
            ]}
          >
            <mesh>
              <boxGeometry args={[19, 19, 19]} />
              <meshStandardMaterial color="#111" />
            </mesh>
            <mesh position={[0, 0, 10]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[7, 7, 8, 32]} />
              <meshStandardMaterial color="#000" />
            </mesh>
            {/* FOV Cone */}
            <mesh position={[0, 0, 30]} rotation={[-Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[40, 0.1, 40, 32]} />
              <meshStandardMaterial
                color="#eab308"
                transparent
                opacity={0.1}
                depthWrite={false}
              />
            </mesh>
            <Annotation
              title="FPV Camera"
              description="19x19mm Micro Size + FOV"
              position={[15, 0, 0]}
            />
          </group>

          {/* LiPo Battery */}
          <group
            position={[
              topPos[0],
              topPos[1] + topPlateThickness + 15,
              topPos[2],
            ]}
          >
            <mesh>
              <boxGeometry args={[35, 30, 75]} />
              <meshStandardMaterial color="#475569" />
            </mesh>
            <mesh position={[0, 0, 0]}>
              <boxGeometry args={[36, 31, 76]} />
              <meshStandardMaterial color="#000" wireframe />
            </mesh>
            {/* Battery XT60 Lead */}
            <mesh position={[0, 0, -40]}>
              <boxGeometry args={[15, 8, 10]} />
              <meshStandardMaterial color="#eab308" />
            </mesh>
            <Annotation
              title="LiPo Battery"
              description="6S 1300mAh Top Mount"
              position={[25, 0, 0]}
            />
          </group>
        </group>

      {/* 3D Printed TPU Accessories */}
      {showTPU && viewMode !== "print_layout" && (
        <group>
          {/* Action Camera Mount (GoPro) */}
          <group
            position={[
              topPos[0],
              topPos[1] + topPlateThickness / 2 + 2,
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
          <group position={[bottomPos[0], standoffY, bottomPos[2] - fcMounting / 2 - 8]}>
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
            {viewMode === "exploded" && (
              <Annotation
                title="Antenna Array"
                description="VTX + Diversity RX Tubes"
                position={[15, 0, 0]}
              />
            )}
          </group>

          {/* Arm Guards / Motor Bumpers */}
          {motorPositions.map((pos, i) => {
            const angle = i * (Math.PI / 2) + Math.PI / 4;
            const motorPadRadius = motorMountPattern / 2 + 3.5;
            return (
              <group
                key={`guard-${i}`}
                position={[pos[0] + bottomPos[0], bottomPos[1], pos[2] + bottomPos[2]]}
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
  );
}
