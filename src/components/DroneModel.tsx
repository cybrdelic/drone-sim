import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import React, { memo, useDeferredValue, useMemo, useRef } from "react";
import * as THREE from "three";
import { DronePhysicsBody } from "./DronePhysicsBody";
import { useMotorAudio } from "../hooks/useMotorAudio";
import type { DroneRapierComponents, DroneRigidBodyRef } from "../physics/rapierBundle";
import { applyWireframeToScene } from "../scene/wireframe";
import { defaultSimSettings } from "../sim/config";
import {
  applyDeadzone,
  clamp01,
  clamp11,
  createFlightKeyState,
  mapBetaflightRateDegPerSec,
  mapFlightKey,
  resetFlightKeyState,
  shapeCenteredCurve,
  shapeThrottleCurve,
} from "../sim/flight/control";
import { buildPropulsionModel } from "../sim/flight/propulsion";
import {
  createResetFlightTelemetry,
  createSimSettingsTelemetrySnapshot,
} from "../sim/flight/telemetry";
import { mulMat3Vec, solve4x4 } from "../sim/flightMath";
import {
  buildDroneGeometry,
  buildMotorTuple,
  computeClearanceData,
  createCsgEvaluator,
  motorIndices,
  type MotorTuple,
  type Point3,
} from "../sim/geometry/droneGeometry";
import { computeDroneMassProperties } from "../sim/geometry/droneMass";
import {
  buildMotorHealthScales,
  computeWindField,
  evaluateAtmosphere,
  magneticFieldWorldVector,
  pressureToAltitudeM,
} from "../sim/labModels";
import { DroneParams, FlightTelemetry, InspectTarget, SimSettings, ViewSettings } from "../types";

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

function InvalidPartOverlay({
  visible,
  position,
  size,
  rotation = [0, 0, 0],
}: {
  visible: boolean;
  position: [number, number, number];
  size: [number, number, number];
  rotation?: [number, number, number];
}) {
  if (!visible) return null;

  return (
    <mesh position={position} rotation={rotation} renderOrder={50}>
      <boxGeometry args={size} />
      <meshBasicMaterial
        color="#ef4444"
        transparent
        opacity={0.2}
        depthWrite={false}
        depthTest={false}
      />
    </mesh>
  );
}

interface DroneModelProps {
  params: DroneParams;
  viewSettings?: ViewSettings;
  simSettings?: SimSettings;
  invalidTargets?: InspectTarget[];
  groupRef: React.RefObject<THREE.Group | null>;
  flightTelemetryRef?: React.MutableRefObject<FlightTelemetry>;
  resetToken?: number;
  rapier?: DroneRapierComponents;
  waypoints?: THREE.Vector3[];
  isFlyingPath?: boolean;
  onFlightComplete?: () => void;
  controlSensitivity?: number;
  onRuntimeIssue?: (
    kind: "controller" | "physics",
    message: string | null,
  ) => void;
}

type RapierVectorLike = { x: number; y: number; z: number };
type CollisionPayloadLike = {
  flipped?: boolean;
  manifold?: {
    numSolverContacts?: () => number;
    solverContactPoint?: (index: number) => RapierVectorLike;
    normal?: () => RapierVectorLike;
  };
};
type ContactForcePayloadLike = {
  totalForce?: RapierVectorLike;
  totalForceMagnitude?: number;
  maxForceDirection?: RapierVectorLike;
  maxForceMagnitude?: number;
};

