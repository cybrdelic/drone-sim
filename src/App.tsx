import {
    OrbitControls,
} from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { AgXToneMapping, SRGBColorSpace, WebGPURenderer } from "three/webgpu";
import { DroneModel } from "./components/DroneModel";
import { Sidebar } from "./components/Sidebar";
import { WebgpuGridIntegration } from "./components/WebgpuGridIntegration";
import { DebugSettings, DroneParams, FlightTelemetry, SimSettings, ViewSettings } from "./types";

const LazyRapierDebugLines = lazy(() =>
  import("./components/RapierDebugLines").then((m) => ({
    default: m.RapierDebugLines,
  })),
);

type RapierBundle = {
  Physics: any;
  RigidBody: any;
  CuboidCollider: any;
};

type CameraMode = "chase" | "close" | "hood";

type PrintPackEntry = {
  name: string;
  qty: string;
  spec: string;
  fit: string;
};

function FlightCameraController({
  enabled,
  targetRef,
  mode,
}: {
  enabled: boolean;
  targetRef: React.RefObject<THREE.Group | null>;
  mode: CameraMode;
}) {
  const { camera } = useThree();
  const worldPos = useRef(new THREE.Vector3());
  const worldQuat = useRef(new THREE.Quaternion());
  const offset = useRef(new THREE.Vector3());
  const localOffset = useRef(new THREE.Vector3());
  const localFocus = useRef(new THREE.Vector3());
  const localBackward = useRef(new THREE.Vector3());
  const localRight = useRef(new THREE.Vector3());
  const localUp = useRef(new THREE.Vector3());
  const lookMatrix = useRef(new THREE.Matrix4());
  const localQuat = useRef(new THREE.Quaternion());
  const desiredQuat = useRef(new THREE.Quaternion());

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
      .crossVectors(new THREE.Vector3(0, 1, 0), localBackward.current)
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

    const desiredPosition = worldPos.current.clone().add(offset.current);

    camera.position.copy(desiredPosition);
    desiredQuat.current.copy(worldQuat.current).multiply(localQuat.current);
    camera.quaternion.copy(desiredQuat.current);
    camera.updateMatrixWorld();
  });

  return null;
}

const defaultParams: DroneParams = {
  frameSize: 210, // 5-inch standard
  plateThickness: 5,
  topPlateThickness: 2,
  standoffHeight: 25,
  armWidth: 14,
  fcMounting: 30.5,
  motorMountPattern: 16,
  motorCenterHole: 6,
  weightReduction: 40,
  propSize: 5.1,
  showTPU: true,
  tpuColor: "#0ea5e9",
  viewMode: "assembled",
};

