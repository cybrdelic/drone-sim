import { Html } from "@react-three/drei";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useFlightTrail } from "../hooks/useFlightTrail";
import { DebugSettings, DroneParams, FlightTelemetry } from "../types";

function vectorFromTuple(v?: [number, number, number]) {
  if (!v) return null;
  if (!Number.isFinite(v[0]) || !Number.isFinite(v[1]) || !Number.isFinite(v[2])) return null;
  return new THREE.Vector3(v[0], v[1], v[2]);
}

function toMm(v: THREE.Vector3, scale: number) {
  return v.clone().multiplyScalar(scale);
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function samplePulse(ageSec?: number, holdSec = 0.2) {
  if (ageSec === undefined || !Number.isFinite(ageSec)) return 0.18;
  return 0.18 + 0.82 * (1 - clamp01(ageSec / holdSec));
}

function formatAge(ageSec?: number) {
  if (ageSec === undefined || !Number.isFinite(ageSec)) return "off";
  return `${Math.round(ageSec * 1000)} ms`;
}

function directionQuaternion(direction: THREE.Vector3) {
  const normalized = direction.clone().normalize();
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normalized);
}

function isFiniteVector(vector: THREE.Vector3 | null | undefined) {
  return !!vector && Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

function DebugLine({
  points,
  color,
  opacity,
}: {
  points: THREE.Vector3[];
  color: string;
  opacity: number;
}) {
  const positions = useMemo(() => {
    const validPoints = points.filter(isFiniteVector);
    if (validPoints.length < 2) return null;

    const values = new Float32Array(validPoints.length * 3);
    validPoints.forEach((point, index) => {
      const offset = index * 3;
      values[offset] = point.x;
      values[offset + 1] = point.y;
      values[offset + 2] = point.z;
    });
    return values;
  }, [points]);

  if (!positions) return null;

  return (
    <line>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={color} transparent opacity={opacity} toneMapped={false} depthWrite={false} />
    </line>
  );
}

function SensorCone({
  origin,
  direction,
  length,
  radius,
  color,
  opacity,
}: {
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  length: number;
  radius: number;
  color: string;
  opacity: number;
}) {
  const quaternion = useMemo(() => directionQuaternion(direction), [direction]);
  const position = useMemo(
    () => origin.clone().add(direction.clone().normalize().multiplyScalar(length * 0.5)),
    [direction, length, origin],
  );

  if (!isFiniteVector(origin) || !isFiniteVector(direction) || !Number.isFinite(length) || !Number.isFinite(radius) || length <= 1e-6 || radius <= 1e-6) {
    return null;
  }

  return (
    <mesh position={position} quaternion={quaternion}>
      <coneGeometry args={[radius, length, 24, 1, true]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

function DebugArrow({
  origin,
  vector,
  color,
  scale = 1,
}: {
  origin: THREE.Vector3;
  vector: THREE.Vector3;
  color: string;
  scale?: number;
}) {
  const end = useMemo(() => origin.clone().add(vector.clone().multiplyScalar(scale)), [origin, vector, scale]);
  if (!isFiniteVector(origin) || !isFiniteVector(vector) || !isFiniteVector(end)) return null;
  return <DebugLine points={[origin, end]} color={color} opacity={0.95} />;
}

function SensorTag({
  position,
  accent,
  name,
  value,
  detail,
}: {
  position: THREE.Vector3;
  accent: string;
  name: string;
  value: string;
  detail: string;
}) {
  if (!isFiniteVector(position)) return null;

  return (
    <Html position={[position.x, position.y, position.z]} center distanceFactor={180}>
      <div className="flight-debug-tag pointer-events-none">
        <span className="flight-debug-tag__accent" style={{ backgroundColor: accent }} />
        <div className="flight-debug-tag__body">
          <div className="flight-debug-tag__name">{name}</div>
          <div className="flight-debug-tag__value">{value}</div>
          <div className="flight-debug-tag__detail">{detail}</div>
        </div>
      </div>
    </Html>
  );
}

export function FlightDebugOverlays({
  telemetry,
  debugSettings,
  params,
  targetRef,
}: {
  telemetry: FlightTelemetry;
  debugSettings: DebugSettings;
  params: DroneParams;
  targetRef: React.RefObject<THREE.Group | null>;
}) {
  const { recordTrailPosition, trailPoints } = useFlightTrail(
    debugSettings.flightTrail,
  );
  const livePositionRef = useRef(new THREE.Vector3());
  const liveQuaternionRef = useRef(new THREE.Quaternion());
  const liveBodyUpRef = useRef(new THREE.Vector3(0, 1, 0));
  const liveForwardRef = useRef(new THREE.Vector3(0, 0, 1));
  const position = isFiniteVector(livePositionRef.current)
    ? livePositionRef.current.clone()
    : vectorFromTuple(telemetry.positionMm) ?? new THREE.Vector3();
  const thrustWorld = vectorFromTuple(telemetry.thrustWorldN);
  const dragWorld = vectorFromTuple(telemetry.dragWorldN);
  const windWorld = vectorFromTuple(telemetry.windWorldMS);
  const velocityWorld = vectorFromTuple(telemetry.velocityWorldMS);
  const accelWorld = vectorFromTuple(telemetry.accelWorldMS2);
  const gyroWorld = vectorFromTuple(telemetry.gyroWorldDpsVec);
  const bodyUpWorld = liveBodyUpRef.current.clone();
  const headingWorld = liveForwardRef.current.clone().setY(0).normalize();
  const colliderHalfExtents = vectorFromTuple(telemetry.collisionHalfExtentsMm);
  const colliderCenter = vectorFromTuple(telemetry.collisionCenterMm);
  const impactPoint = vectorFromTuple(telemetry.lastImpactPointMm);
  const impactNormal = vectorFromTuple(telemetry.lastImpactNormalWorld);
  const impactForceWorld = vectorFromTuple(telemetry.lastImpactForceWorldN);
  const rangefinderM = telemetry.rangefinderM;

  const localToWorld = useMemo(() => {
    return (local: THREE.Vector3) =>
      local.clone().applyQuaternion(liveQuaternionRef.current).add(livePositionRef.current);
  }, []);

  const sensorMastWorld = localToWorld(
    new THREE.Vector3(
      0,
      params.plateThickness + params.standoffHeight + params.topPlateThickness + 24,
      -params.fcMounting / 2 - 18,
    ),
  );
  const imuWorld = localToWorld(new THREE.Vector3(6, params.plateThickness + 13, 4));
  const rangefinderWorld = localToWorld(new THREE.Vector3(0, -6, 6));
  const sensorMastTag = sensorMastWorld.clone().add(new THREE.Vector3(0, 34, 0));
  const imuTag = imuWorld.clone().add(new THREE.Vector3(28, 18, 0));
  const rangeTag = rangefinderWorld.clone().add(new THREE.Vector3(34, -8, 8));
  const cgTag = position.clone().add(new THREE.Vector3(0, 80, 0));

  useFrame(() => {
    const target = targetRef.current;
    if (!target) return;

    target.updateWorldMatrix(true, false);
    target.getWorldPosition(livePositionRef.current);
    target.getWorldQuaternion(liveQuaternionRef.current);
    liveBodyUpRef.current.set(0, 1, 0).applyQuaternion(liveQuaternionRef.current).normalize();
    liveForwardRef.current.set(0, 0, 1).applyQuaternion(liveQuaternionRef.current).normalize();

    recordTrailPosition(livePositionRef.current);
  });

  const gpsPulse = samplePulse(telemetry.gpsSampleAgeSec, 0.3);
  const baroPulse = samplePulse(telemetry.baroSampleAgeSec, 0.12);
  const rangePulse = samplePulse(telemetry.rangefinderSampleAgeSec, 0.08);
  const magPulse = samplePulse(telemetry.magnetometerSampleAgeSec, 0.1);
  const gyroPulse = samplePulse(telemetry.gyroSampleAgeSec, 0.05);
  const accelPulse = samplePulse(telemetry.accelSampleAgeSec, 0.05);
  const impactPulse = samplePulse(telemetry.lastImpactAgeSec, 0.45);

  const rangeEnd = useMemo(() => {
    if (typeof rangefinderM !== "number" || !Number.isFinite(rangefinderM) || rangefinderM <= 0) {
      return null;
    }
    const down = bodyUpWorld.clone().multiplyScalar(-1).normalize();
    return rangefinderWorld.clone().add(down.multiplyScalar(rangefinderM * 1000));
  }, [bodyUpWorld, rangefinderM, rangefinderWorld]);

  const rangeDirection = useMemo(() => {
    return bodyUpWorld.clone().multiplyScalar(-1).normalize();
  }, [bodyUpWorld]);

  const impactVector = useMemo(() => {
    if (impactForceWorld) {
      const magnitude = impactForceWorld.length();
      if (magnitude > 1e-6) {
        return impactForceWorld.clone().normalize().multiplyScalar(Math.min(520, Math.max(90, magnitude * 6)));
      }
    }

    if (impactNormal && telemetry.lastImpactForceN) {
      return impactNormal.clone().normalize().multiplyScalar(
        Math.min(520, Math.max(90, telemetry.lastImpactForceN * 6)),
      );
    }

    return null;
  }, [impactForceWorld, impactNormal, telemetry.lastImpactForceN]);

  return (
    <group>
      {debugSettings.collisionVolumes && colliderHalfExtents && colliderCenter && (
        <>
          <mesh position={colliderCenter}>
            <boxGeometry args={[
              colliderHalfExtents.x * 2,
              colliderHalfExtents.y * 2,
              colliderHalfExtents.z * 2,
            ]} />
            <meshBasicMaterial color="#fb7185" transparent opacity={0.08} wireframe />
          </mesh>
          <mesh position={[0, -50, 0]}>
            <boxGeometry args={[100000, 100, 100000]} />
            <meshBasicMaterial color="#f59e0b" transparent opacity={0.05} wireframe />
          </mesh>
        </>
      )}

      {debugSettings.forceVectors && thrustWorld && (
        <DebugArrow origin={position} vector={toMm(thrustWorld, 16)} color="#22c55e" />
      )}
      {debugSettings.forceVectors && dragWorld && (
        <DebugArrow origin={position} vector={toMm(dragWorld, 120)} color="#f97316" />
      )}
      {debugSettings.forceVectors && velocityWorld && (
        <DebugArrow origin={position} vector={toMm(velocityWorld, 140)} color="#e5e7eb" />
      )}
      {debugSettings.windField && windWorld && (
        <DebugArrow origin={position} vector={toMm(windWorld, 220)} color="#38bdf8" />
      )}

      {debugSettings.sensorOverlays && (
        <>
          <DebugLine points={[sensorMastWorld, sensorMastTag]} color="#22d3ee" opacity={0.35} />
          <mesh position={sensorMastWorld}>
            <sphereGeometry args={[7 + gpsPulse * 2.5, 12, 12]} />
            <meshBasicMaterial color="#22d3ee" transparent opacity={0.35 + gpsPulse * 0.3} />
          </mesh>
          <SensorTag
            position={sensorMastTag}
            accent="#22d3ee"
            name="GNSS / MAG"
            value={`${(telemetry.gpsAltitudeM ?? 0).toFixed(2)} m`}
            detail={`gps ${formatAge(telemetry.gpsSampleAgeSec)} · hdg ${(telemetry.headingDeg ?? 0).toFixed(0)} deg`}
          />
        </>
      )}

      {debugSettings.sensorFrustums && (
        <>
          <DebugArrow origin={sensorMastWorld} vector={headingWorld.clone().multiplyScalar(180)} color="#0891b2" />
          <mesh position={sensorMastWorld.clone().add(headingWorld.clone().multiplyScalar(185))}>
            <sphereGeometry args={[6, 10, 10]} />
            <meshBasicMaterial color="#0891b2" transparent opacity={0.18 + gpsPulse * 0.2} />
          </mesh>
        </>
      )}

      {debugSettings.sensorOverlays && Number.isFinite(telemetry.baroAltitudeM) && (
        <>
          <DebugLine points={[imuWorld, imuTag]} color="#a78bfa" opacity={0.35} />
          <mesh position={imuWorld} quaternion={liveQuaternionRef.current}>
            <sphereGeometry args={[6 + baroPulse * 2, 12, 12]} />
            <meshBasicMaterial color="#a78bfa" transparent opacity={0.16 + baroPulse * 0.18} />
          </mesh>
          <SensorTag
            position={imuTag}
            accent="#a78bfa"
            name="IMU / BARO"
            value={`${(telemetry.accelMS2 ?? 0).toFixed(1)} m/s²`}
            detail={`gyro ${formatAge(telemetry.gyroSampleAgeSec)} · baro ${(telemetry.baroAltitudeM ?? 0).toFixed(2)} m`}
          />
        </>
      )}

      {debugSettings.sensorFrustums && Number.isFinite(telemetry.baroAltitudeM) && (
        <DebugArrow origin={imuWorld} vector={bodyUpWorld.clone().multiplyScalar(110)} color="#8b5cf6" />
      )}

      {debugSettings.sensorOverlays && rangeEnd && (
        <>
          <DebugLine points={[rangefinderWorld, rangeEnd]} color="#fbbf24" opacity={0.25 + rangePulse * 0.55} />
          <DebugLine points={[rangefinderWorld, rangeTag]} color="#fbbf24" opacity={0.35} />
          <SensorTag
            position={rangeTag}
            accent="#fbbf24"
            name="RANGEFINDER"
            value={`${(rangefinderM ?? 0).toFixed(2)} m`}
            detail={`sample ${formatAge(telemetry.rangefinderSampleAgeSec)}`}
          />
        </>
      )}

      {debugSettings.sensorFrustums && rangeDirection && typeof rangefinderM === "number" && Number.isFinite(rangefinderM) && rangefinderM > 0 && (
        <SensorCone
          origin={rangefinderWorld}
          direction={rangeDirection}
          length={rangefinderM * 1000}
          radius={Math.max(10, rangefinderM * 1000 * 0.018)}
          color="#f59e0b"
          opacity={0.025 + rangePulse * 0.08}
        />
      )}

      {debugSettings.sensorOverlays && headingWorld && (
        <>
          <DebugLine points={[position, cgTag]} color="#94a3b8" opacity={0.28} />
          <SensorTag
            position={cgTag}
            accent="#94a3b8"
            name="FLIGHT STATE"
            value={`${(telemetry.speedMS ?? 0).toFixed(1)} m/s`}
            detail={`wind ${(telemetry.windMS ?? 0).toFixed(1)} · tw ${(telemetry.tw ?? 0).toFixed(2)}`}
          />
        </>
      )}

      {debugSettings.sensorOverlays && headingWorld && (
        <DebugArrow origin={position} vector={headingWorld.clone().multiplyScalar(180)} color="#c084fc" />
      )}

      {debugSettings.sensorFrustums && headingWorld && (
        <mesh position={sensorMastWorld.clone().add(new THREE.Vector3(0, 6, 0))} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[42, 50, 24]} />
          <meshBasicMaterial color="#7c3aed" transparent opacity={0.04 + magPulse * 0.06} side={THREE.DoubleSide} />
        </mesh>
      )}

      {debugSettings.sensorOverlays && bodyUpWorld && (
        <DebugArrow origin={position} vector={bodyUpWorld.clone().multiplyScalar(120)} color="#34d399" />
      )}

      {debugSettings.sensorOverlays && accelWorld && (
        <DebugArrow origin={position} vector={toMm(accelWorld, 42)} color="#f43f5e" scale={accelPulse} />
      )}

      {debugSettings.sensorOverlays && gyroWorld && gyroWorld.lengthSq() > 1e-6 && (
        <DebugArrow origin={position} vector={gyroWorld.clone().normalize().multiplyScalar(80 * gyroPulse)} color="#60a5fa" />
      )}

      {debugSettings.impactEvents && impactPoint && telemetry.lastImpactAgeSec !== undefined && telemetry.lastImpactAgeSec < 1.2 && (
        <>
          <mesh position={impactPoint}>
            <sphereGeometry args={[20 + impactPulse * 20, 16, 16]} />
            <meshBasicMaterial color="#fb7185" transparent opacity={0.2 + impactPulse * 0.65} />
          </mesh>
          {impactVector && (
            <DebugArrow origin={impactPoint} vector={impactVector} color="#fb7185" />
          )}
        </>
      )}

      {debugSettings.flightTrail && trailPoints.length > 1 && (
        <>
          <DebugLine points={trailPoints} color="#60a5fa" opacity={0.34} />
          {trailPoints.slice(0, -1).filter((_, index) => index % 4 === 0).map((trailPoint, index) => (
            <mesh key={`trail-point-${index}`} position={trailPoint}>
              <sphereGeometry args={[4, 8, 8]} />
              <meshBasicMaterial color="#60a5fa" transparent opacity={0.12 + index * 0.015} />
            </mesh>
          ))}
        </>
      )}
    </group>
  );
}