export const DroneModel = memo(function DroneModel({
  params,
  viewSettings,
  simSettings,
  invalidTargets = [],
  groupRef,
  flightTelemetryRef,
  resetToken = 0,
  rapier,
  waypoints = [],
  isFlyingPath = false,
  onFlightComplete,
  controlSensitivity = 0.45,
  onRuntimeIssue,
}: DroneModelProps) {
  const effectiveViewSettings: ViewSettings =
    viewSettings ??
    ({
      wireframe: false,
      focus: "all",
      inspectTarget: "all",
      keepContext: true,
      visibility: {
        frame: true,
        propulsion: true,
        electronics: true,
        accessories: true,
      },
    } as ViewSettings);

  const effectiveSimSettings: SimSettings = simSettings ?? defaultSimSettings;

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
  const motorAssemblyRefs = useRef<Array<THREE.Group | null>>([]);
  const propSpinRad = useRef<MotorTuple<number>>([0, 0, 0, 0]);
  const flightBodyRef = useRef<DroneRigidBodyRef>(null);
  const flightInitDone = useRef(false);

  const visualJitterRef = useRef<THREE.Group | null>(null);

  const controllerRuntimeIssueRef = useRef(false);
  const physicsRuntimeIssueRef = useRef(false);
  const { audioTelemetry, updateMotorAudio } = useMotorAudio(
    effectiveSimSettings,
    viewMode,
  );

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

  const evaluator = useMemo(() => createCsgEvaluator(), []);

  const { bottomPlateGeo, topPlateGeo, standoffsData, motorPositions } =
    useMemo(
      () =>
        buildDroneGeometry(
          {
            armWidth,
            fcMounting,
            frameSize,
            motorCenterHole,
            motorMountPattern,
            plateThickness,
            topPlateThickness,
            weightReduction,
          },
          evaluator,
        ),
      [
        armWidth,
        evaluator,
        fcMounting,
        frameSize,
        motorCenterHole,
        motorMountPattern,
        plateThickness,
        topPlateThickness,
        weightReduction,
      ],
    );

  const clearanceData = useMemo(
    () =>
      computeClearanceData({
        armWidth,
        fcMounting,
        motorPositions,
        plateThickness,
        propSize,
        simSettings: effectiveSimSettings,
        standoffHeight,
        viewMode,
      }),
    [
      armWidth,
      effectiveSimSettings,
      fcMounting,
      motorPositions,
      plateThickness,
      propSize,
      standoffHeight,
      viewMode,
    ],
  );

  const bottomPlateTopY = plateThickness;
  const bottomPlateMinY = 0;
  const topPlateTopY = topPlateThickness;
  const motorPadRadius = motorMountPattern / 2 + 3.5;
  const bottomPlateSpan = Math.SQRT1_2 * frameSize + motorPadRadius * 2 + 12;
  const topPlateWidth = fcMounting + 12;
  const carbonSheetSize = Math.max(
    300,
    Math.ceil(bottomPlateSpan + topPlateWidth + 72),
  );
  const tpuBedSize = 220;
  const layoutZoneGap = 88;
  const carbonSheetCenterX = -(tpuBedSize + layoutZoneGap) / 2;
  const tpuBedCenterX = carbonSheetSize / 2 + layoutZoneGap / 2;
  const carbonBottomX =
    carbonSheetCenterX - carbonSheetSize / 2 + bottomPlateSpan / 2 + 18;
  const carbonTopX =
    carbonSheetCenterX + carbonSheetSize / 2 - topPlateWidth / 2 - 18;
  const printSurfaceY = -0.35;
  const printGuideLineThickness = 1.2;
  const printGuideLineHeight = 0.6;
  const isPrintLayout = viewMode === "print_layout";

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

  // For fast startup, keep non-flight modes non-physical.
  // Flight sim is the only mode that needs Rapier + rigid-body integration.
  const physicsEnabled = viewMode === "flight_sim";

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
    bottomPos = [carbonBottomX, 0, 0];
    topPos = [carbonTopX, 0, 0];
    showStandoffs = false;
  }

  const keys = useRef(createFlightKeyState());

  const setKeyState = (keyName: keyof typeof keys.current, next: boolean) => {
    keys.current[keyName] = next;
  };

  const resetKeyState = () => {
    resetFlightKeyState(keys.current);
  };

  const blurActiveFlightControl = () => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement !== document.body) {
      activeElement.blur();
    }
  };

  React.useEffect(() => {
    if (!groupRef.current) return;
    applyWireframeToScene(groupRef.current, effectiveViewSettings.wireframe);
  }, [groupRef, effectiveViewSettings.wireframe]);

  const massProps = useMemo(
    () =>
      computeDroneMassProperties({
        armWidth,
        fcMounting,
        frameSize,
        motorCenterHole,
        motorMountPattern,
        motorPositions,
        plateThickness,
        simSettings: effectiveSimSettings,
        standoffHeight,
        topPlateThickness,
        weightReduction,
      }),
    [
      armWidth,
      effectiveSimSettings,
      fcMounting,
      frameSize,
      motorCenterHole,
      motorMountPattern,
      motorPositions,
      plateThickness,
      standoffHeight,
      topPlateThickness,
      weightReduction,
    ],
  );

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

  const propulsion = useMemo(() => buildPropulsionModel(propSize, effectiveSimSettings), [
    effectiveSimSettings.buildBatteryCells,
    effectiveSimSettings.buildMotorKV,
    effectiveSimSettings.buildPackResistanceMilliOhm,
    effectiveSimSettings.buildPropPitchIn,
    effectiveSimSettings.rotorInertiaScale,
    propSize,
  ]);

  const motorHealthScales = useMemo(
    () => buildMotorHealthScales(effectiveSimSettings.actuatorMismatchPct),
    [effectiveSimSettings.actuatorMismatchPct],
  );
  const actuatorSpreadPct = useMemo(() => {
    const maxScale = Math.max(...motorHealthScales);
    const minScale = Math.min(...motorHealthScales);
    return (maxScale - minScale) * 100;
  }, [motorHealthScales]);

  const flightState = useRef({
    posM: new THREE.Vector3(0, 0, 0),
    velM: new THREE.Vector3(0, 0, 0),
    quat: new THREE.Quaternion(),
    omegaBody: new THREE.Vector3(0, 0, 0),
    armed: false as boolean,
    motorOmegaRad: [0, 0, 0, 0] as MotorTuple<number>,
    motorTiltRad: [0, 0, 0, 0] as MotorTuple<number>,
    motorPhaseRad: [0, 0, 0, 0] as MotorTuple<number>,
    motorWash01: [0, 0, 0, 0] as MotorTuple<number>,
    motorReload01: [0, 0, 0, 0] as MotorTuple<number>,
    armDamage01: [0, 0, 0, 0] as MotorTuple<number>,
    motorDamage01: [0, 0, 0, 0] as MotorTuple<number>,
    batteryDamage01: 0 as number,
    escCommand01: [0, 0, 0, 0] as MotorTuple<number>,
    motorTempC: [20, 20, 20, 20] as MotorTuple<number>,
    motorCurrentA: [0, 0, 0, 0] as MotorTuple<number>,
    currentLimitScale01: [1, 1, 1, 1] as MotorTuple<number>,
    thermalLimitScale01: [1, 1, 1, 1] as MotorTuple<number>,
    batteryV: 0 as number,
    batteryI: 0 as number,
    throttle01: 0 as number,
    manualThrottle01: 0 as number,
    armLatchReady: false as boolean,
    targetWpIndex: 1 as number,
    rng: 123456789 as number,
    // Wind model state
    windPhase: null as number[] | null,
    windTime: 0 as number,
    gpsTimer: 0 as number,
    baroTimer: 0 as number,
    rangefinderTimer: 0 as number,
    magnetometerTimer: 0 as number,
    imuTimer: 0 as number,
    gpsSampleAgeSec: Number.POSITIVE_INFINITY,
    baroSampleAgeSec: Number.POSITIVE_INFINITY,
    rangefinderSampleAgeSec: Number.POSITIVE_INFINITY,
    magnetometerSampleAgeSec: Number.POSITIVE_INFINITY,
    gyroSampleAgeSec: Number.POSITIVE_INFINITY,
    accelSampleAgeSec: Number.POSITIVE_INFINITY,
    gpsAltitudeM: 0 as number,
    gpsSpeedMS: 0 as number,
    gpsSamplePosM: new THREE.Vector3(),
    baroAltitudeM: 0 as number,
    rangefinderM: 0 as number,
    headingDeg: 0 as number,
    gyroDps: 0 as number,
    accelMS2: 0 as number,
  });
  const impactDebugRef = useRef({
    pointMm: null as Point3 | null,
    normalWorld: null as Point3 | null,
    forceWorldN: null as Point3 | null,
    forceN: 0,
    ageSec: Number.POSITIVE_INFINITY,
    contactCount: 0,
  });

  const prevViewModeRef = useRef(viewMode);

  const resetFlightState = React.useCallback(() => {
    flightInitDone.current = false;
    flightState.current.posM.set(0, 0, 0);
    flightState.current.velM.set(0, 0, 0);
    flightState.current.omegaBody.set(0, 0, 0);
    flightState.current.quat.identity();
    flightState.current.armed = false;
    flightState.current.motorOmegaRad = [0, 0, 0, 0];
    flightState.current.motorTiltRad = [0, 0, 0, 0];
    flightState.current.motorPhaseRad = [0, 0, 0, 0];
    flightState.current.motorWash01 = [0, 0, 0, 0];
    flightState.current.motorReload01 = [0, 0, 0, 0];
    flightState.current.armDamage01 = [0, 0, 0, 0];
    flightState.current.motorDamage01 = [0, 0, 0, 0];
    flightState.current.batteryDamage01 = 0;
    flightState.current.escCommand01 = [0, 0, 0, 0];
    flightState.current.motorTempC = [
      effectiveSimSettings.ambientTempC,
      effectiveSimSettings.ambientTempC,
      effectiveSimSettings.ambientTempC,
      effectiveSimSettings.ambientTempC,
    ];
    flightState.current.motorCurrentA = [0, 0, 0, 0];
    flightState.current.currentLimitScale01 = [1, 1, 1, 1];
    flightState.current.thermalLimitScale01 = [1, 1, 1, 1];
    flightState.current.batteryV = propulsion.batteryCells * propulsion.vOpenPerCell;
    flightState.current.batteryI = 0;
    flightState.current.throttle01 = 0;
    flightState.current.manualThrottle01 = 0;
    flightState.current.armLatchReady = false;
    flightState.current.targetWpIndex = 1;
    flightState.current.rng = 123456789;
    flightState.current.windPhase = null;
    flightState.current.windTime = 0;
    flightState.current.gpsTimer = 0;
    flightState.current.baroTimer = 0;
    flightState.current.rangefinderTimer = 0;
    flightState.current.magnetometerTimer = 0;
    flightState.current.imuTimer = 0;
    flightState.current.gpsSampleAgeSec = Number.POSITIVE_INFINITY;
    flightState.current.baroSampleAgeSec = Number.POSITIVE_INFINITY;
    flightState.current.rangefinderSampleAgeSec = Number.POSITIVE_INFINITY;
    flightState.current.magnetometerSampleAgeSec = Number.POSITIVE_INFINITY;
    flightState.current.gyroSampleAgeSec = Number.POSITIVE_INFINITY;
    flightState.current.accelSampleAgeSec = Number.POSITIVE_INFINITY;
    flightState.current.gpsAltitudeM = 0;
    flightState.current.gpsSpeedMS = 0;
    flightState.current.gpsSamplePosM.set(0, 0, 0);
    flightState.current.baroAltitudeM = 0;
    flightState.current.rangefinderM = 0;
    flightState.current.headingDeg = 0;
    flightState.current.gyroDps = 0;
    flightState.current.accelMS2 = 0;
    impactDebugRef.current.pointMm = null;
    impactDebugRef.current.normalWorld = null;
    impactDebugRef.current.forceWorldN = null;
    impactDebugRef.current.forceN = 0;
    impactDebugRef.current.ageSec = Number.POSITIVE_INFINITY;
    impactDebugRef.current.contactCount = 0;

    if (flightTelemetryRef) {
      flightTelemetryRef.current = createResetFlightTelemetry({
        actuatorSpreadPct,
        simSettings: effectiveSimSettings,
        totalMassG: massProps.massKg * 1000,
      });
    }
  }, [
    actuatorSpreadPct,
    effectiveSimSettings.ambientTempC,
    effectiveSimSettings,
    flightTelemetryRef,
    massProps.massKg,
    propulsion.batteryCells,
    propulsion.vOpenPerCell,
  ]);

  React.useEffect(() => {
    const prev = prevViewModeRef.current;
    prevViewModeRef.current = viewMode;

    // Reset flight state when ENTERING flight sim.
    // This guarantees a consistent start: on the ground, not moving, motors disarmed.
    if (prev !== "flight_sim" && viewMode === "flight_sim") {
      resetFlightState();
    }

    // Reset flight state when leaving flight sim or when a new flight starts.
    if (viewMode !== "flight_sim") {
      resetFlightState();
    }
    if (!isFlyingPath) {
      flightState.current.targetWpIndex = 1;
    }
  }, [viewMode, isFlyingPath, resetFlightState]);

  React.useEffect(() => {
    if (viewMode === "flight_sim") {
      resetFlightState();
    }
  }, [resetToken, resetFlightState, viewMode]);

  const captureImpactFromCollision = React.useCallback((payload: unknown) => {
    const collision = payload as CollisionPayloadLike | null;
    const manifold = collision?.manifold;
    const debug = impactDebugRef.current;
    const contactPoint =
      typeof manifold?.numSolverContacts === "function" &&
      manifold.numSolverContacts() > 0 &&
      typeof manifold.solverContactPoint === "function"
      ? manifold.solverContactPoint(0)
      : null;
    const normal = typeof manifold?.normal === "function" ? manifold.normal() : null;

    if (contactPoint) {
      debug.pointMm = [contactPoint.x, contactPoint.y, contactPoint.z];
    }
    if (normal) {
      const normalVector = new THREE.Vector3(normal.x, normal.y, normal.z);
      if (collision?.flipped) normalVector.multiplyScalar(-1);
      debug.normalWorld = [normalVector.x, normalVector.y, normalVector.z];
    }
    debug.ageSec = 0;
    debug.contactCount = typeof manifold?.numSolverContacts === "function"
      ? manifold.numSolverContacts()
      : Math.max(1, debug.contactCount);
  }, []);

  const captureImpactForce = React.useCallback((payload: unknown) => {
    const debug = impactDebugRef.current;
    const state = flightState.current;
    const contactForce = payload as ContactForcePayloadLike | null;
    const totalForce = contactForce?.totalForce;
    const forceVector = totalForce && typeof totalForce.x === "number"
      ? new THREE.Vector3(totalForce.x, totalForce.y, totalForce.z)
      : null;
    const maxForceDirection = contactForce?.maxForceDirection;
    const directionVector = maxForceDirection && typeof maxForceDirection.x === "number"
      ? new THREE.Vector3(maxForceDirection.x, maxForceDirection.y, maxForceDirection.z)
      : null;
    const magnitudeFromPayload = typeof contactForce?.totalForceMagnitude === "number"
      ? contactForce.totalForceMagnitude
      : typeof contactForce?.maxForceMagnitude === "number"
        ? contactForce.maxForceMagnitude
        : 0;

    if (forceVector) {
      debug.forceWorldN = [forceVector.x, forceVector.y, forceVector.z];
      debug.forceN = forceVector.length();
    } else if (directionVector && magnitudeFromPayload > 0) {
      directionVector.normalize().multiplyScalar(magnitudeFromPayload);
      debug.forceWorldN = [directionVector.x, directionVector.y, directionVector.z];
      debug.forceN = magnitudeFromPayload;
    } else {
      debug.forceWorldN = null;
      debug.forceN = magnitudeFromPayload;
    }

    if (!debug.normalWorld && directionVector) {
      const normalizedDirection = directionVector.clone().normalize();
      debug.normalWorld = [normalizedDirection.x, normalizedDirection.y, normalizedDirection.z];
    }

    if (!debug.pointMm) {
      const translation = flightBodyRef.current?.translation?.();
      if (translation) {
        debug.pointMm = [
          translation.x,
          translation.y - assemblyHalfExtents[1],
          translation.z,
        ];
      }
    }

    debug.ageSec = 0;
    debug.contactCount = Math.max(1, debug.contactCount);

    if (debug.forceN <= 0) return;
    if (!state.armed) return;

    const linearSpeedMS = state.velM.length();
    const angularSpeedRadS = state.omegaBody.length();
    const contactNormal = debug.normalWorld
      ? new THREE.Vector3(
          debug.normalWorld[0],
          debug.normalWorld[1],
          debug.normalWorld[2],
        ).normalize()
      : null;
    const isSupportContact = !!contactNormal && contactNormal.y > 0.72;
    const impactMotionSignal = Math.max(
      linearSpeedMS,
      angularSpeedRadS * Math.max(0.08, params.frameSize * 0.0005),
    );

    if (isSupportContact && impactMotionSignal < 0.85) {
      return;
    }

    const contactPointMm = debug.pointMm
      ? new THREE.Vector3(debug.pointMm[0], debug.pointMm[1], debug.pointMm[2])
      : new THREE.Vector3(0, 0, 0);
    const localPointMm = contactPointMm
      .clone()
      .multiplyScalar(1e-3)
      .sub(state.posM)
      .applyQuaternion(state.quat.clone().invert())
      .multiplyScalar(1000);
    const localMotors = buildMotorTuple(
      (index) => new THREE.Vector3(...motorPositions[index]),
    );
    let nearestMotorIndex = 0;
    let nearestMotorDistance = Number.POSITIVE_INFINITY;
    for (const i of motorIndices) {
      const distance = localMotors[i].distanceTo(localPointMm);
      if (distance < nearestMotorDistance) {
        nearestMotorDistance = distance;
        nearestMotorIndex = i;
      }
    }

    const batteryLocalMm = new THREE.Vector3(
      0,
      plateThickness + standoffHeight + topPlateThickness + 15,
      0,
    );
    const batteryDistance = batteryLocalMm.distanceTo(localPointMm);
    const fragility = Math.max(0.2, effectiveSimSettings.impactFragilityScale);
    const armImpact = Math.max(0, debug.forceN / Math.max(1, effectiveSimSettings.armFractureForceN) - 0.35);
    const motorImpact = Math.max(0, debug.forceN / Math.max(1, effectiveSimSettings.motorDamageForceN) - 0.25);
    const batteryImpact = Math.max(0, debug.forceN / Math.max(1, effectiveSimSettings.batteryDamageForceN) - 0.35);
    const nearMotorWeight = THREE.MathUtils.clamp(1 - nearestMotorDistance / 80, 0.15, 1);
    const batteryWeight = THREE.MathUtils.clamp(1 - batteryDistance / 90, 0.2, 1);

    state.armDamage01[nearestMotorIndex] = THREE.MathUtils.clamp(
      (state.armDamage01[nearestMotorIndex] ?? 0) + Math.pow(armImpact, 1.15) * 0.18 * fragility * nearMotorWeight,
      0,
      1,
    );
    state.motorDamage01[nearestMotorIndex] = THREE.MathUtils.clamp(
      (state.motorDamage01[nearestMotorIndex] ?? 0) + Math.pow(motorImpact, 1.12) * 0.16 * fragility * nearMotorWeight,
      0,
      1,
    );
    state.batteryDamage01 = THREE.MathUtils.clamp(
      state.batteryDamage01 + Math.pow(batteryImpact, 1.08) * 0.12 * fragility * batteryWeight,
      0,
      1,
    );
  }, [
    assemblyHalfExtents,
    effectiveSimSettings.armFractureForceN,
    effectiveSimSettings.batteryDamageForceN,
    effectiveSimSettings.impactFragilityScale,
    effectiveSimSettings.motorDamageForceN,
    motorPositions,
    plateThickness,
    standoffHeight,
    topPlateThickness,
  ]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (viewMode !== "flight_sim") return;

      const mappedKey = mapFlightKey(e);
      if (!mappedKey) return;

      e.preventDefault();
      blurActiveFlightControl();
      setKeyState(mappedKey, true);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (viewMode !== "flight_sim") return;

      const mappedKey = mapFlightKey(e);
      if (!mappedKey) return;

      e.preventDefault();
      setKeyState(mappedKey, false);
    };

    const handleWindowBlur = () => {
      resetKeyState();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", handleWindowBlur);
      resetKeyState();
    };
  }, [viewMode]);

  const flightTelemetryTickRef = useRef({ t: 0 });

  useFrame((_state, delta) => {
    if (!groupRef.current) return;

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
          if (physicsRuntimeIssueRef.current) {
            physicsRuntimeIssueRef.current = false;
            onRuntimeIssue?.("physics", null);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!physicsRuntimeIssueRef.current) {
            console.error("Flight physics failed to initialize.", error);
          }
          physicsRuntimeIssueRef.current = true;
          onRuntimeIssue?.(
            "physics",
            `Flight physics failed to initialize. Reset the sim or reload the view. ${message}`,
          );
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

      const D = propulsion.diameterM;
      const Ct0 = propulsion.Ct0;
      const Cq0 = propulsion.Cq0;

      const colliderLocalY = assemblyColliderCenterY - massProps.comMm.y; // mm
      const bottomAGLM =
        s.posM.y + (colliderLocalY - assemblyHalfExtents[1]) * 1e-3;
      const atmosphere = evaluateAtmosphere(
        bottomAGLM,
        effectiveSimSettings.ambientTempC,
        effectiveSimSettings.humidityPct,
      );
      const rho = atmosphere.densityKgM3;

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
      for (const i of motorIndices) {
        // Static motor tilt/misalignment
        const deg = propulsion.staticMisalignDeg;
        const tiltX = THREE.MathUtils.degToRad(((i < 2 ? -1 : 1) * deg) * 0.35);
        const tiltZ = THREE.MathUtils.degToRad(((i % 2 === 0 ? -1 : 1) * deg) * 0.45);
        const staticQuat = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(tiltX, 0, tiltZ),
        );

        // Flex tilt around axis derived from arm direction
        const motorPosition = motorPositions[i];
        const r = new THREE.Vector3(
          (motorPosition[0] - comMm.x) * mmToM,
          0,
          (motorPosition[2] - comMm.z) * mmToM,
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
      const yawSign: MotorTuple<number> = [1, -1, 1, -1];

      // --- Control inputs (manual or waypoint autopilot) ---
      let throttleCmd01: number;
      let desiredRateBody = new THREE.Vector3(0, 0, 0); // x=pitch, y=yaw, z=roll
      const acroRateDegPerSec = THREE.MathUtils.clamp(
        effectiveSimSettings.acroRateDegPerSec,
        360,
        1400,
      );
      const acroExpo = THREE.MathUtils.clamp(effectiveSimSettings.acroExpo, 0, 0.75);
      const airmodeStrength = THREE.MathUtils.clamp(
        effectiveSimSettings.airmodeStrength,
        0,
        1,
      );
      const propWashCoupling = THREE.MathUtils.clamp(
        effectiveSimSettings.propWashCoupling,
        0,
        1,
      );

      if (isFlyingPath && waypoints.length >= 2) {
        // Autopilot implies the motors are armed.
        s.armed = true;
        const idx = Math.min(
          Math.max(1, s.targetWpIndex),
          waypoints.length - 1,
        );
        const wp = waypoints[idx];
        if (!wp) {
          return;
        }
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
        // Gamepad (Nacon/XInput): use browser Gamepad API, fallback to keyboard.
        // Default mapping:
        // - Left stick Y: throttle (up = more)
        // - Left stick X: yaw
        // - Right stick Y: pitch (up = pitch forward)
        // - Right stick X: roll
        // This keeps keyboard behavior intact, and makes arming seamless (auto-arms on throttle).
        let gpThrottle = 0;
        let gpYaw = 0;
        let gpPitch = 0;
        let gpRoll = 0;
        try {
          const pads = typeof navigator !== "undefined" && navigator.getGamepads
            ? navigator.getGamepads()
            : [];
          const gp = Array.from(pads).find((p) => p && p.connected && (p.mapping === "standard" || typeof p.mapping === "string"));
          if (gp) {
            const dz = 0.12;
            const lsx = applyDeadzone(gp.axes?.[0] ?? 0, dz);
            const lsy = applyDeadzone(gp.axes?.[1] ?? 0, dz);
            const rsx = applyDeadzone(gp.axes?.[2] ?? 0, dz);
            const rsy = applyDeadzone(gp.axes?.[3] ?? 0, dz);

            gpYaw = clamp11(lsx);
            gpThrottle = clamp11(-lsy);
            gpRoll = clamp11(rsx);
            gpPitch = clamp11(-rsy);
          }
          if (controllerRuntimeIssueRef.current) {
            controllerRuntimeIssueRef.current = false;
            onRuntimeIssue?.("controller", null);
          }
        } catch (error) {
          if (!controllerRuntimeIssueRef.current) {
            console.warn("Gamepad polling failed; falling back to keyboard-only controls.", error);
          }
          controllerRuntimeIssueRef.current = true;
          onRuntimeIssue?.(
            "controller",
            "Gamepad polling failed, so controller input is unavailable until the browser recovers.",
          );
        }

        const kbThrottleDelta = (keys.current.space ? 1 : 0) - (keys.current.shift ? 1 : 0);
        const hasGamepadThrottle = Math.abs(gpThrottle) > 1e-3;
        const pitchCmd =
          clamp11(((keys.current.w ? 1 : 0) - (keys.current.s ? 1 : 0)) + gpPitch);
        const rollCmd =
          clamp11(((keys.current.d ? 1 : 0) - (keys.current.a ? 1 : 0)) + gpRoll);
        const yawCmd =
          clamp11(((keys.current.q ? 1 : 0) - (keys.current.e ? 1 : 0)) + gpYaw);

        const rateProfile = THREE.MathUtils.clamp((sens - 0.2) / 0.8, 0, 1);
        const shapeRateInput = (input: number, expo: number) => {
          const clamped = clamp11(input);
          return clamped * (1 - expo) + clamped * clamped * clamped * expo;
        };

        let throttleStick01 = 0;
        if (hasGamepadThrottle) {
          throttleStick01 = clamp01(Math.max(0, gpThrottle));
          s.manualThrottle01 = throttleStick01;
        } else {
          const keyboardThrottleTarget01 =
            kbThrottleDelta > 0 ? 1 : kbThrottleDelta < 0 ? 0 : 0;
          const keyboardTauSec = kbThrottleDelta === 0 ? 0.08 : 0.05;
          const keyboardBlend = 1 - Math.exp(-dt / keyboardTauSec);
          s.manualThrottle01 = THREE.MathUtils.lerp(
            s.manualThrottle01 ?? 0,
            keyboardThrottleTarget01,
            keyboardBlend,
          );
          throttleStick01 = s.manualThrottle01;
        }

        if (throttleStick01 < 0.02) {
          s.armLatchReady = true;
        }

        // Start on the ground with motors off until the user commands throttle-up.
        if (!s.armed) {
          if (s.armLatchReady && throttleStick01 > 0.05) s.armed = true;
          throttleCmd01 = 0;
          desiredRateBody.set(0, 0, 0);
        } else {
          throttleCmd01 = shapeThrottleCurve(
            throttleStick01,
            effectiveSimSettings.throttleMid01,
            effectiveSimSettings.throttleExpo,
          );

          let pitchRateDeg = 0;
          let yawRateDeg = 0;
          let rollRateDeg = 0;

          if (effectiveSimSettings.rateProfileMode === "betaflight") {
            pitchRateDeg = mapBetaflightRateDegPerSec(
              pitchCmd,
              effectiveSimSettings.betaflightRcRate,
              effectiveSimSettings.betaflightSuperRate,
              effectiveSimSettings.betaflightExpo,
            );
            rollRateDeg = mapBetaflightRateDegPerSec(
              rollCmd,
              effectiveSimSettings.betaflightRcRate,
              effectiveSimSettings.betaflightSuperRate,
              effectiveSimSettings.betaflightExpo,
            );
            yawRateDeg = mapBetaflightRateDegPerSec(
              yawCmd,
              effectiveSimSettings.betaflightYawRcRate,
              effectiveSimSettings.betaflightYawSuperRate,
              effectiveSimSettings.betaflightYawExpo,
            );
          } else {
            const pitchExpo = THREE.MathUtils.clamp(acroExpo + 0.02, 0, 0.8);
            const rollExpo = THREE.MathUtils.clamp(acroExpo + 0.02, 0, 0.8);
            const yawExpo = THREE.MathUtils.clamp(acroExpo * 0.55, 0, 0.6);
            const maxPitchRate = acroRateDegPerSec * THREE.MathUtils.lerp(0.92, 1.08, rateProfile);
            const maxRollRate = acroRateDegPerSec * THREE.MathUtils.lerp(0.96, 1.12, rateProfile);
            const maxYawRate = acroRateDegPerSec * THREE.MathUtils.lerp(0.56, 0.72, rateProfile);

            pitchRateDeg = shapeRateInput(pitchCmd, pitchExpo) * maxPitchRate;
            yawRateDeg = shapeRateInput(yawCmd, yawExpo) * maxYawRate;
            rollRateDeg = shapeRateInput(rollCmd, rollExpo) * maxRollRate;
          }

          desiredRateBody.set(
            THREE.MathUtils.degToRad(pitchRateDeg),
            THREE.MathUtils.degToRad(yawRateDeg),
            THREE.MathUtils.degToRad(rollRateDeg),
          );
        }
      }

      // Smooth throttle (motor spool)
      {
        if (!s.armed) {
          // Motors off on the ground until armed.
          s.throttle01 = 0;
          s.motorOmegaRad = [0, 0, 0, 0];
          s.escCommand01 = [0, 0, 0, 0];
        } else {
          const tau = isFlyingPath ? 0.07 : 0.035;
          const a = 1 - Math.exp(-dt / tau);
          s.throttle01 = THREE.MathUtils.lerp(s.throttle01, throttleCmd01, a);
        }
      }

      // Motor positions relative to COM (body), including deterministic tolerance offsets.
      const tolMm = 0.05;
      // comMm already defined above

      const rBody = buildMotorTuple((i) => {
        const p = motorPositions[i];
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

      const sensorNoiseScale = Math.max(0, effectiveSimSettings.sensorNoiseScale);
      const omegaMeas = s.omegaBody.clone();
      omegaMeas.x += randN(propulsion.imuRateNoiseStdRad * sensorNoiseScale);
      omegaMeas.y += randN(propulsion.imuRateNoiseStdRad * sensorNoiseScale);
      omegaMeas.z += randN(propulsion.imuRateNoiseStdRad * sensorNoiseScale);

      // Motor-frequency vibration injected into IMU rates (uses last-step motor omega/phase)
      {
        const up = new THREE.Vector3(0, 1, 0);
        for (const i of motorIndices) {
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
      const manualMode = !isFlyingPath;
      const kpRate = isFlyingPath ? 6.0 : 6.9;
      const rateErr = desiredRateBody.clone().sub(omegaMeas);
      const alphaCmd = rateErr.multiplyScalar(kpRate);

      const Iomega = mulMat3Vec(massProps.inertiaKgM2, s.omegaBody);
      const gyro = s.omegaBody.clone().cross(Iomega);
      const torqueCmdBodyNm = mulMat3Vec(massProps.inertiaKgM2, alphaCmd).add(gyro);

      // Desired total thrust (N)
      const idleThrottle01 = s.armed && manualMode ? 0.038 : 0;
      const effectiveThrottle01 = clamp01(idleThrottle01 + (1 - idleThrottle01) * clamp01(s.throttle01));
      const lowThrottleBlend = manualMode
        ? THREE.MathUtils.clamp(1 - effectiveThrottle01 / 0.38, 0, 1)
        : 0;
      const thrustCmdN = Math.min(
        totalMaxThrustN,
        effectiveThrottle01 ** 2 * totalMaxThrustN,
      );

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
      const fTargetN: MotorTuple<number> =
        mix ?? [thrustCmdN / 4, thrustCmdN / 4, thrustCmdN / 4, thrustCmdN / 4];

      for (const i of motorIndices) {
        fTargetN[i] = Math.max(0, Math.min(thrustMaxPerMotorN, fTargetN[i]));
      }

      const fracturedArmCount = s.armDamage01.reduce(
        (count, damage) => count + (damage >= 0.98 ? 1 : 0),
        0,
      );
      const meanArmDamage01 = s.armDamage01.reduce((sum, damage) => sum + damage, 0) / 4;
      const meanMotorDamage01 = s.motorDamage01.reduce((sum, damage) => sum + damage, 0) / 4;
      const structureDamage01 = THREE.MathUtils.clamp(
        meanArmDamage01 * 0.82 + fracturedArmCount * 0.09,
        0,
        1,
      );
      const effectiveMotorHealthScales = motorHealthScales.map((baseScale, i) => {
        const armDamage01 = THREE.MathUtils.clamp(s.armDamage01[i] ?? 0, 0, 1);
        const motorDamage01 = THREE.MathUtils.clamp(s.motorDamage01[i] ?? 0, 0, 1);
        const fractured = armDamage01 >= 0.98;
        const damageScale = THREE.MathUtils.clamp(
          1 - armDamage01 * 0.4 - motorDamage01 * 0.72,
          fractured ? 0.04 : 0.18,
          1,
        );
        return baseScale * damageScale;
      });

      // Convert thrust targets to omega targets (assume Ct0 for command inversion)
      const currentLimitPerMotorA = Math.max(5, effectiveSimSettings.motorCurrentLimitA / 4);
      const kTorqueNmPerA = 60 / (2 * Math.PI * Math.max(1, propulsion.motorKV));
      for (const i of motorIndices) {
        const healthScale = effectiveMotorHealthScales[i] ?? 1;
        const armDamage01 = THREE.MathUtils.clamp(s.armDamage01[i] ?? 0, 0, 1);
        const motorDamage01 = THREE.MathUtils.clamp(s.motorDamage01[i] ?? 0, 0, 1);
        const thrustCapN = thrustMaxPerMotorN * healthScale;
        const motorTempC = s.motorTempC[i] ?? effectiveSimSettings.ambientTempC;
        const thermalLimitScale = motorTempC <= propulsion.thermalSoftLimitC
          ? 1
          : motorTempC >= propulsion.thermalHardLimitC
            ? 0.32
            : THREE.MathUtils.lerp(
              1,
              0.32,
              (motorTempC - propulsion.thermalSoftLimitC) /
                Math.max(1e-6, propulsion.thermalHardLimitC - propulsion.thermalSoftLimitC),
            );
        const estimatedOmegaTarget =
          thrustCapN > 1e-9 && fTargetN[i] > 0
            ? 2 * Math.PI * Math.sqrt(
              Math.max(0, Math.min(thrustCapN, fTargetN[i])) /
                Math.max(1e-9, Ct0 * healthScale * rho * Math.pow(D, 4)),
            )
            : 0;
        const nTarget = estimatedOmegaTarget / (2 * Math.PI);
        const estimatedTorqueNm = Cq0 * healthScale * rho * nTarget * nTarget * Math.pow(D, 5);
        const estimatedElectricalPowerW = estimatedTorqueNm * estimatedOmegaTarget / Math.max(0.2, propulsion.motorEff);
        const estimatedCurrentA = estimatedElectricalPowerW / Math.max(1, Vpack);
        const currentLimitScale = estimatedCurrentA > 1e-6
          ? Math.min(1, currentLimitPerMotorA / estimatedCurrentA)
          : 1;
        const availableScale = Math.min(currentLimitScale, thermalLimitScale);
        const availableThrustCapN = thrustCapN * availableScale;
        const f = Math.min(availableThrustCapN, Math.max(0, fTargetN[i]));
        s.currentLimitScale01[i] = currentLimitScale;
        s.thermalLimitScale01[i] = thermalLimitScale;
        const escA = 1 - Math.exp(-dt / Math.max(0.003, effectiveSimSettings.escLatencyMs * 1e-3 + 0.004));
        s.escCommand01[i] = THREE.MathUtils.lerp(
          s.escCommand01[i] ?? 0,
          availableThrustCapN > 1e-6 ? f / availableThrustCapN : 0,
          escA,
        );
        const omegaTarget =
          s.escCommand01[i] > 0
            ? 2 * Math.PI * Math.sqrt(
              (s.escCommand01[i] * availableThrustCapN) /
                Math.max(1e-9, Ct0 * healthScale * rho * Math.pow(D, 4)),
            )
            : 0;
        const omegaClamped = Math.max(
          0,
          Math.min(omegaTarget, omegaMaxRad * Math.sqrt(healthScale)),
        );
        const omegaCurrent = Math.max(0, s.motorOmegaRad[i] ?? 0);
        const maxOmegaForMotor = Math.max(1, omegaMaxRad * Math.sqrt(healthScale));
        const voltageScale = THREE.MathUtils.clamp(Vpack / Math.max(1, Vopen), 0.72, 1.02);
        const trackingError01 = THREE.MathUtils.clamp(
          (omegaClamped - omegaCurrent) / Math.max(120, maxOmegaForMotor * 0.35),
          -1,
          1,
        );
        const currentDemandA = currentLimitPerMotorA * s.escCommand01[i] * (0.35 + 0.65 * Math.max(0, trackingError01));
        const backEmf01 = THREE.MathUtils.clamp(omegaCurrent / maxOmegaForMotor, 0, 1.15);
        const driveTorqueNm =
          kTorqueNmPerA * currentDemandA * voltageScale * Math.max(0.06, 1 - backEmf01 * 0.82);
        const omegaCurrentHz = omegaCurrent / (2 * Math.PI);
        const aeroLoadTorqueNm =
          Cq0 * healthScale * rho * omegaCurrentHz * omegaCurrentHz * Math.pow(D, 5);
        const trackingTauSec = Math.max(
          0.008,
          propulsion.motorTauSec *
            (manualMode ? 1.45 : 1) *
            (0.58 + propulsion.rotorInertiaScale * 0.42) *
            (1 + armDamage01 * 0.45 + motorDamage01 * 0.8),
        );
        const assistTorqueNm = THREE.MathUtils.clamp(
          propulsion.rotorInertiaKgM2 * (omegaClamped - omegaCurrent) / trackingTauSec,
          -driveTorqueNm * (manualMode ? 0.4 : 0.65),
          driveTorqueNm * (manualMode ? 0.7 : 1),
        );
        const angularAccelRadS2 =
          (driveTorqueNm + assistTorqueNm - aeroLoadTorqueNm) /
          Math.max(1e-9, propulsion.rotorInertiaKgM2);
        const omegaNext = omegaCurrent + angularAccelRadS2 * dt;
        s.motorOmegaRad[i] = THREE.MathUtils.clamp(omegaNext, 0, maxOmegaForMotor);
      }

      // Aerodynamics: thrust/torque from omega and advance ratio, plus frame flex + static motor misalignment.
      const vBody = s.velM.clone().applyQuaternion(s.quat.clone().invert());

      const Fbody = new THREE.Vector3(0, 0, 0);
      const torqueBodyNm = new THREE.Vector3(0, 0, 0);
      let mechPowerW = 0;
      const motorElectricalPowerW: MotorTuple<number> = [0, 0, 0, 0];
      let propWashLossAccum = 0;
      let rotorReloadLossAccum = 0;

      const tmpAxis = new THREE.Vector3();
      const tmpF = new THREE.Vector3();
      const tmpTau = new THREE.Vector3();
      const discAreaM2 = Math.PI * Math.pow(D * 0.5, 2);
      const bodyRateDeg = THREE.MathUtils.radToDeg(s.omegaBody.length());
      const rateAggression01 = THREE.MathUtils.clamp((bodyRateDeg - 180) / 900, 0, 1);

      const aFlex = 1 - Math.exp(-dt / propulsion.flexTauSec);
      for (const i of motorIndices) {
        const omega = Math.max(0, s.motorOmegaRad[i] ?? 0);
        const n = omega / (2 * Math.PI);
        const armDamage01 = THREE.MathUtils.clamp(s.armDamage01[i] ?? 0, 0, 1);
        const motorDamage01 = THREE.MathUtils.clamp(s.motorDamage01[i] ?? 0, 0, 1);
        const fractured = armDamage01 >= 0.98;

        // Flex target derived from commanded thrust (keeps it causal but stable)
        const flexTarget = fTargetN[i] * propulsion.flexRadPerN * (1 + armDamage01 * 1.1);
        s.motorTiltRad[i] = THREE.MathUtils.lerp(s.motorTiltRad[i] ?? 0, flexTarget, aFlex);

        // Static motor tilt/misalignment (print/assembly realism)
        const deg =
          propulsion.staticMisalignDeg +
          armDamage01 * 6.5 +
          motorDamage01 * 4.5 +
          (fractured ? 9 : 0);
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
        const healthScale = effectiveMotorHealthScales[i] ?? 1;
        const thrustCoeff = Math.max(1e-9, Ct0 * healthScale * rho * Math.pow(D, 4));
        const omegaTargetFromThrust = fTargetN[i] > 1e-6
          ? 2 * Math.PI * Math.sqrt(fTargetN[i] / thrustCoeff)
          : 0;
        const inducedVelocityMS = Math.sqrt(
          Math.max(0, fTargetN[i]) / Math.max(1e-6, 2 * rho * discAreaM2),
        );
        const sinkIntoWashMS = Math.max(0, vIn - inducedVelocityMS * 0.55);
        const washTarget01 = THREE.MathUtils.clamp(
          (sinkIntoWashMS / Math.max(1.2, inducedVelocityMS * 1.75)) *
            (manualMode ? 0.74 : 0.6 + 0.4 * rateAggression01) *
            propWashCoupling *
            (manualMode ? 1.18 : 1),
          0,
          1,
        );
        const omegaError01 = THREE.MathUtils.clamp(
          Math.max(0, omegaTargetFromThrust - omega) / Math.max(120, omegaMaxRad * 0.35),
          0,
          1,
        );
        const reloadTarget01 = THREE.MathUtils.clamp(
          propWashCoupling * (
            washTarget01 * (manualMode ? 0.88 : 0.7) +
            rateAggression01 * lowThrottleBlend * (manualMode ? 0.6 : 0.45) +
            omegaError01 * (manualMode ? 0.82 : 0.65)
          ) * (manualMode ? 1.12 : 1),
          0,
          1,
        );
        const washTauSec = washTarget01 > (s.motorWash01[i] ?? 0)
          ? (manualMode ? 0.12 : 0.09)
          : (manualMode ? 0.28 : 0.22);
        const reloadTauSec = reloadTarget01 > (s.motorReload01[i] ?? 0)
          ? (manualMode ? 0.08 : 0.05)
          : (manualMode ? 0.24 : 0.18);
        s.motorWash01[i] = THREE.MathUtils.lerp(
          s.motorWash01[i] ?? 0,
          washTarget01,
          1 - Math.exp(-dt / washTauSec),
        );
        s.motorReload01[i] = THREE.MathUtils.lerp(
          s.motorReload01[i] ?? 0,
          reloadTarget01,
          1 - Math.exp(-dt / reloadTauSec),
        );

        const washLoss01 = (s.motorWash01[i] ?? 0) * (0.34 + 0.16 * lowThrottleBlend);
        const reloadLoss01 = (s.motorReload01[i] ?? 0) * 0.24;
        const ctLossScale = THREE.MathUtils.clamp(1 - washLoss01 - reloadLoss01, 0.42, 1.08);
        const cqLossScale = THREE.MathUtils.clamp(
          1 - washLoss01 * 0.7 - reloadLoss01 * 0.55,
          0.48,
          1.08,
        );
        const Ct = Ct0 * healthScale * THREE.MathUtils.clamp(1 - 0.6 * J, 0, 1.25) * ctLossScale;
        const Cq = Cq0 * healthScale * THREE.MathUtils.clamp(1 - 0.5 * J, 0, 1.25) * cqLossScale;

        const thrustN = Ct * rho * n * n * Math.pow(D, 4);
        const torqueNm = Cq * rho * n * n * Math.pow(D, 5);
        mechPowerW += torqueNm * omega;
        motorElectricalPowerW[i] = (torqueNm * omega) / Math.max(0.2, propulsion.motorEff);
        s.motorCurrentA[i] = motorElectricalPowerW[i] / Math.max(1, Vpack);
        propWashLossAccum += washLoss01;
        rotorReloadLossAccum += reloadLoss01;

        tmpF.copy(tmpAxis).multiplyScalar(thrustN);
        Fbody.add(tmpF);

        tmpTau.copy(rBody[i]).cross(tmpF);
        torqueBodyNm.add(tmpTau);
        torqueBodyNm.y += yawSign[i] * torqueNm;

        // Advance motor phase for next step (drives IMU vibration)
        s.motorPhaseRad[i] = ((s.motorPhaseRad[i] ?? 0) + omega * dt) % (Math.PI * 2);
      }

      for (const i of motorIndices) {
        const ambientTempC = atmosphere.temperatureC;
        const heatingRateCPerSec =
          (motorElectricalPowerW[i] * propulsion.motorHeatFraction) /
          Math.max(1e-6, propulsion.motorThermalCapacityJPerC);
        const coolingRateCPerSec =
          Math.max(0, (s.motorTempC[i] ?? ambientTempC) - ambientTempC) *
          propulsion.motorThermalLeakPerSec *
          Math.max(0.1, effectiveSimSettings.motorCoolingScale);
        s.motorTempC[i] = Math.max(
          ambientTempC,
          (s.motorTempC[i] ?? ambientTempC) + (heatingRateCPerSec - coolingRateCPerSec) * dt,
        );
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

      let groundEffectMult = 1;
      let windVelWorld = new THREE.Vector3(0, 0, 0);
      let airspeedMS = s.velM.length();
      let gustMS = 0;

      // Ground effect: thrust augmentation when altitude < 1 rotor diameter.
      // Based on Cheeseman & Bennett (1955): T_ge/T = 1 / (1 - (R/(4*z))^2)
      // where z = altitude, R = rotor radius.
      {
        const rotorR = (propSize * 25.4 / 2) * 1e-3; // prop radius in meters
        const thrustDir =
          thrustWorld.lengthSq() > 1e-9
            ? thrustWorld.clone().normalize()
            : new THREE.Vector3(0, 1, 0);

        // Effective height measured along the thrust axis (simple tilt correction).
        const cosTilt = THREE.MathUtils.clamp(thrustDir.y, 0.2, 1);
        const zAxis = Math.max(0.01, Math.max(0, bottomAGLM) / cosTilt);

        // Only apply ground effect when the rotors are actually producing airflow.
        if (s.armed && thrustWorld.lengthSq() > 1e-8 && zAxis < rotorR * 2) {
          const ratio = rotorR / (4 * zAxis);
          groundEffectMult = 1 / Math.max(0.5, 1 - ratio * ratio);
          groundEffectMult = THREE.MathUtils.clamp(groundEffectMult, 1.0, 1.4);

          // Apply along the thrust axis for more realistic behavior when tilted.
          thrustWorld.multiplyScalar(groundEffectMult);
        }
      }

      // Wind model (m/s): light gusts that slowly vary.
      {
        if (!s.windPhase) {
          s.windPhase = [rand01() * 100, rand01() * 100, rand01() * 100];
        }
        const windT = (s.windTime ?? 0) + dt;
        s.windTime = windT;

        const windField = computeWindField({
          preset: effectiveSimSettings.environmentPreset,
          timeSec: windT,
          positionM: s.posM,
          meanWindMS: effectiveSimSettings.meanWindMS,
          gustAmplitudeMS: effectiveSimSettings.gustAmplitudeMS,
          turbulenceMS: effectiveSimSettings.turbulenceMS,
          phases: s.windPhase,
        });
        gustMS = windField.gustMS;

        // Shield wind close to the ground (AGL).
        const altFactor = THREE.MathUtils.smoothstep(Math.max(0, bottomAGLM), 0, 1.5);
        windVelWorld = windField.velocityWorld.multiplyScalar(altFactor);
      }

      // Quadratic aerodynamic drag from RELATIVE airspeed: v_rel = v - wind.
      const CdA = (frameSize / 210) * 0.012; // parasitic drag area
      const vRel = s.velM.clone().sub(windVelWorld);
      airspeedMS = vRel.length();
      const dragWorld = airspeedMS > 1e-6
        ? vRel.clone().multiplyScalar(
          -0.5 * rho * CdA * (1 + structureDamage01 * 0.9 + s.batteryDamage01 * 0.22) * airspeedMS,
        )
        : new THREE.Vector3(0, 0, 0);

      // Apply forces/torques to Rapier.
      // Rapier world uses mm, so: 1 N -> 1000 (kg*mm/s^2), 1 N*m -> 1e6 (kg*mm^2/s^2)
      const forceWorldN = thrustWorld.clone().add(dragWorld);
      {
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

      {
        const accelBody = forceWorldN
          .clone()
          .divideScalar(Math.max(1e-6, massKg))
          .applyQuaternion(s.quat.clone().invert());
        const accelWorld = forceWorldN.clone().divideScalar(Math.max(1e-6, massKg));
        const gyroWorldDpsVec = s.omegaBody
          .clone()
          .applyQuaternion(s.quat)
          .multiplyScalar(THREE.MathUtils.RAD2DEG);
        const magBody = magneticFieldWorldVector().applyQuaternion(s.quat.clone().invert());
        const headingDeg = THREE.MathUtils.euclideanModulo(
          THREE.MathUtils.radToDeg(Math.atan2(magBody.x, magBody.z)),
          360,
        );
        s.gpsSampleAgeSec += dt;
        s.baroSampleAgeSec += dt;
        s.rangefinderSampleAgeSec += dt;
        s.magnetometerSampleAgeSec += dt;
        s.gyroSampleAgeSec += dt;
        s.accelSampleAgeSec += dt;
        impactDebugRef.current.ageSec += dt;

        if (effectiveSimSettings.gpsEnabled) {
          s.gpsTimer += dt;
          const gpsPeriodSec = 1 / Math.max(1, effectiveSimSettings.gpsRateHz);
          if (s.gpsTimer >= gpsPeriodSec) {
            s.gpsTimer = 0;
            s.gpsAltitudeM = Math.max(0, bottomAGLM + randN(0.35 * sensorNoiseScale));
            s.gpsSpeedMS = Math.max(0, s.velM.length() + randN(0.12 * sensorNoiseScale));
            s.gpsSamplePosM.set(
              s.posM.x + randN(0.26 * sensorNoiseScale),
              s.gpsAltitudeM,
              s.posM.z + randN(0.26 * sensorNoiseScale),
            );
            s.gpsSampleAgeSec = 0;
          }
        } else {
          s.gpsAltitudeM = 0;
          s.gpsSpeedMS = 0;
          s.gpsSampleAgeSec = Number.POSITIVE_INFINITY;
        }

        if (effectiveSimSettings.barometerEnabled) {
          s.baroTimer += dt;
          if (s.baroTimer >= 1 / 25) {
            s.baroTimer = 0;
            const measuredPressurePa = atmosphere.pressurePa + randN(10 * sensorNoiseScale);
            s.baroAltitudeM = pressureToAltitudeM(measuredPressurePa, effectiveSimSettings.ambientTempC);
            s.baroSampleAgeSec = 0;
          }
        } else {
          s.baroAltitudeM = 0;
          s.baroSampleAgeSec = Number.POSITIVE_INFINITY;
        }

        if (effectiveSimSettings.rangefinderEnabled) {
          s.rangefinderTimer += dt;
          if (s.rangefinderTimer >= 1 / 30) {
            s.rangefinderTimer = 0;
            const bodyDownWorld = new THREE.Vector3(0, -1, 0).applyQuaternion(s.quat);
            const downCos = Math.max(0.2, -bodyDownWorld.y);
            s.rangefinderM = bottomAGLM < 40
              ? Math.max(0, bottomAGLM / downCos + randN(0.015 * sensorNoiseScale))
              : 0;
            s.rangefinderSampleAgeSec = 0;
          }
        } else {
          s.rangefinderM = 0;
          s.rangefinderSampleAgeSec = Number.POSITIVE_INFINITY;
        }

        if (effectiveSimSettings.magnetometerEnabled) {
          s.magnetometerTimer += dt;
          if (s.magnetometerTimer >= 1 / 40) {
            s.magnetometerTimer = 0;
            s.headingDeg = headingDeg + randN(1.4 * sensorNoiseScale);
            s.magnetometerSampleAgeSec = 0;
          }
        } else {
          s.headingDeg = 0;
          s.magnetometerSampleAgeSec = Number.POSITIVE_INFINITY;
        }

        s.imuTimer += dt;
        if (s.imuTimer >= 1 / 120) {
          s.imuTimer = 0;
          s.gyroDps = omegaMeas.length() * THREE.MathUtils.RAD2DEG + randN(0.9 * sensorNoiseScale);
          s.accelMS2 = accelBody.length() + randN(0.18 * sensorNoiseScale);
          s.gyroSampleAgeSec = 0;
          s.accelSampleAgeSec = 0;
        }

        // Publish flight telemetry for UI (no DevTools required).
        if (flightTelemetryRef) {
          flightTelemetryTickRef.current.t += dt;
          if (flightTelemetryTickRef.current.t >= 0.05) {
            flightTelemetryTickRef.current.t = 0;
            const weightN = massKg * g;
            const thrustN = Math.max(0, thrustWorld.y);
            const tw = weightN > 1e-6 ? thrustN / weightN : 0;
            const avgMotorTempC =
              (s.motorTempC[0] + s.motorTempC[1] + s.motorTempC[2] + s.motorTempC[3]) / 4;
            const peakMotorTempC = Math.max(...s.motorTempC);
            const lastImpactPointMm = impactDebugRef.current.pointMm;
            const lastImpactNormalWorld = impactDebugRef.current.normalWorld;
            const lastImpactForceWorldN = impactDebugRef.current.forceWorldN;
            flightTelemetryRef.current = {
              throttle01: s.throttle01,
              thrustN,
              weightN,
              tw,
              altitudeM: Math.max(0, bottomAGLM),
              speedMS: s.velM.length(),
              airspeedMS,
              windMS: windVelWorld.length(),
              groundEffectMult,
              batteryV: s.batteryV,
              batteryI: s.batteryI,
              batterySagV: Math.max(0, Vopen - s.batteryV),
              totalMassG: massKg * 1000,
              armed: s.armed,
              ambientTempC: atmosphere.temperatureC,
              pressurePa: atmosphere.pressurePa,
              airDensityKgM3: atmosphere.densityKgM3,
              gustMS,
              actuatorSpreadPct,
              gpsAltitudeM: s.gpsAltitudeM,
              gpsSpeedMS: s.gpsSpeedMS,
              baroAltitudeM: s.baroAltitudeM,
              rangefinderM: s.rangefinderM,
              headingDeg: s.headingDeg,
              gyroDps: s.gyroDps,
              accelMS2: s.accelMS2,
              motorTempsC: [
                s.motorTempC[0],
                s.motorTempC[1],
                s.motorTempC[2],
                s.motorTempC[3],
              ],
              motorCurrentsA: [
                s.motorCurrentA[0],
                s.motorCurrentA[1],
                s.motorCurrentA[2],
                s.motorCurrentA[3],
              ],
              avgMotorTempC,
              peakMotorTempC,
              structureDamagePct: structureDamage01 * 100,
              motorDamagePct: meanMotorDamage01 * 100,
              batteryDamagePct: s.batteryDamage01 * 100,
              fracturedArms: fracturedArmCount,
              currentLimitA: effectiveSimSettings.motorCurrentLimitA,
              currentLimitScale: Math.min(...s.currentLimitScale01),
              thermalLimitScale: Math.min(...s.thermalLimitScale01),
              ...createSimSettingsTelemetrySnapshot(effectiveSimSettings, {
                buildMotorKV: propulsion.motorKV,
                buildBatteryCells: propulsion.batteryCells,
                buildPropPitchIn: propulsion.propPitchIn,
                buildPackResistanceMilliOhm: propulsion.packRintOhm * 1000,
                rotorInertiaScale: propulsion.rotorInertiaScale,
                acroRateDegPerSec,
                acroExpo,
                airmodeStrength,
                propWashCoupling,
              }),
              propWashLoss: propWashLossAccum / 4,
              rotorReloadLoss: rotorReloadLossAccum / 4,
              gpsSampleAgeSec: s.gpsSampleAgeSec,
              baroSampleAgeSec: s.baroSampleAgeSec,
              rangefinderSampleAgeSec: s.rangefinderSampleAgeSec,
              magnetometerSampleAgeSec: s.magnetometerSampleAgeSec,
              gyroSampleAgeSec: s.gyroSampleAgeSec,
              accelSampleAgeSec: s.accelSampleAgeSec,
              positionMm: [s.posM.x * 1000, s.posM.y * 1000, s.posM.z * 1000],
              gpsPositionMm: [
                s.gpsSamplePosM.x * 1000,
                s.gpsSamplePosM.y * 1000,
                s.gpsSamplePosM.z * 1000,
              ],
              thrustWorldN: [thrustWorld.x, thrustWorld.y, thrustWorld.z],
              dragWorldN: [dragWorld.x, dragWorld.y, dragWorld.z],
              windWorldMS: [windVelWorld.x, windVelWorld.y, windVelWorld.z],
              velocityWorldMS: [s.velM.x, s.velM.y, s.velM.z],
              accelWorldMS2: [accelWorld.x, accelWorld.y, accelWorld.z],
              gyroWorldDpsVec: [gyroWorldDpsVec.x, gyroWorldDpsVec.y, gyroWorldDpsVec.z],
              bodyUpWorld: [
                new THREE.Vector3(0, 1, 0).applyQuaternion(s.quat).x,
                new THREE.Vector3(0, 1, 0).applyQuaternion(s.quat).y,
                new THREE.Vector3(0, 1, 0).applyQuaternion(s.quat).z,
              ],
              headingWorld: [
                Math.sin(THREE.MathUtils.degToRad(s.headingDeg)),
                0,
                Math.cos(THREE.MathUtils.degToRad(s.headingDeg)),
              ],
              collisionHalfExtentsMm: assemblyHalfExtents,
              collisionCenterMm: [
                s.posM.x * 1000 + flightColliderOffset[0],
                s.posM.y * 1000 + assemblyColliderCenterY + flightColliderOffset[1],
                s.posM.z * 1000 + flightColliderOffset[2],
              ],
              ...(lastImpactPointMm ? { lastImpactPointMm } : {}),
              ...(lastImpactNormalWorld ? { lastImpactNormalWorld } : {}),
              ...(lastImpactForceWorldN ? { lastImpactForceWorldN } : {}),
              lastImpactForceN: impactDebugRef.current.forceN,
              lastImpactAgeSec: impactDebugRef.current.ageSec,
              contactCount: impactDebugRef.current.contactCount,
            };
          }
        }
      }

      // Battery sag (very simplified but causal): V = Voc - I*R, I from mechanical power/eff.
      {
        const Pel = motorElectricalPowerW.reduce((sum, value) => sum + value, 0);
        const effectivePackRintOhm =
          propulsion.packRintOhm * (1 + s.batteryDamage01 * 1.6 + structureDamage01 * 0.18);
        let V = Vpack;
        let I = 0;
        for (let k = 0; k < 2; k++) {
          I = Pel / Math.max(1, V);
          V = Math.max(
            propulsion.batteryCells * 3.3,
            Math.min(Vopen, Vopen - I * effectivePackRintOhm),
          );
        }
        s.batteryV = V;
        s.batteryI = I;
      }

      // Visual: spin propellers based on motor angular velocity
      for (const i of motorIndices) {
        const motorAssembly = motorAssemblyRefs.current[i];
        const propGroup = propGroupRefs.current[i];
        const armDamage01 = THREE.MathUtils.clamp(s.armDamage01[i] ?? 0, 0, 1);
        const motorDamage01 = THREE.MathUtils.clamp(s.motorDamage01[i] ?? 0, 0, 1);
        if (motorAssembly) {
          const tiltSignX = i < 2 ? -1 : 1;
          const tiltSignZ = i % 2 === 0 ? -1 : 1;
          const droopMm = THREE.MathUtils.lerp(0, 5.5, armDamage01) + (armDamage01 >= 0.98 ? 4 : 0);
          const yawSkewRad = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(0, 4, motorDamage01));
          motorAssembly.position.y = -droopMm;
          motorAssembly.rotation.set(
            THREE.MathUtils.degToRad(tiltSignX * armDamage01 * 10),
            tiltSignZ * yawSkewRad,
            THREE.MathUtils.degToRad(tiltSignZ * (armDamage01 * 13 + motorDamage01 * 5)),
          );
        }
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
      for (const i of motorIndices) {
        const motorAssembly = motorAssemblyRefs.current[i];
        const propGroup = propGroupRefs.current[i];
        if (motorAssembly) {
          motorAssembly.position.y = 0;
          motorAssembly.rotation.set(0, 0, 0);
        }
        if (!propGroup) continue;
        propGroup.rotation.y = 0;
        propSpinRad.current[i] = 0;
      }
    }

    updateMotorAudio();
  });

  const v = isPrintLayout
    ? {
        frame: true,
        propulsion: false,
        electronics: false,
        accessories: showTPU,
      }
    : effectiveViewSettings.visibility;
  const invalidTargetSet = useMemo(() => new Set(invalidTargets), [invalidTargets]);
  const isInvalidTarget = (...targets: InspectTarget[]) =>
    targets.some((target) => invalidTargetSet.has(target));
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
      {isPrintLayout && (
        <>
          <group position={[carbonSheetCenterX, printSurfaceY, 0]}>
            <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[carbonSheetSize, carbonSheetSize]} />
              <meshStandardMaterial
                color="#0f172a"
                transparent
                opacity={0.16}
                roughness={0.92}
                metalness={0.04}
              />
            </mesh>
            <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[
                carbonSheetSize / 2 - printGuideLineThickness,
                carbonSheetSize / 2,
                4,
              ]} />
              <meshStandardMaterial color="#7dd3fc" transparent opacity={0.45} />
            </mesh>
            <mesh position={[0, printGuideLineHeight / 2, 0]}>
              <boxGeometry args={[carbonSheetSize, printGuideLineHeight, printGuideLineThickness]} />
              <meshStandardMaterial color="#7dd3fc" transparent opacity={0.18} />
            </mesh>
            <mesh position={[0, printGuideLineHeight / 2, 0]}>
              <boxGeometry args={[printGuideLineThickness, printGuideLineHeight, carbonSheetSize]} />
              <meshStandardMaterial color="#7dd3fc" transparent opacity={0.18} />
            </mesh>
            <Annotation
              title="Carbon Cut Sheet"
              description={`${carbonSheetSize}×${carbonSheetSize}mm stock • 2 parts nested`}
              position={[0, 8, carbonSheetSize / 2 + 22]}
            />
          </group>

          <group position={[tpuBedCenterX, printSurfaceY, 0]}>
            <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[tpuBedSize, tpuBedSize]} />
              <meshStandardMaterial
                color="#111827"
                transparent
                opacity={0.22}
                roughness={0.96}
                metalness={0.03}
              />
            </mesh>
            <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[
                tpuBedSize / 2 - printGuideLineThickness,
                tpuBedSize / 2,
                4,
              ]} />
              <meshStandardMaterial color="#34d399" transparent opacity={0.5} />
            </mesh>
            <mesh position={[0, printGuideLineHeight / 2, 0]}>
              <boxGeometry args={[tpuBedSize, printGuideLineHeight, printGuideLineThickness]} />
              <meshStandardMaterial color="#34d399" transparent opacity={0.2} />
            </mesh>
            <mesh position={[0, printGuideLineHeight / 2, 0]}>
              <boxGeometry args={[printGuideLineThickness, printGuideLineHeight, tpuBedSize]} />
              <meshStandardMaterial color="#34d399" transparent opacity={0.2} />
            </mesh>
            <Annotation
              title="TPU Print Bed"
              description={`${tpuBedSize}×${tpuBedSize}mm FDM envelope • accessories laid flat`}
              position={[0, 8, tpuBedSize / 2 + 22]}
            />
          </group>
        </>
      )}
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
              <group
                ref={(el) => {
                  motorAssemblyRefs.current[i] = el;
                }}
              >
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
            {([[-1, -1], [-1, 1], [1, -1], [1, 1]] as const).map(([dx, dz], si) => {
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
          </group>
          )}

          {v.electronics && (
          <group>
            <group
              position={[
                topPos[0],
                topPos[1] + topPlateTopY + 24 + explodeCameraY * 0.4,
                topPos[2] - fcMounting / 2 - 18,
              ]}
            >
              <mesh castShadow receiveShadow>
                <cylinderGeometry args={[6, 6, 34, 16]} />
                <meshStandardMaterial color="#3f3f46" roughness={0.78} metalness={0.18} />
              </mesh>
              <mesh position={[0, 22, 0]} castShadow receiveShadow>
                <cylinderGeometry args={[11, 11, 4, 24]} />
                <meshStandardMaterial
                  color={effectiveSimSettings.gpsEnabled ? "#9ca3af" : "#52525b"}
                  roughness={0.72}
                  metalness={0.08}
                />
              </mesh>
              <mesh position={[0, 18, 0]} castShadow receiveShadow>
                <cylinderGeometry args={[5, 5, 3, 16]} />
                <meshStandardMaterial
                  color={effectiveSimSettings.magnetometerEnabled ? "#6b7280" : "#52525b"}
                  roughness={0.7}
                  metalness={0.08}
                />
              </mesh>
              {viewMode === "exploded" && (
                <Annotation
                  title="GNSS + Magnetometer Mast"
                  description="Raised puck keeps magnetic sensing clear of ESC noise and props"
                  position={[18, 26, 0]}
                />
              )}
            </group>

            <group
              position={[
                bottomPos[0] + 6,
                bottomPos[1] + bottomPlateTopY + 13 + explodeStackY,
                bottomPos[2] + 4,
              ]}
            >
              <mesh castShadow receiveShadow>
                <boxGeometry args={[5, 0.8, 5]} />
                <meshStandardMaterial
                  color={effectiveSimSettings.barometerEnabled ? "#a3a3a3" : "#3f3f46"}
                  roughness={0.84}
                  metalness={0.08}
                />
              </mesh>
              <mesh position={[-7, 0, -5]} castShadow receiveShadow>
                <boxGeometry args={[4.4, 0.9, 4.4]} />
                <meshStandardMaterial color="#18181b" roughness={0.9} metalness={0.08} />
              </mesh>
              {viewMode === "exploded" && (
                <Annotation
                  title="IMU + Barometer Package"
                  description="Board-level inertial core and pressure port on the FC stack"
                  position={[18, 6, 0]}
                />
              )}
            </group>

            <group
              position={[
                bottomPos[0],
                bottomPos[1] - 6,
                bottomPos[2] + 6,
              ]}
            >
              <mesh castShadow receiveShadow>
                <boxGeometry args={[14, 4, 18]} />
                <meshStandardMaterial
                  color={effectiveSimSettings.rangefinderEnabled ? "#a3a3a3" : "#3f3f46"}
                  roughness={0.8}
                  metalness={0.08}
                />
              </mesh>
              <mesh position={[-3.5, -1.8, 8.5]} castShadow receiveShadow>
                <cylinderGeometry args={[2.3, 2.3, 1.2, 16]} />
                <meshStandardMaterial color="#0f172a" metalness={0.35} roughness={0.28} />
              </mesh>
              <mesh position={[3.5, -1.8, 8.5]} castShadow receiveShadow>
                <cylinderGeometry args={[2.3, 2.3, 1.2, 16]} />
                <meshStandardMaterial color="#0f172a" metalness={0.35} roughness={0.28} />
              </mesh>
              {viewMode === "exploded" && (
                <Annotation
                  title="Downward Rangefinder"
                  description="Dual-aperture altimeter for low-hover and landing work"
                  position={[0, -12, 18]}
                />
              )}
            </group>
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
              {viewMode === "exploded" && (
                <mesh position={[0, 0, 35]} rotation={[-Math.PI / 2, 0, 0]}>
                  <cylinderGeometry args={[40, 0.1, 40, 32]} />
                  <meshStandardMaterial
                    color="#d4d4d8"
                    transparent
                    opacity={0.05}
                    depthWrite={false}
                  />
                </mesh>
              )}
            </group>
            {viewMode === "exploded" && (
              <Annotation
                title="FPV Camera"
                description="19×19mm Micro • 30° Uptilt • 160° FOV"
                position={[15, 0, 0]}
              />
            )}
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
            {viewMode === "exploded" && (
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
            )}
          </group>
          )}
        </group>

        {invalidTargetSet.size > 0 && (
          <group>
            <InvalidPartOverlay
              visible={isInvalidTarget("bottom_plate", "carbon_sheet")}
              position={bottomPos}
              size={[frameSize * 0.82, plateThickness + 8, frameSize * 0.82]}
            />
            <InvalidPartOverlay
              visible={isInvalidTarget("top_plate")}
              position={topPos}
              size={[fcMounting + 34, topPlateThickness + 8, fcMounting + 56]}
            />
            <InvalidPartOverlay
              visible={isInvalidTarget("standoffs")}
              position={[0, standoffY, 0]}
              size={[fcMounting + 30, standoffHeight + 10, fcMounting + 30]}
            />
            {motorPositions.map((pos, i) => (
              <InvalidPartOverlay
                key={`invalid-motor-overlay-${i}`}
                visible={isInvalidTarget("motors_props", "reference_hardware")}
                position={[pos[0] + bottomPos[0], bottomPos[1] + bottomPlateTopY + 18, pos[2] + bottomPos[2]]}
                size={[(propSize * 25.4) + 18, 40, (propSize * 25.4) + 18]}
              />
            ))}
            <InvalidPartOverlay
              visible={isInvalidTarget("fc_stack")}
              position={[bottomPos[0], bottomPos[1] + bottomPlateTopY + 10 + explodeStackY * 0.5, bottomPos[2]]}
              size={[fcMounting + 20, Math.max(24, effectiveSimSettings.stackHeightMm + 12), fcMounting + 24]}
            />
            <InvalidPartOverlay
              visible={isInvalidTarget("sensor_mast", "antenna_routing")}
              position={[
                topPos[0],
                topPos[1] + topPlateTopY + 24 + explodeCameraY * 0.4,
                topPos[2] - fcMounting / 2 - 18,
              ]}
              size={[26, 54, 26]}
            />
            <InvalidPartOverlay
              visible={isInvalidTarget("imu_baro")}
              position={[
                bottomPos[0] + 2,
                bottomPos[1] + bottomPlateTopY + 13 + explodeStackY,
                bottomPos[2],
              ]}
              size={[24, 12, 20]}
            />
            <InvalidPartOverlay
              visible={isInvalidTarget("rangefinder")}
              position={[bottomPos[0], bottomPos[1] - 6, bottomPos[2] + 6]}
              size={[22, 10, 24]}
            />
            <InvalidPartOverlay
              visible={isInvalidTarget("fpv_camera", "tpu_pack")}
              position={[
                bottomPos[0],
                bottomPos[1] + bottomPlateTopY + standoffHeight / 2 + explodeCameraY,
                bottomPos[2] + fcMounting / 2 + 18,
              ]}
              size={[34, 28, 34]}
            />
            <InvalidPartOverlay
              visible={isInvalidTarget("battery_pack")}
              position={[
                topPos[0],
                topPos[1] + topPlateTopY + 15 + explodeBatteryY,
                topPos[2],
              ]}
              size={[46, 38, 86]}
            />
            <InvalidPartOverlay
              visible={isInvalidTarget("wiring_harness")}
              position={[0, bottomPos[1] + bottomPlateTopY + 10, 0]}
              size={[fcMounting + 62, standoffHeight + 16, fcMounting + 90]}
            />
          </group>
        )}

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

        {isPrintLayout && showTPU && (
          <group>
            <group position={[tpuBedCenterX, 1.2, 0]}>
              <group position={[-62, 0, -58]}>
                <mesh position={[-16, 1, 0]} material={tpuMaterial} castShadow receiveShadow>
                  <boxGeometry args={[22, 2, 22]} />
                </mesh>
                <mesh position={[16, 1, 0]} material={tpuMaterial} castShadow receiveShadow>
                  <boxGeometry args={[22, 2, 22]} />
                </mesh>
                <mesh position={[0, 1, 28]} material={tpuMaterial} castShadow receiveShadow>
                  <boxGeometry args={[22, 2, 22]} />
                </mesh>
                <Annotation
                  title="FPV Camera Cradle"
                  description="3 TPU pieces • flat-packed for clean bridging"
                  position={[0, 12, 28]}
                />
              </group>

              <group position={[42, 0, -56]}>
                <mesh position={[0, 2, 0]} castShadow receiveShadow material={tpuMaterial}>
                  <boxGeometry args={[24, 4, 20]} />
                </mesh>
                <mesh position={[-18, 1.5, 0]} castShadow receiveShadow material={tpuMaterial}>
                  <boxGeometry args={[16, 3, 15]} />
                </mesh>
                <mesh position={[18, 1.5, 0]} castShadow receiveShadow material={tpuMaterial}>
                  <boxGeometry args={[16, 3, 15]} />
                </mesh>
                <mesh
                  position={[-18, 1.5, 15]}
                  rotation={[-Math.PI / 2, 0, 0]}
                  castShadow
                  receiveShadow
                  material={tpuMaterial}
                >
                  <cylinderGeometry args={[7.5, 7.5, 3, 16]} />
                </mesh>
                <mesh
                  position={[18, 1.5, 15]}
                  rotation={[-Math.PI / 2, 0, 0]}
                  castShadow
                  receiveShadow
                  material={tpuMaterial}
                >
                  <cylinderGeometry args={[7.5, 7.5, 3, 16]} />
                </mesh>
                <Annotation
                  title="Action Cam Mount"
                  description="Base, twin forks, 2 cam lugs separated for print"
                  position={[0, 14, 16]}
                />
              </group>

              <group position={[-56, 0, 26]}>
                <mesh castShadow receiveShadow material={tpuMaterial}>
                  <boxGeometry args={[20, 6, standoffHeight]} />
                </mesh>
                <mesh
                  position={[0, 3, 28]}
                  rotation={[-Math.PI / 2, 0, 0]}
                  castShadow
                  receiveShadow
                  material={tpuMaterial}
                >
                  <cylinderGeometry args={[3, 3, 20, 16]} />
                </mesh>
                <mesh
                  position={[-12, 2.5, 4]}
                  rotation={[-Math.PI / 2, 0, 0]}
                  castShadow
                  receiveShadow
                  material={tpuMaterial}
                >
                  <cylinderGeometry args={[2, 2, 30, 12]} />
                </mesh>
                <mesh
                  position={[12, 2.5, 4]}
                  rotation={[-Math.PI / 2, 0, 0]}
                  castShadow
                  receiveShadow
                  material={tpuMaterial}
                >
                  <cylinderGeometry args={[2, 2, 30, 12]} />
                </mesh>
                <Annotation
                  title="Antenna Mount Pack"
                  description="Rear bridge + VTX tube + 2 RX tubes laid flat"
                  position={[0, 16, 32]}
                />
              </group>

              {motorPositions.map((_, i) => {
                const col = i % 2;
                const row = Math.floor(i / 2);
                return (
                  <group
                    key={`print-bumper-${i}`}
                    position={[38 + col * 38, 2.5, 18 + row * 40]}
                  >
                    <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow material={tpuMaterial}>
                      <torusGeometry
                        args={[motorPadRadius + 1, 2.5, 12, 24, Math.PI * 1.2]}
                      />
                    </mesh>
                  </group>
                );
              })}
              <Annotation
                title="Motor Bumpers"
                description="4 TPU guards • spaced for separate cooling and cleanup"
                position={[76, 14, 56]}
              />
            </group>
          </group>
        )}
      </group>
    </group>
  );

  if (physicsEnabled) {
    return (
      <DronePhysicsBody
        rapier={rapier}
        bodyRef={flightBodyRef}
        massKg={massProps.massKg}
        flightSpawnLiftY={flightSpawnLiftY}
        colliderDensity={colliderDensity}
        colliderHalfExtents={assemblyHalfExtents}
        colliderPosition={[
          flightColliderOffset[0],
          assemblyColliderCenterY + flightColliderOffset[1],
          flightColliderOffset[2],
        ]}
        onCollisionEnter={captureImpactFromCollision}
        onCollisionExit={() => {
          impactDebugRef.current.contactCount = 0;
        }}
        onContactForce={captureImpactForce}
      >
        {droneVisual}
      </DronePhysicsBody>
    );
  }

  // Preserve the previous assembled/clearance world placement (which used to come
  // from the rigid-body translation) without pulling Rapier into those modes.
  const needsStaticLift = viewMode !== "exploded" && viewMode !== "print_layout";
  return needsStaticLift ? (
    <group position={[0, assemblySpawnLiftY, 0]}>{droneVisual}</group>
  ) : (
    droneVisual
  );
});

DroneModel.displayName = "DroneModel";