export default function App() {
  const defaultFlightTelemetry = useMemo<FlightTelemetry>(() => ({
    throttle01: 0,
    thrustN: 0,
    weightN: 0,
    tw: 0,
    altitudeM: 0,
    speedMS: 0,
    airspeedMS: 0,
    windMS: 0,
    groundEffectMult: 1,
    batteryV: 0,
    batteryI: 0,
    armed: false,
  }), []);
  const [params, setParams] = useState<DroneParams>(defaultParams);
  const groupRef = useRef<THREE.Group>(null);
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const [rendererBackend, setRendererBackend] = useState<"webgpu" | "webgl2" | "unknown">(
    "unknown",
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPseudoFullscreen, setIsPseudoFullscreen] = useState(false);
  const [arePanelsVisible, setArePanelsVisible] = useState(true);
  const [isSnapshotPanelOpen, setIsSnapshotPanelOpen] = useState(false);
  const [isDetailsPanelOpen, setIsDetailsPanelOpen] = useState(false);
  const [waypoints, setWaypoints] = useState<THREE.Vector3[]>([]);
  const [isFlyingPath, setIsFlyingPath] = useState(false);
  const [flightResetToken, setFlightResetToken] = useState(0);
  const [controlSensitivity, setControlSensitivity] = useState(0.45);
  const [cameraMode, setCameraMode] = useState<CameraMode>("chase");
  const [debugSettings, setDebugSettings] = useState<DebugSettings>({
    physicsLines: false,
    flightTelemetry: false,
  });
  const [viewSettings, setViewSettings] = useState<ViewSettings>({
    wireframe: false,
    focus: "all",
    visibility: {
      frame: true,
      propulsion: true,
      electronics: true,
      accessories: true,
    },
  });
  const [simSettings, setSimSettings] = useState<SimSettings>({
    motorAudioEnabled: false,
    motorAudioVolume: 0.35,
    vibrationAmount: 0.35,
  });
  const [presetId, setPresetId] = useState<
    "oval" | "figure8" | "corkscrew" | "loop"
  >("oval");
  const flightTelemetryRef = useRef<FlightTelemetry>(defaultFlightTelemetry);
  const [flightTelemetry, setFlightTelemetry] = useState<FlightTelemetry>(
    flightTelemetryRef.current,
  );

  const glFactory = useCallback(async (props: { canvas: HTMLCanvasElement | OffscreenCanvas }) => {
    const renderer = new WebGPURenderer({
      canvas: props.canvas as any,
      antialias: true,
      alpha: true,
      logarithmicDepthBuffer: true,
    });

    await renderer.init();

    if (typeof (renderer as any).setClearColor === "function") {
      (renderer as any).setClearColor(0x000000, 0);
    }

    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = AgXToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;

    const backend = (renderer as any).backend;
    const isWebGPU = !!backend?.isWebGPUBackend || String(backend?.constructor?.name || "").toLowerCase().includes("webgpu");
    const isWebGL = !!backend?.isWebGLBackend || String(backend?.constructor?.name || "").toLowerCase().includes("webgl");
    setRendererBackend(isWebGPU ? "webgpu" : isWebGL ? "webgl2" : "unknown");

    return renderer as any;
  }, []);

  const paramsRef = useRef(params);
  const viewSettingsRef = useRef(viewSettings);
  const simSettingsRef = useRef(simSettings);
  const debugSettingsRef = useRef(debugSettings);
  const waypointsRef = useRef(waypoints);
  const isFlyingPathRef = useRef(isFlyingPath);

  useEffect(() => {
    paramsRef.current = params;
  }, [params]);
  useEffect(() => {
    viewSettingsRef.current = viewSettings;
  }, [viewSettings]);
  useEffect(() => {
    simSettingsRef.current = simSettings;
  }, [simSettings]);
  useEffect(() => {
    debugSettingsRef.current = debugSettings;
  }, [debugSettings]);
  useEffect(() => {
    waypointsRef.current = waypoints;
  }, [waypoints]);
  useEffect(() => {
    isFlyingPathRef.current = isFlyingPath;
  }, [isFlyingPath]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);
      if (active) {
        setIsPseudoFullscreen(false);
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    handleFullscreenChange();

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (isPseudoFullscreen) {
        setIsPseudoFullscreen(false);
      } else {
        const target = (appShellRef.current ?? document.documentElement) as HTMLElement & {
          webkitRequestFullscreen?: () => Promise<void> | void;
        };

        if (document.fullscreenEnabled && typeof target.requestFullscreen === "function") {
          await target.requestFullscreen();
        } else if (typeof target.webkitRequestFullscreen === "function") {
          await target.webkitRequestFullscreen();
        } else {
          setIsPseudoFullscreen(true);
        }
      }
    } catch {
      setIsPseudoFullscreen(true);
    }
  }, [isPseudoFullscreen]);

  useEffect(() => {
    if (!isPseudoFullscreen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsPseudoFullscreen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isPseudoFullscreen]);

  useEffect(() => {
    // Debug-bridge client: silently attaches to the local MCP debug server.
    // No UI, no console steps required. Safe to run even if the server isn't present.
    let ws: WebSocket | null = null;
    let stopped = false;
    let retry = 0;
    const BRIDGE_VERSION = 2;
    let lastPatchAppliedMs = 0;
    let lastPatchKeys: string[] = [];
    let lastPatchSummary = "";
    let lastPatchMetaSummary = "";

    const safeSummary = (value: any, maxLen = 1800) => {
      try {
        const s = JSON.stringify(
          value,
          (_k, v) => {
            if (typeof v === "function") return "[Function]";
            if (typeof AbortSignal !== "undefined" && v instanceof AbortSignal) {
              return `[AbortSignal aborted=${v.aborted}]`;
            }
            if (v instanceof Error) return `[Error ${v.message}]`;
            if (v && typeof v === "object") {
              const ctor = (v as any)?.constructor?.name;
              if (ctor && ctor !== "Object" && ctor !== "Array") return `[${ctor}]`;
            }
            return v;
          },
          2,
        );
        return typeof s === "string" ? s.slice(0, maxLen) : String(s);
      } catch {
        try {
          return String(value).slice(0, maxLen);
        } catch {
          return "[Unserializable]";
        }
      }
    };

    const respond = (id: string, payload: any) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ id, ...payload }));
    };

    const snapshot = () => {
      return {
        debugBridge: {
          version: BRIDGE_VERSION,
          lastPatchAppliedMs,
          lastPatchKeys,
          lastPatchSummary,
          lastPatchMetaSummary,
        },
        params: paramsRef.current,
        viewSettings: viewSettingsRef.current,
        simSettings: simSettingsRef.current,
        debugSettings: debugSettingsRef.current,
        waypoints: waypointsRef.current.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        isFlyingPath: isFlyingPathRef.current,
        flightTelemetry: flightTelemetryRef.current,
      };
    };

    const applyPatch = (patch: any) => {
      // Some tool runners wrap the actual patch under `signal` and attach metadata.
      // Accept both shapes:
      // - { params, viewSettings, ... }
      // - { signal: { params, ... }, _meta, requestId }
      lastPatchSummary = safeSummary(patch);
      lastPatchMetaSummary = safeSummary(patch?._meta);

      const effectivePatch = patch;

      lastPatchAppliedMs = Date.now();
      lastPatchKeys =
        effectivePatch && typeof effectivePatch === "object"
          ? Object.keys(effectivePatch)
          : [];
      // Keep both React state and the snapshot refs in sync.
      // This makes MCP reads immediately reflect MCP writes, even before effects run.
      if (effectivePatch?.params) {
        const next = { ...paramsRef.current, ...effectivePatch.params };
        paramsRef.current = next;
        setParams(next);
      }
      if (effectivePatch?.viewSettings) {
        const next = { ...viewSettingsRef.current, ...effectivePatch.viewSettings };
        viewSettingsRef.current = next;
        setViewSettings(next);
      }
      if (effectivePatch?.simSettings) {
        const next = { ...simSettingsRef.current, ...effectivePatch.simSettings };
        simSettingsRef.current = next;
        setSimSettings(next);
      }
      if (effectivePatch?.debugSettings) {
        const next = { ...debugSettingsRef.current, ...effectivePatch.debugSettings };
        debugSettingsRef.current = next;
        setDebugSettings(next);
      }
      if (Array.isArray(effectivePatch?.waypoints)) {
        const next = effectivePatch.waypoints.map(
          (p: any) => new THREE.Vector3(p.x, p.y, p.z),
        );
        waypointsRef.current = next;
        setWaypoints(next);
      }
      if (typeof effectivePatch?.isFlyingPath === "boolean") {
        isFlyingPathRef.current = effectivePatch.isFlyingPath;
        setIsFlyingPath(effectivePatch.isFlyingPath);
      }
    };

    const connect = () => {
      if (stopped) return;
      const delay = Math.min(2000, 150 * Math.pow(1.6, retry++));

      try {
        ws = new WebSocket("ws://127.0.0.1:8787");
      } catch {
        window.setTimeout(connect, delay);
        return;
      }

      ws.onopen = () => {
        retry = 0;
        try {
          ws?.send(
            JSON.stringify({
              type: "hello",
              client: "drone-sim",
              ts: Date.now(),
              href: typeof window !== "undefined" ? window.location.href : undefined,
            }),
          );
        } catch {
          // ignore
        }
      };

      ws.onmessage = (ev) => {
        const raw = typeof ev.data === "string" ? ev.data : "";
        let msg: any;
        try {
          msg = JSON.parse(raw);
        } catch {
          return;
        }

        const id = typeof msg?.id === "string" ? msg.id : null;
        if (!id) return;

        // Support alternate envelopes from debug tooling.
        // Some tools send { command: { type, ... } } instead of { type, ... }.
        const command = msg?.command && typeof msg.command === "object" ? msg.command : msg;
        const type = command?.type;

        // Compatibility: some tool runners fail to forward tool arguments and we may receive
        // a message with only an id (no command/type). Treat that as a get_state request so
        // the tooling remains usable.
        const topLevelKeys = msg && typeof msg === "object" ? Object.keys(msg) : [];
        if (!type && topLevelKeys.length === 1 && topLevelKeys[0] === "id") {
          respond(id, { ok: true, state: snapshot() });
          return;
        }

        if (type === "get_state") {
          respond(id, { ok: true, state: snapshot() });
          return;
        }

        if (type === "set_state") {
          try {
            // Accept either { patch: {...} } or a direct patch payload.
            applyPatch(command.patch ?? command ?? {});
            // Respond with a snapshot so tool callers can verify that the patch stuck.
            respond(id, { ok: true, state: snapshot() });
          } catch (e: any) {
            respond(id, { ok: false, error: e?.message ?? String(e) });
          }
          return;
        }

        respond(id, {
          ok: false,
          error: `Unknown command (type=${String(type)})`,
          received: {
            topLevelKeys,
            commandKeys:
              command && typeof command === "object" ? Object.keys(command as any) : [],
          },
        });
      };

      ws.onclose = () => {
        if (stopped) return;
        window.setTimeout(connect, delay);
      };

      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
          // ignore
        }
      };
    };

    connect();
    return () => {
      stopped = true;
      try {
        ws?.close();
      } catch {
        // ignore
      }
    };
  }, []);

  useEffect(() => {
    const shouldStreamTelemetry =
      arePanelsVisible &&
      params.viewMode === "flight_sim" &&
      debugSettings.flightTelemetry;

    if (!shouldStreamTelemetry) return;

    const id = window.setInterval(() => {
      setFlightTelemetry({ ...flightTelemetryRef.current });
    }, 200);

    return () => window.clearInterval(id);
  }, [arePanelsVisible, debugSettings.flightTelemetry, params.viewMode]);

  const presetWaypoints = useMemo(() => {
    // Generate in world coordinates (mm). DroneModel autopilot converts to meters internally.
    const r = Math.max(300, params.frameSize * 2); // mm
    const h = Math.max(250, params.frameSize * 1.2); // mm

    const makeOval = () => {
      const pts: THREE.Vector3[] = [];
      const n = 36;
      const rx = r * 1.2;
      const rz = r * 0.8;
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(t) * rx, 220, Math.sin(t) * rz));
      }
      return pts;
    };

    const makeFigure8 = () => {
      const pts: THREE.Vector3[] = [];
      const n = 60;
      // Lemniscate-ish in XZ
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * Math.PI * 2;
        const denom = 1 + Math.sin(t) * Math.sin(t);
        const x = (r * Math.cos(t)) / denom;
        const z = (r * Math.sin(t) * Math.cos(t)) / denom;
        pts.push(new THREE.Vector3(x * 1.6, 240, z * 2.2));
      }
      return pts;
    };

    const makeCorkscrew = () => {
      const pts: THREE.Vector3[] = [];
      const turns = 2.5;
      const n = 80;
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * Math.PI * 2 * turns;
        const y = 140 + (i / n) * h;
        pts.push(new THREE.Vector3(Math.cos(t) * r, y, Math.sin(t) * r));
      }
      return pts;
    };

    const makeVerticalLoop = () => {
      const pts: THREE.Vector3[] = [];
      const n = 44;
      const loopR = Math.max(220, r * 0.75);
      // Loop in YZ plane, moving forward in Z while looping
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * Math.PI * 2;
        const y = 200 + Math.sin(t) * loopR;
        const z = -r * 0.6 + Math.cos(t) * loopR;
        pts.push(new THREE.Vector3(0, Math.max(40, y), z));
      }
      return pts;
    };

    const presets = {
      oval: makeOval(),
      figure8: makeFigure8(),
      corkscrew: makeCorkscrew(),
      loop: makeVerticalLoop(),
    } as const;

    return presets;
  }, [params.frameSize]);

  const flightPathPoints = useMemo(() => {
    if (waypoints.length < 2) return [];
    return waypoints.map(
      (p) => new THREE.Vector3(p.x, Math.max(p.y + 20, 20), p.z),
    );
  }, [waypoints]);

  const flightPathLine = useMemo(() => {
    if (flightPathPoints.length < 2) return null;
    const geometry = new THREE.BufferGeometry().setFromPoints(flightPathPoints);
    const material = new THREE.LineBasicMaterial({ color: "#10b981" });
    return new THREE.Line(geometry, material);
  }, [flightPathPoints]);

  useEffect(() => {
    return () => {
      if (!flightPathLine) return;
      flightPathLine.geometry.dispose();
      if (Array.isArray(flightPathLine.material)) {
        for (const material of flightPathLine.material) material.dispose();
      } else {
        flightPathLine.material.dispose();
      }
    };
  }, [flightPathLine]);

  const handleExport = () => {
    (async () => {
      if (!groupRef.current) return;
      const mod = await import("three/examples/jsm/exporters/STLExporter.js");
      const exporter = new mod.STLExporter();
      const stlString = exporter.parse(groupRef.current);
      const blob = new Blob([stlString], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.style.display = "none";
      link.href = url;
      link.download = `aeroforge_production_${params.frameSize}mm.stl`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    })();
  };

  // Rigorous Engineering & Kinematics Calculations
  const engData = useMemo(() => {
    // 1. Frame Volume & Weight (Heuristic based on CSG operations)
    const centerRadius = params.fcMounting / 2 + 10;
    const armLength = params.frameSize / 2;

    const centerVol =
      Math.PI * Math.pow(centerRadius, 2) * params.plateThickness;
    const armVol = 4 * (armLength * params.armWidth * params.plateThickness);
    const topPlateVol =
      (params.fcMounting + 12) *
      (params.fcMounting + 30) *
      params.topPlateThickness;

    // Subtractions
    const cutoutVol =
      4 *
      (armLength *
        0.5 *
        (params.armWidth * (params.weightReduction / 100) * 0.7) *
        params.plateThickness);
    const motorHoleVol =
      4 *
      (Math.PI *
        Math.pow(params.motorCenterHole / 2, 2) *
        params.plateThickness);

    const totalCarbonVol_mm3 =
      centerVol + armVol + topPlateVol - cutoutVol - motorHoleVol;
    const carbonDensity_g_mm3 = 0.0016; // 1.6 g/cm3 for Toray T700 3K Carbon Fiber
    const frameWeight_g = totalCarbonVol_mm3 * carbonDensity_g_mm3;

    // 2. Hardware Weights (Estimated based on prop/frame class)
    const motorWeight =
      params.propSize >= 7 ? 45 : params.propSize >= 5 ? 32 : 12;
    const batteryWeight =
      params.propSize >= 7 ? 250 : params.propSize >= 5 ? 180 : 65;
    const stackWeight = 18;
    const propWeight = params.propSize * 0.8;

    const auw_g =
      frameWeight_g +
      motorWeight * 4 +
      batteryWeight +
      stackWeight +
      propWeight * 4 +
      20; // +20g for wires/screws

    // 3. Thrust & Lift (Empirical approximation)
    const thrustPerMotor_g = Math.pow(params.propSize, 2.8) * 12;
    const totalThrust_g = thrustPerMotor_g * 4;
    const twRatio = totalThrust_g / auw_g;
    const hoverThrottle = (auw_g / totalThrust_g) * 100;

    // 4. Stress & Tension (Arm Root Bending Moment)
    const force_N = (thrustPerMotor_g / 1000) * 9.81; // Max thrust force per arm
    const moment_Nmm = force_N * armLength;
    // Section modulus for rectangular cross section: (b * h^2) / 6
    const sectionModulus_mm3 =
      (params.armWidth * Math.pow(params.plateThickness, 2)) / 6;
    const maxStress_MPa = moment_Nmm / sectionModulus_mm3;

    const cfYieldStrength_MPa = 600; // Standard 3K carbon fiber tensile yield
    const safetyFactor = cfYieldStrength_MPa / maxStress_MPa;

    return {
      frameWeight_g,
      auw_g,
      totalThrust_g,
      twRatio,
      hoverThrottle,
      maxStress_MPa,
      safetyFactor,
    };
  }, [params]);

  const isPrintLayoutView = params.viewMode === "print_layout";
  const printPack = useMemo(() => {
    const centerRadius = params.fcMounting / 2 + 10;
    const motorPadRadius = params.motorMountPattern / 2 + 3.5;
    const bottomPlateSpan = Math.SQRT1_2 * params.frameSize + motorPadRadius * 2 + 12;
    const topPlateWidth = params.fcMounting + 12;
    const topPlateDepth = params.fcMounting + 30;
    const carbonSheetSize = Math.max(
      300,
      Math.ceil(bottomPlateSpan + topPlateWidth + 72),
    );
    const strapPitch = centerRadius * 1.4;
    const isM3Motor = params.motorMountPattern >= 16;

    const carbonParts: PrintPackEntry[] = [
      {
        name: "Unibody bottom plate",
        qty: "1x",
        spec: `${bottomPlateSpan.toFixed(0)} mm envelope • ${params.plateThickness.toFixed(1)} mm carbon`,
        fit: `${params.motorMountPattern.toFixed(1)}×${params.motorMountPattern.toFixed(1)} mm motor pattern • ${params.motorCenterHole.toFixed(1)} mm center relief`,
      },
      {
        name: "Top plate",
        qty: "1x",
        spec: `${topPlateWidth.toFixed(1)} × ${topPlateDepth.toFixed(1)} mm • ${params.topPlateThickness.toFixed(1)} mm carbon`,
        fit: `${params.fcMounting.toFixed(1)}×${params.fcMounting.toFixed(1)} mm stack • strap slot pitch ${strapPitch.toFixed(1)} mm`,
      },
    ];

    const tpuParts: PrintPackEntry[] = params.showTPU
      ? [
          {
            name: "FPV camera cradle",
            qty: "3 pcs",
            spec: "2 side cheeks + 1 floor rail, all laid flat",
            fit: "19×19 mm micro camera envelope • 22 mm support faces",
          },
          {
            name: "Action cam mount",
            qty: "5 pcs",
            spec: "Base, twin forks, 2 cam lugs separated for clean printing",
            fit: "24×20 mm base • 15 mm fork faces • 15 mm lug discs",
          },
          {
            name: "Antenna mount pack",
            qty: "4 pcs",
            spec: "Rear bridge, VTX tube, 2 RX tubes",
            fit: `${params.standoffHeight.toFixed(0)} mm bridge length reference • 20/30 mm tube lengths`,
          },
          {
            name: "Motor bumpers",
            qty: "4 pcs",
            spec: "Separated TPU guards with cooling gap between copies",
            fit: `${(params.motorMountPattern / 2 + 4.5).toFixed(1)} mm inner radius target`,
          },
        ]
      : [];

    const referenceParts: PrintPackEntry[] = [
      {
        name: "Frame standoffs / spacers",
        qty: "4x",
        spec: `Purchased aluminum hex standoffs • M3 × ${params.standoffHeight.toFixed(0)} mm`,
        fit: `3.2 mm plate clearance • ${params.fcMounting.toFixed(1)}×${params.fcMounting.toFixed(1)} mm bolt square`,
      },
      {
        name: "Propellers",
        qty: "4x",
        spec: `Purchased ${params.propSize.toFixed(1)} in tri-blades; not included in print pack`,
        fit: "13 mm hub OD • 7 mm hub height • 4.4 mm modeled shaft land • 8 mm nyloc nut envelope",
      },
      {
        name: "Motors",
        qty: "4x",
        spec: `Purchased outrunners • ${params.motorMountPattern.toFixed(1)}×${params.motorMountPattern.toFixed(1)} mm bolt pattern`,
        fit: `${isM3Motor ? "M3" : "M2"} fasteners • ${params.motorCenterHole.toFixed(1)} mm center relief through arm pads`,
      },
      {
        name: "FC stack hardware",
        qty: "1 set",
        spec: `Purchased ${params.fcMounting.toFixed(1)}×${params.fcMounting.toFixed(1)} mm stack + screws/grommets`,
        fit: "4× M3 clearance holes • 14 mm screw shaft in model • nyloc top lock",
      },
      {
        name: "Battery retention",
        qty: "2x",
        spec: "Purchased nylon straps; not printed",
        fit: `20 × 3 mm slots on top plate • ${strapPitch.toFixed(1)} mm slot pitch`,
      },
    ];

    return {
      carbonSheetSize,
      tpuBedSize: 220,
      strapPitch,
      carbonParts,
      tpuParts,
      referenceParts,
    };
  }, [params]);

  const rapierCacheRef = useRef<RapierBundle | null>(null);
  const rapierLoadPromiseRef = useRef<Promise<RapierBundle> | null>(null);
  const [rapier, setRapier] = useState<RapierBundle | null>(null);
  const needsRapier = params.viewMode === "flight_sim" || debugSettings.physicsLines;
  const isFlightSimView = params.viewMode === "flight_sim";
  const rendererLabel =
    rendererBackend === "webgpu"
      ? "WebGPU"
      : rendererBackend === "webgl2"
        ? "WebGL2 Fallback"
        : "Unknown";
  const snapshotClass =
    params.frameSize >= 250 ? "7-inch" : params.frameSize >= 200 ? "5-inch" : "3-inch";
  const isImmersive = isFullscreen || isPseudoFullscreen;
  const cameraModeLabel =
    cameraMode === "hood" ? "Hood Cam" : cameraMode === "close" ? "Close Chase" : "Far Chase";

  const handleResetFlight = useCallback(() => {
    setIsFlyingPath(false);
    flightTelemetryRef.current = { ...defaultFlightTelemetry };
    setFlightTelemetry({ ...defaultFlightTelemetry });
    setFlightResetToken((token) => token + 1);
  }, [defaultFlightTelemetry]);

  useEffect(() => {
    let cancelled = false;

    if (!needsRapier) {
      // Keep the module cached for fast re-entry into flight_sim,
      // but avoid mounting the physics tree.
      setRapier(null);
      return () => {
        cancelled = true;
      };
    }

    if (rapierCacheRef.current) {
      setRapier(rapierCacheRef.current);
      return () => {
        cancelled = true;
      };
    }

    const promise =
      rapierLoadPromiseRef.current ??
      (rapierLoadPromiseRef.current = import("@react-three/rapier").then((m) => {
        const bundle: RapierBundle = {
          Physics: (m as any).Physics,
          RigidBody: (m as any).RigidBody,
          CuboidCollider: (m as any).CuboidCollider,
        };
        rapierCacheRef.current = bundle;
        return bundle;
      }));

    promise
      .then((bundle) => {
        if (cancelled) return;
        setRapier(bundle);
      })
      .catch(() => {
        if (cancelled) return;
        setRapier(null);
      });

    return () => {
      cancelled = true;
    };
  }, [needsRapier]);

  return (
    <div ref={appShellRef} className={`drone-app-shell flex h-screen w-full overflow-hidden font-sans text-neutral-200${isImmersive ? " is-fullscreen" : ""}`}>
      {arePanelsVisible && (
        <Sidebar
          params={params}
          onChange={setParams}
          onExport={handleExport}
          viewSettings={viewSettings}
          onViewSettingsChange={setViewSettings}
          simSettings={simSettings}
          onSimSettingsChange={setSimSettings}
          debugSettings={debugSettings}
          onDebugSettingsChange={setDebugSettings}
          flightTelemetry={flightTelemetry}
        />
      )}

      <main className="app-main-shell">
        <div className="app-main-column">
          <header className="app-toolbar">
            <div className="app-toolbar-group">
              <div className="app-title-block">
                <div className="app-title">Drone Sim</div>
                <div className="app-subtitle">Viewport workspace</div>
              </div>
              <div className="chrome-meta">
                <span className="status-label">Mode</span>
                <span className="status-value">{params.viewMode.replace("_", " ")}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setArePanelsVisible((prev) => {
                    if (prev) {
                      setIsSnapshotPanelOpen(false);
                      setIsDetailsPanelOpen(false);
                    }

                    return !prev;
                  });
                }}
                className="toolbar-chip toolbar-chip-primary"
              >
                {arePanelsVisible ? "Hide Inspector" : "Show Inspector"}
              </button>
              {arePanelsVisible && (
                <>
                  <button
                    type="button"
                    onClick={() => setIsSnapshotPanelOpen((prev) => !prev)}
                    className={isSnapshotPanelOpen ? "toolbar-chip toolbar-chip-primary" : "toolbar-chip"}
                  >
                    Snapshot
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsDetailsPanelOpen((prev) => !prev)}
                    className={isDetailsPanelOpen ? "toolbar-chip toolbar-chip-primary" : "toolbar-chip"}
                  >
                    Details
                  </button>
                </>
              )}
            </div>
            <div className="app-toolbar-group justify-end">
              {isFlightSimView && (
                <>
                  <div className="chrome-meta">
                    <span className="status-label">Camera</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setCameraMode("chase")}
                        className={cameraMode === "chase" ? "toolbar-chip toolbar-chip-primary" : "toolbar-chip"}
                      >
                        Chase
                      </button>
                      <button
                        type="button"
                        onClick={() => setCameraMode("close")}
                        className={cameraMode === "close" ? "toolbar-chip toolbar-chip-primary" : "toolbar-chip"}
                      >
                        Close
                      </button>
                      <button
                        type="button"
                        onClick={() => setCameraMode("hood")}
                        className={cameraMode === "hood" ? "toolbar-chip toolbar-chip-primary" : "toolbar-chip"}
                      >
                        Hood
                      </button>
                    </div>
                  </div>
                  <select
                    value={presetId}
                    onChange={(e) => setPresetId(e.target.value as any)}
                    disabled={isFlyingPath}
                    className="ui-select chrome-select disabled:opacity-50"
                  >
                    <option value="oval">Oval</option>
                    <option value="figure8">Figure 8</option>
                    <option value="corkscrew">Corkscrew</option>
                    <option value="loop">Vertical Loop</option>
                  </select>
                  <div className="chrome-meta chrome-control">
                    <span className="status-label">Control</span>
                    <input
                      type="range"
                      min={0.2}
                      max={1}
                      step={0.05}
                      value={controlSensitivity}
                      onChange={(e) => setControlSensitivity(parseFloat(e.target.value))}
                      disabled={isFlyingPath}
                      className="ui-slider chrome-slider cursor-pointer disabled:opacity-50"
                    />
                    <span className="status-value">{(controlSensitivity * 100).toFixed(0)}%</span>
                  </div>
                  <button
                    className="toolbar-chip disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => setWaypoints(presetWaypoints[presetId].map((p) => p.clone()))}
                    disabled={isFlyingPath}
                  >
                    Load
                  </button>
                  <button
                    className="toolbar-chip disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => setWaypoints([])}
                    disabled={isFlyingPath}
                  >
                    Clear
                  </button>
                  <button
                    className="toolbar-chip"
                    onClick={handleResetFlight}
                  >
                    Reset
                  </button>
                  <button
                    className="toolbar-chip toolbar-chip-primary disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => setIsFlyingPath(true)}
                    disabled={waypoints.length < 2 || isFlyingPath}
                  >
                    {isFlyingPath ? "Flying" : "Fly"}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  void toggleFullscreen();
                }}
                className="toolbar-chip"
              >
                {isImmersive ? "Exit Fullscreen" : "Fullscreen"}
              </button>
            </div>
          </header>

          <section className="etched-panel viewport-shell cursor-move">
            {arePanelsVisible && isSnapshotPanelOpen && (
            <div className="viewport-dock viewport-dock-left">
              <div className="etched-panel viewport-panel">
                {isPrintLayoutView ? (
                  <>
                    <div className="kicker mb-2">Fabrication Snapshot</div>
                    <h2 className="text-xs font-semibold tracking-[0.02em] text-neutral-100 mb-3 uppercase">
                      Print Pack Summary
                    </h2>
                    <div className="grid grid-cols-2 gap-x-5 gap-y-2 text-[11px] font-mono text-white/70">
                      <div>CARBON STOCK</div>
                      <div className="text-neutral-100 text-right">
                        {printPack.carbonSheetSize} mm
                      </div>

                      <div>TPU BED</div>
                      <div className="text-neutral-100 text-right">
                        {printPack.tpuBedSize} mm
                      </div>

                      <div>CARBON PARTS</div>
                      <div className="text-neutral-100 text-right">
                        {printPack.carbonParts.length}
                      </div>

                      <div>TPU PARTS</div>
                      <div className="text-neutral-100 text-right">
                        {printPack.tpuParts.length}
                      </div>

                      <div>REF HARDWARE</div>
                      <div className="text-neutral-100 text-right">
                        {printPack.referenceParts.length}
                      </div>

                      <div>STRAP PITCH</div>
                      <div className="text-[#dbe8ff] text-right">
                        {printPack.strapPitch.toFixed(1)} mm
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="kicker mb-2">System Snapshot</div>
                    <h2 className="text-xs font-semibold tracking-[0.02em] text-neutral-100 mb-3 uppercase">
                      Frame Specifications
                    </h2>
                    <div className="grid grid-cols-2 gap-x-5 gap-y-2 text-[11px] font-mono text-white/70">
                      <div>CLASS</div>
                      <div className="text-[#dbe8ff] text-right">
                        {params.frameSize >= 250
                          ? "7-INCH"
                          : params.frameSize >= 200
                            ? "5-INCH"
                            : "3-INCH"}
                      </div>

                      <div>DIAGONAL</div>
                      <div className="text-neutral-100 text-right">
                        {params.frameSize.toFixed(1)} mm
                      </div>

                      <div>STACK</div>
                      <div className="text-neutral-100 text-right">
                        {params.fcMounting}x{params.fcMounting} mm
                      </div>

                      <div>MOTORS</div>
                      <div className="text-neutral-100 text-right">
                        {params.motorMountPattern}x{params.motorMountPattern} mm
                      </div>

                      <div>Z-HEIGHT</div>
                      <div className="text-neutral-100 text-right">
                        {(
                          params.plateThickness +
                          params.standoffHeight +
                          params.topPlateThickness
                        ).toFixed(1)}{" "}
                        mm
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
            )}

            {arePanelsVisible && isDetailsPanelOpen && (
            <div className="viewport-dock viewport-dock-right">
              <div className="etched-panel viewport-panel w-[300px]">
                {isPrintLayoutView ? (
                  <>
                    <h2 className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/60 mb-4 flex items-center gap-2">
                      <div className="w-1.5 h-1.5 bg-[#34d399]" />
                      Print Pack & BOM
                    </h2>

                    <div className="space-y-4 text-[11px] font-mono text-white/75">
                      <div>
                        <div className="text-[9px] text-white/45 mb-2 uppercase tracking-[0.14em]">
                          Carbon Cut Sheet
                        </div>
                        <div className="space-y-2">
                          {printPack.carbonParts.map((part) => (
                            <div key={part.name} className="rounded-sm border border-white/8 bg-black/10 p-2">
                              <div className="flex items-start justify-between gap-3 text-neutral-100">
                                <span>{part.name}</span>
                                <span className="text-[#dbe8ff]">{part.qty}</span>
                              </div>
                              <div className="mt-1 text-white/55">{part.spec}</div>
                              <div className="mt-1 text-emerald-300/85">{part.fit}</div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="text-[9px] text-white/45 mb-2 uppercase tracking-[0.14em]">
                          TPU Print Pack
                        </div>
                        {printPack.tpuParts.length > 0 ? (
                          <div className="space-y-2">
                            {printPack.tpuParts.map((part) => (
                              <div key={part.name} className="rounded-sm border border-white/8 bg-black/10 p-2">
                                <div className="flex items-start justify-between gap-3 text-neutral-100">
                                  <span>{part.name}</span>
                                  <span className="text-[#dbe8ff]">{part.qty}</span>
                                </div>
                                <div className="mt-1 text-white/55">{part.spec}</div>
                                <div className="mt-1 text-emerald-300/85">{part.fit}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-sm border border-dashed border-white/10 bg-black/10 p-2 text-white/45">
                            TPU accessories are disabled, so the print bed only carries carbon references.
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="text-[9px] text-white/45 mb-2 uppercase tracking-[0.14em]">
                          Reference Hardware / Adapters
                        </div>
                        <div className="space-y-2">
                          {printPack.referenceParts.map((part) => (
                            <div key={part.name} className="rounded-sm border border-white/8 bg-black/10 p-2">
                              <div className="flex items-start justify-between gap-3 text-neutral-100">
                                <span>{part.name}</span>
                                <span className="text-[#dbe8ff]">{part.qty}</span>
                              </div>
                              <div className="mt-1 text-white/55">{part.spec}</div>
                              <div className="mt-1 text-amber-300/85">{part.fit}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <h2 className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/60 mb-4 flex items-center gap-2">
                      <div className="w-1.5 h-1.5 bg-[#729ad6]" />
                      Engineering & Kinematics
                    </h2>

                    <div className="space-y-4">
                      <div>
                        <div className="text-[9px] text-white/45 mb-1.5 uppercase tracking-[0.14em]">
                          Material Specs
                        </div>
                        <div className="grid grid-cols-2 gap-1 text-[11px] font-mono">
                          <div className="text-white/45">COMPOSITE</div>
                          <div className="text-neutral-100 text-right">
                            Toray T700 3K
                          </div>
                          <div className="text-white/45">DENSITY</div>
                          <div className="text-neutral-100 text-right">1.60 g/cm³</div>
                          <div className="text-white/45">TOLERANCE</div>
                          <div className="text-neutral-100 text-right">±0.05 mm</div>
                        </div>
                      </div>

                      <div>
                        <div className="text-[9px] text-neutral-500 mb-1.5 uppercase tracking-wider">
                          Mass Analysis
                        </div>
                        <div className="grid grid-cols-2 gap-1 text-[11px] font-mono">
                          <div className="text-neutral-400">DRY FRAME</div>
                          <div className="text-neutral-200 text-right">
                            {engData.frameWeight_g.toFixed(1)} g
                          </div>
                          <div className="text-neutral-400">EST. AUW</div>
                          <div className="text-neutral-200 text-right">
                            {engData.auw_g.toFixed(1)} g
                          </div>
                        </div>
                      </div>

                      <div>
                        <div className="text-[9px] text-neutral-500 mb-1.5 uppercase tracking-wider">
                          Aerodynamics (Max)
                        </div>
                        <div className="grid grid-cols-2 gap-1 text-[11px] font-mono">
                          <div className="text-neutral-400">TOTAL LIFT</div>
                          <div className="text-neutral-200 text-right">
                            {engData.totalThrust_g.toFixed(0)} g
                          </div>
                          <div className="text-neutral-400">T/W RATIO</div>
                          <div className="text-emerald-400 text-right">
                            {engData.twRatio.toFixed(2)} : 1
                          </div>
                          <div className="text-neutral-400">HOVER THR.</div>
                          <div className="text-neutral-200 text-right">
                            {engData.hoverThrottle.toFixed(1)} %
                          </div>
                        </div>
                      </div>

                      <div>
                        <div className="text-[9px] text-neutral-500 mb-1.5 uppercase tracking-wider">
                          Structural Integrity
                        </div>
                        <div className="grid grid-cols-2 gap-1 text-[11px] font-mono">
                          <div className="text-neutral-400">ARM TENSION</div>
                          <div className="text-neutral-200 text-right">
                            {engData.maxStress_MPa.toFixed(1)} MPa
                          </div>
                          <div className="text-neutral-400">YIELD STRENGTH</div>
                          <div className="text-neutral-200 text-right">600.0 MPa</div>
                          <div className="text-neutral-400">SAFETY FACTOR</div>
                          <div
                            className={`text-right font-bold ${engData.safetyFactor < 1.5 ? "text-rose-500" : engData.safetyFactor < 3 ? "text-yellow-500" : "text-emerald-500"}`}
                          >
                            {engData.safetyFactor.toFixed(2)}x
                          </div>
                        </div>
                        <div className="mt-2 h-1.5 w-full bg-neutral-800 rounded-sm overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${engData.safetyFactor < 1.5 ? "bg-rose-500" : engData.safetyFactor < 3 ? "bg-yellow-500" : "bg-emerald-500"}`}
                            style={{
                              width: `${Math.min((600 / engData.maxStress_MPa) * 20, 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
            )}
            <div className="viewport-canvas">
        <Canvas
          frameloop={isFlightSimView ? "always" : "demand"}
          dpr={isFlightSimView ? [1, 1.1] : [1, 1.45]}
          camera={{
            // Frame the quad at a usable default distance in the sim's mm world.
            position: [2600, 1450, 2600],
            fov: 55,
            near: 5,
            far: 300000,
          }}
          onCreated={({ camera, scene }) => {
            scene.background = null;
            camera.updateProjectionMatrix();
          }}
          gl={glFactory as any}
          shadows={!isFlightSimView}
        >
          {isFlightSimView ? (
            <>
              <ambientLight intensity={1.2} />
              <hemisphereLight intensity={0.7} color="#f8fafc" groundColor="#334155" />
              <directionalLight position={[4000, 6000, 2500]} intensity={1.8} />
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1, 0]}>
                <planeGeometry args={[120000, 120000]} />
                <meshStandardMaterial color="#2b3138" roughness={1} metalness={0} />
              </mesh>
              <gridHelper
                args={[120000, 120, "#475569", "#2a3037"]}
                position={[0, 2, 0]}
              />
            </>
          ) : (
            <WebgpuGridIntegration unitScale={1000} />
          )}

          {isFlightSimView ? (
            rapier ? (
              <rapier.Physics gravity={[0, -9810, 0]}>
                {debugSettings.physicsLines && (
                  <Suspense fallback={null}>
                    <LazyRapierDebugLines />
                  </Suspense>
                )}
                {/* Ground collider (scene units are mm) */}
                <rapier.RigidBody type="fixed" friction={1.2} restitution={0.05}>
                  <rapier.CuboidCollider
                    args={[50000, 50, 50000]}
                    position={[0, -50, 0]}
                  />
                </rapier.RigidBody>

                <DroneModel
                  params={params}
                  viewSettings={viewSettings}
                  simSettings={simSettings}
                  groupRef={groupRef}
                  flightTelemetryRef={flightTelemetryRef}
                  rapier={{
                    RigidBody: rapier.RigidBody,
                    CuboidCollider: rapier.CuboidCollider,
                  }}
                  resetToken={flightResetToken}
                  waypoints={waypoints}
                  isFlyingPath={isFlyingPath}
                  onFlightComplete={() => setIsFlyingPath(false)}
                  controlSensitivity={controlSensitivity}
                />

                <mesh
                  rotation={[-Math.PI / 2, 0, 0]}
                  position={[0, 0, 0]}
                  visible={false}
                  onPointerDown={(e) => {
                    if (!isFlyingPath) {
                      setWaypoints([...waypoints, e.point]);
                    }
                  }}
                >
                  <planeGeometry args={[2000, 2000]} />
                  <meshBasicMaterial />
                </mesh>

                {waypoints.length > 0 && (
                  <group>
                    {waypoints.length > 1 && (
                      <primitive object={flightPathLine} dispose={null} />
                    )}
                    {waypoints.map((wp, i) => (
                      <mesh
                        key={i}
                        position={[wp.x, Math.max(wp.y + 20, 20), wp.z]}
                      >
                        <sphereGeometry args={[3, 16, 16]} />
                        <meshStandardMaterial
                          color={i === 0 ? "#ffffff" : "#10b981"}
                        />
                      </mesh>
                    ))}
                  </group>
                )}
              </rapier.Physics>
            ) : (
              // Rapier is still loading; show the model immediately.
              <DroneModel
                params={params}
                viewSettings={viewSettings}
                simSettings={simSettings}
                groupRef={groupRef}
                flightTelemetryRef={flightTelemetryRef}
                resetToken={flightResetToken}
                waypoints={waypoints}
                isFlyingPath={isFlyingPath}
                onFlightComplete={() => setIsFlyingPath(false)}
                controlSensitivity={controlSensitivity}
              />
            )
          ) : (
            <DroneModel
              params={params}
              viewSettings={viewSettings}
              simSettings={simSettings}
              groupRef={groupRef}
              flightTelemetryRef={flightTelemetryRef}
              resetToken={flightResetToken}
              waypoints={waypoints}
              isFlyingPath={isFlyingPath}
              onFlightComplete={() => setIsFlyingPath(false)}
              controlSensitivity={controlSensitivity}
            />
          )}

          <FlightCameraController
            enabled={isFlightSimView}
            targetRef={groupRef}
            mode={cameraMode}
          />

          {!isFlightSimView && (
            <OrbitControls
              makeDefault
              enableDamping={false}
              zoomSpeed={1.25}
              rotateSpeed={0.9}
              maxPolarAngle={Math.PI * 0.48}
              minDistance={80}
              maxDistance={130000}
              target={[0, 120, 0]}
            />
          )}
        </Canvas>
            </div>
          </section>

          <footer className="status-bar">
            <div className="status-cluster">
              <div className="status-item">
                <span className="status-label">Class</span>
                <span className="status-value">{snapshotClass}</span>
              </div>
              <div className="status-item">
                <span className="status-label">Frame</span>
                <span className="status-value">{params.frameSize.toFixed(0)} mm</span>
              </div>
              <div className="status-item">
                <span className="status-label">Prop</span>
                <span className="status-value">{params.propSize.toFixed(1)} in</span>
              </div>
              {isFlightSimView ? (
                <>
                  <div className="status-item">
                    <span className="status-label">Alt</span>
                    <span className="status-value">{(flightTelemetry.altitudeM ?? 0).toFixed(1)} m</span>
                  </div>
                  <div className="status-item">
                    <span className="status-label">Speed</span>
                    <span className="status-value">{(flightTelemetry.speedMS ?? 0).toFixed(1)} m/s</span>
                  </div>
                  <div className="status-item">
                    <span className="status-label">Throttle</span>
                    <span className="status-value">{((flightTelemetry.throttle01 ?? 0) * 100).toFixed(0)}%</span>
                  </div>
                </>
              ) : isPrintLayoutView ? (
                <>
                  <div className="status-item">
                    <span className="status-label">Carbon Sheet</span>
                    <span className="status-value">{printPack.carbonSheetSize} mm</span>
                  </div>
                  <div className="status-item">
                    <span className="status-label">TPU Pack</span>
                    <span className="status-value">{printPack.tpuParts.length} items</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="status-item">
                    <span className="status-label">AUW</span>
                    <span className="status-value">{engData.auw_g.toFixed(0)} g</span>
                  </div>
                  <div className="status-item">
                    <span className="status-label">T/W</span>
                    <span className="status-value">{engData.twRatio.toFixed(2)}x</span>
                  </div>
                </>
              )}
            </div>

            <div className="status-cluster">
              <div className="status-item">
                <span className="status-label">Renderer</span>
                <span className="status-value">{rendererLabel}</span>
              </div>
              <div className="status-item">
                <span className="status-label">Camera</span>
                <span className="status-value">{isFlightSimView ? cameraModeLabel : "Orbit"}</span>
              </div>
            </div>

            <div className="status-cluster status-cluster-end">
              {isFlightSimView ? (
                <>
                  <div className="status-item">
                    <span className="status-label">Path</span>
                    <span className="status-value">{waypoints.length} points</span>
                  </div>
                  <div className="status-item">
                    <span className="status-label">State</span>
                    <span className="status-value">{isFlyingPath ? "Autopilot" : "Manual"}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="status-item">
                    <span className="status-label">View</span>
                    <span className="status-value">{viewSettings.focus}</span>
                  </div>
                  {isPrintLayoutView && (
                    <div className="status-item">
                      <span className="status-label">Ref Items</span>
                      <span className="status-value">{printPack.referenceParts.length}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </footer>
        </div>
      </main>
    </div>
  );
}
