import {
    OrbitControls,
} from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { AgXToneMapping, SRGBColorSpace, WebGPURenderer } from "three/webgpu";
import { DroneModel } from "./components/DroneModel";
import { GamepadDiagram } from "./components/GamepadDiagram";
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
  const [params, setParams] = useState<DroneParams>(defaultParams);
  const groupRef = useRef<THREE.Group>(null);
  const viewportRef = useRef<HTMLElement | null>(null);
  const [rendererBackend, setRendererBackend] = useState<"webgpu" | "webgl2" | "unknown">(
    "unknown",
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [arePanelsVisible, setArePanelsVisible] = useState(true);
  const [waypoints, setWaypoints] = useState<THREE.Vector3[]>([]);
  const [isFlyingPath, setIsFlyingPath] = useState(false);
  const [controlSensitivity, setControlSensitivity] = useState(0.45);
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
  const flightTelemetryRef = useRef<FlightTelemetry>({
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
  });
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
      setIsFullscreen(document.fullscreenElement === viewportRef.current);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    handleFullscreenChange();

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    try {
      if (document.fullscreenElement === viewport) {
        await document.exitFullscreen();
      } else if (!document.fullscreenElement) {
        await viewport.requestFullscreen();
      }
    } catch {
      // Ignore fullscreen API failures; they are user-agent controlled.
    }
  }, []);

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
    if (!debugSettings.flightTelemetry) return;
    const id = window.setInterval(() => {
      setFlightTelemetry({ ...flightTelemetryRef.current });
    }, 200);
    return () => window.clearInterval(id);
  }, [debugSettings.flightTelemetry]);

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

  const rapierCacheRef = useRef<RapierBundle | null>(null);
  const rapierLoadPromiseRef = useRef<Promise<RapierBundle> | null>(null);
  const [rapier, setRapier] = useState<RapierBundle | null>(null);
  const needsRapier = params.viewMode === "flight_sim" || debugSettings.physicsLines;

  // Prefetch Rapier after initial paint so flight_sim can become interactive immediately,
  // without forcing Rapier onto the critical-path bundle.
  useEffect(() => {
    let cancelled = false;

    const load = () => {
      if (rapierCacheRef.current) return;
      if (!rapierLoadPromiseRef.current) {
        rapierLoadPromiseRef.current = import("@react-three/rapier").then((m) => {
          const bundle: RapierBundle = {
            Physics: (m as any).Physics,
            RigidBody: (m as any).RigidBody,
            CuboidCollider: (m as any).CuboidCollider,
          };
          rapierCacheRef.current = bundle;
          return bundle;
        });
      }

      rapierLoadPromiseRef.current
        .then((bundle) => {
          if (cancelled) return;
          if (needsRapier) setRapier(bundle);
        })
        .catch(() => {
          // ignore: if Rapier fails to load we just won't mount physics.
        });
    };

    const w = typeof window !== "undefined" ? (window as any) : null;
    if (w && typeof w.requestIdleCallback === "function") {
      w.requestIdleCallback(load, { timeout: 2000 });
    } else {
      // Start prefetch ASAP (after current paint).
      window.setTimeout(load, 0);
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    <div className="flex h-screen w-full bg-[#0a0a0a] overflow-hidden font-sans text-neutral-200">
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

      <main ref={viewportRef} className="flex-1 relative cursor-move">
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setArePanelsVisible((prev) => !prev)}
            className="bg-neutral-950/85 text-neutral-100 border border-neutral-700 hover:border-emerald-500/60 hover:text-white px-4 py-2 rounded-full text-[11px] uppercase tracking-[0.22em] shadow-2xl backdrop-blur transition-colors"
          >
            {arePanelsVisible ? "Hide Panels" : "Show Panels"}
          </button>
          <button
            type="button"
            onClick={() => {
              void toggleFullscreen();
            }}
            className="bg-neutral-950/85 text-neutral-100 border border-neutral-700 hover:border-emerald-500/60 hover:text-white px-4 py-2 rounded-full text-[11px] uppercase tracking-[0.22em] shadow-2xl backdrop-blur transition-colors"
          >
            {isFullscreen ? "Exit Fullscreen" : "Fullscreen View"}
          </button>
        </div>

        {arePanelsVisible && (
          <>
            {/* Frame Specs Panel (Top Left) */}
            <div className="absolute top-4 left-4 z-10 pointer-events-none">
              <div className="bg-[#111]/90 backdrop-blur border border-neutral-800 p-4 rounded-lg shadow-2xl">
                <h2 className="text-xs font-bold uppercase tracking-widest text-neutral-100 mb-3">
                  Frame Specifications
                </h2>
                <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-[11px] font-mono text-neutral-400">
                  <div>CLASS</div>
                  <div className="text-emerald-400 text-right">
                    {params.frameSize >= 250
                      ? "7-INCH"
                      : params.frameSize >= 200
                        ? "5-INCH"
                        : "3-INCH"}
                  </div>

                  <div>DIAGONAL</div>
                  <div className="text-neutral-200 text-right">
                    {params.frameSize.toFixed(1)} mm
                  </div>

                  <div>STACK</div>
                  <div className="text-neutral-200 text-right">
                    {params.fcMounting}x{params.fcMounting} mm
                  </div>

                  <div>MOTORS</div>
                  <div className="text-neutral-200 text-right">
                    {params.motorMountPattern}x{params.motorMountPattern} mm
                  </div>

                  <div>Z-HEIGHT</div>
                  <div className="text-neutral-200 text-right">
                    {(
                      params.plateThickness +
                      params.standoffHeight +
                      params.topPlateThickness
                    ).toFixed(1)}{" "}
                    mm
                  </div>
                </div>
              </div>
            </div>

            {/* Engineering Telemetry Panel (Top Right) */}
            <div className="absolute top-4 right-4 z-10 pointer-events-none w-80">
              <div className="bg-[#111]/90 backdrop-blur border border-neutral-800 p-4 rounded-lg shadow-2xl">
                <h2 className="text-[10px] font-bold uppercase tracking-widest text-emerald-500 mb-4 flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Engineering & Kinematics
                </h2>

                <div className="space-y-4">
                  <div>
                    <div className="text-[9px] text-neutral-500 mb-1.5 uppercase tracking-wider">
                      Material Specs
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-[11px] font-mono">
                      <div className="text-neutral-400">COMPOSITE</div>
                      <div className="text-neutral-200 text-right">
                        Toray T700 3K
                      </div>
                      <div className="text-neutral-400">DENSITY</div>
                      <div className="text-neutral-200 text-right">1.60 g/cm³</div>
                      <div className="text-neutral-400">TOLERANCE</div>
                      <div className="text-neutral-200 text-right">±0.05 mm</div>
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
                    <div className="mt-2 h-1.5 w-full bg-neutral-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${engData.safetyFactor < 1.5 ? "bg-rose-500" : engData.safetyFactor < 3 ? "bg-yellow-500" : "bg-emerald-500"}`}
                        style={{
                          width: `${Math.min((600 / engData.maxStress_MPa) * 20, 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Flight Sim Controls Overlay */}
        {arePanelsVisible && params.viewMode === "flight_sim" && (
          <>
            <div className="absolute top-24 left-1/2 -translate-x-1/2 z-10 flex gap-4 pointer-events-auto">
              <div className="bg-neutral-900/80 text-neutral-400 px-3 py-2 rounded text-xs border border-neutral-800 backdrop-blur flex items-center gap-2">
                <span className="text-neutral-500">Preset</span>
                <select
                  value={presetId}
                  onChange={(e) => setPresetId(e.target.value as any)}
                  disabled={isFlyingPath}
                  className="bg-neutral-900 border border-neutral-700 text-neutral-200 text-xs px-2 py-1 rounded outline-none focus:border-emerald-500 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <option value="oval">Oval</option>
                  <option value="figure8">Figure 8</option>
                  <option value="corkscrew">Corkscrew</option>
                  <option value="loop">Vertical Loop</option>
                </select>
                <button
                  className="bg-neutral-800 border border-neutral-700 text-white px-3 py-1.5 rounded text-xs hover:bg-neutral-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => setWaypoints(presetWaypoints[presetId].map((p) => p.clone()))}
                  disabled={isFlyingPath}
                >
                  Load
                </button>
              </div>

              <div className="bg-neutral-900/80 text-neutral-400 px-3 py-2 rounded text-xs border border-neutral-800 backdrop-blur flex items-center gap-2">
                <span className="text-neutral-500">Control</span>
                <input
                  type="range"
                  min={0.2}
                  max={1}
                  step={0.05}
                  value={controlSensitivity}
                  onChange={(e) => setControlSensitivity(parseFloat(e.target.value))}
                  disabled={isFlyingPath}
                  className="w-28 h-1.5 bg-neutral-800 rounded-full appearance-none cursor-pointer disabled:opacity-50 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-emerald-400 hover:[&::-webkit-slider-thumb]:bg-emerald-300"
                />
                <span className="text-[11px] font-mono text-emerald-400 w-10 text-right">
                  {(controlSensitivity * 100).toFixed(0)}%
                </span>
              </div>

              <button
                className="bg-neutral-800 border border-neutral-700 text-white px-4 py-2 rounded text-xs hover:bg-neutral-700 transition-colors"
                onClick={() => setWaypoints([])}
                disabled={isFlyingPath}
              >
                Clear Path
              </button>
              <button
                className="bg-emerald-600 border border-emerald-500 text-white px-4 py-2 rounded text-xs hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => setIsFlyingPath(true)}
                disabled={waypoints.length < 2 || isFlyingPath}
              >
                {isFlyingPath ? "Flying..." : "Fly Path"}
              </button>
              <div className="bg-neutral-900/80 text-neutral-400 px-4 py-2 rounded text-xs border border-neutral-800 backdrop-blur flex items-center">
                Click on the ground to add waypoints
              </div>
            </div>
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
              <div className="bg-[#111]/90 backdrop-blur border border-emerald-500/30 p-4 rounded-lg shadow-[0_0_30px_rgba(16,185,129,0.1)] flex items-center gap-8">
                <div className="text-center">
                  <div className="text-[10px] text-neutral-500 font-bold uppercase tracking-widest mb-2">
                    Pitch / Roll
                  </div>
                <div className="grid grid-cols-3 gap-1">
                  <div />
                  <div className="w-8 h-8 rounded bg-neutral-800 border border-neutral-700 flex items-center justify-center text-xs font-mono text-neutral-400">
                    W
                  </div>
                  <div />
                  <div className="w-8 h-8 rounded bg-neutral-800 border border-neutral-700 flex items-center justify-center text-xs font-mono text-neutral-400">
                    A
                  </div>
                  <div className="w-8 h-8 rounded bg-neutral-800 border border-neutral-700 flex items-center justify-center text-xs font-mono text-neutral-400">
                    S
                  </div>
                  <div className="w-8 h-8 rounded bg-neutral-800 border border-neutral-700 flex items-center justify-center text-xs font-mono text-neutral-400">
                    D
                  </div>
                </div>
              </div>
              <div className="w-[1px] h-16 bg-neutral-800" />
              <div className="text-center">
                <div className="text-[10px] text-neutral-500 font-bold uppercase tracking-widest mb-2">
                  Throttle / Yaw
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <div className="w-8 h-8 rounded bg-neutral-800 border border-neutral-700 flex items-center justify-center text-xs font-mono text-neutral-400">
                    Q
                  </div>
                  <div className="w-8 h-8 rounded bg-neutral-800 border border-emerald-500/50 flex items-center justify-center text-xs font-mono text-emerald-400">
                    SPC
                  </div>
                  <div className="w-8 h-8 rounded bg-neutral-800 border border-neutral-700 flex items-center justify-center text-xs font-mono text-neutral-400">
                    E
                  </div>
                  <div />
                  <div className="w-8 h-8 rounded bg-neutral-800 border border-emerald-500/50 flex items-center justify-center text-xs font-mono text-emerald-400">
                    SHF
                  </div>
                  <div />
                </div>
              </div>
            </div>
          </div>

            <div className="absolute bottom-4 right-4 z-10 pointer-events-none">
              <GamepadDiagram />
            </div>

            <div className="absolute bottom-4 left-4 z-10 pointer-events-none">
              <div
                className={
                  "text-[10px] font-mono px-2 py-1 rounded border backdrop-blur " +
                  (rendererBackend === "webgpu"
                    ? "text-emerald-300 border-emerald-500/40 bg-emerald-500/10"
                    : rendererBackend === "webgl2"
                      ? "text-amber-300 border-amber-500/40 bg-amber-500/10"
                      : "text-neutral-400 border-neutral-700 bg-neutral-900/70")
                }
              >
                {rendererBackend === "webgpu"
                  ? "Renderer: WebGPU"
                  : rendererBackend === "webgl2"
                    ? "Renderer: WebGL2 fallback"
                    : "Renderer: (unknown)"}
              </div>
            </div>
          </>
        )}

        <Canvas
          dpr={[1, 1.8]}
          camera={{
            // Frame the quad at a usable default distance in the sim's mm world.
            position: [2600, 1450, 2600],
            fov: 55,
            near: 50,
            far: 500000,
          }}
          onCreated={({ camera, scene }) => {
            scene.background = null;
            camera.updateProjectionMatrix();
          }}
          gl={glFactory as any}
          shadows
        >
          {/* Imported integration: environment + post-processing */}
          <WebgpuGridIntegration unitScale={1000} />

          {params.viewMode === "flight_sim" ? (
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
              waypoints={waypoints}
              isFlyingPath={isFlyingPath}
              onFlightComplete={() => setIsFlyingPath(false)}
              controlSensitivity={controlSensitivity}
            />
          )}

          <OrbitControls
            makeDefault
            enableDamping
            dampingFactor={0.08}
            maxPolarAngle={Math.PI * 0.48}
            minDistance={500}
            maxDistance={130000}
            target={[0, 180, 0]}
          />
        </Canvas>
      </main>
    </div>
  );
}
