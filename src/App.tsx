import {
    OrbitControls,
} from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import * as THREE from "three";
import { FlightDebugOverlays } from "./components/FlightDebugOverlays";
import { FlightCameraController, type CameraMode } from "./components/FlightCameraController";
import { FlightDebugInspector } from "./components/FlightDebugInspector";
import { FlightPathOverlay } from "./components/FlightPathOverlay";
import { DroneModel } from "./components/DroneModel";
import { EngineeringPanel } from "./components/EngineeringPanel";
import { Sidebar } from "./components/Sidebar";
import { WebgpuGridIntegration } from "./components/WebgpuGridIntegration";
import { useDroneDebugBridge } from "./hooks/useDroneDebugBridge";
import { useFlightPath } from "./hooks/useFlightPath";
import { useFlightLog } from "./hooks/useFlightLog";
import { useFullscreenShell } from "./hooks/useFullscreenShell";
import { useRapierBundle } from "./hooks/useRapierBundle";
import {
  createConfiguredWebgpuRenderer,
  type RendererBackend,
} from "./scene/webgpuRenderer";
import { exportDroneStl } from "./sim/exportStl";
import { getFlightDamageDiagnosis } from "./sim/flightDamageUx";
import { type FlightPathPresetId } from "./sim/flightPath";
import { createPrintPack } from "./sim/printPack";
import {
  createDefaultFlightTelemetry,
  defaultDebugSettings,
  defaultParams,
  defaultSimSettings,
  defaultViewSettings,
  deriveParamsFromBuild,
  syncSimSettingsFromParams,
} from "./sim/config";
import {
  computeAssemblyFitChecks,
  computeDroneEngineeringData,
  validateAssemblyConfiguration,
} from "./sim/labModels";
import {
  AssemblyValidationResult,
  DebugSettings,
  DroneParams,
  FlightTelemetry,
  SimSettings,
  ViewSettings,
} from "./types";

const LazyRapierDebugLines = lazy(() =>
  import("./components/RapierDebugLines").then((m) => ({
    default: m.RapierDebugLines,
  })),
);

type FlightRuntimeIssueKind = "controller" | "physics";
type CanvasGlFactory = NonNullable<ComponentProps<typeof Canvas>["gl"]>;

export default function App() {
  const defaultFlightTelemetry = useMemo<FlightTelemetry>(
    () => createDefaultFlightTelemetry(),
    [],
  );
  const [params, setParams] = useState<DroneParams>(() =>
    deriveParamsFromBuild(defaultSimSettings, defaultParams),
  );
  const groupRef = useRef<THREE.Group>(null);
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const [rendererBackend, setRendererBackend] = useState<RendererBackend>("unknown");
  const [arePanelsVisible, setArePanelsVisible] = useState(true);
  const [isSnapshotPanelOpen, setIsSnapshotPanelOpen] = useState(false);
  const [isDetailsPanelOpen, setIsDetailsPanelOpen] = useState(false);
  const [isLabPanelOpen, setIsLabPanelOpen] = useState(params.viewMode === "flight_sim");
  const [controlSensitivity, setControlSensitivity] = useState(0.45);
  const [cameraMode, setCameraMode] = useState<CameraMode>("chase");
  const [debugSettings, setDebugSettings] = useState<DebugSettings>(defaultDebugSettings);
  const [viewSettings, setViewSettings] = useState<ViewSettings>(defaultViewSettings);
  const [simSettings, setSimSettings] = useState<SimSettings>(defaultSimSettings);
  const [assemblyGateError, setAssemblyGateError] = useState<{
    source: string;
    validation: AssemblyValidationResult;
  } | null>(null);
  const [flightRuntimeIssues, setFlightRuntimeIssues] = useState<
    Partial<Record<FlightRuntimeIssueKind, string>>
  >({});
  const flightTelemetryRef = useRef<FlightTelemetry>(defaultFlightTelemetry);
  const {
    appendWaypoint,
    clearWaypoints,
    flightPathLine,
    flightResetToken,
    isFlyingPath,
    isFlyingPathRef,
    loadPresetWaypoints,
    presetId,
    resetFlightPath,
    setIsFlyingPath,
    setPresetId,
    setWaypoints,
    startFlightPath,
    stopFlightPath,
    waypoints,
    waypointsRef,
  } = useFlightPath({ frameSize: params.frameSize });
  const { isImmersive, toggleFullscreen } = useFullscreenShell(appShellRef);

  const setFlightRuntimeIssue = useCallback(
    (kind: FlightRuntimeIssueKind, message: string | null) => {
      setFlightRuntimeIssues((current) => {
        const nextMessage = message ?? undefined;
        if (current[kind] === nextMessage) {
          return current;
        }

        if (nextMessage) {
          return {
            ...current,
            [kind]: nextMessage,
          };
        }

        const { [kind]: _removed, ...rest } = current;
        return rest;
      });
    },
    [],
  );

  const glFactory = useCallback(
    (props: { canvas: HTMLCanvasElement | OffscreenCanvas }) =>
      createConfiguredWebgpuRenderer(props, setRendererBackend),
    [],
  );

  const paramsRef = useRef(params);
  const viewSettingsRef = useRef(viewSettings);
  const simSettingsRef = useRef(simSettings);
  const debugSettingsRef = useRef(debugSettings);

  const applyValidatedAssemblyState = useCallback((
    nextParams: DroneParams,
    nextSimSettings: SimSettings,
    source: string,
  ) => {
    const validation = validateAssemblyConfiguration(nextParams, nextSimSettings);
    if (!validation.isValid) {
      setAssemblyGateError({ source, validation });
      return false;
    }

    paramsRef.current = nextParams;
    simSettingsRef.current = nextSimSettings;
    setParams(nextParams);
    setSimSettings(nextSimSettings);
    setAssemblyGateError(null);
    return true;
  }, []);

  const handleValidatedParamChange = useCallback((
    nextParams: DroneParams,
    source = "design controls",
  ) => {
    const nextSimSettings = syncSimSettingsFromParams(nextParams, simSettingsRef.current);
    return applyValidatedAssemblyState(nextParams, nextSimSettings, source);
  }, [applyValidatedAssemblyState]);

  const handleValidatedSimSettingsChange = useCallback((
    nextSimSettings: SimSettings,
    source = "assembly controls",
  ) => {
    const nextParams = deriveParamsFromBuild(nextSimSettings, paramsRef.current);
    return applyValidatedAssemblyState(nextParams, nextSimSettings, source);
  }, [applyValidatedAssemblyState]);

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

  const {
    clearFlightLog,
    flightLog,
    flightLogSummary,
    flightTelemetry,
    inspectorTelemetry,
    isReplayEnabled,
    replayCursorSec,
    resetFlightTelemetry,
    setIsReplayEnabled,
    setReplayCursorSec,
  } = useFlightLog({
    arePanelsVisible,
    debugSettings,
    defaultFlightTelemetry,
    flightTelemetryRef,
    isFlightSimView: params.viewMode === "flight_sim",
    simSettingsRef,
  });

  useDroneDebugBridge({
    applyValidatedAssemblyState,
    debugSettingsRef,
    flightTelemetryRef,
    isFlyingPathRef,
    paramsRef,
    setDebugSettings,
    setIsFlyingPath,
    setViewSettings,
    setWaypoints,
    simSettingsRef,
    viewSettingsRef,
    waypointsRef,
  });

  const handleExport = () => {
    void exportDroneStl(groupRef.current, params.frameSize);
  };

  const engData = useMemo(
    () => computeDroneEngineeringData(params, simSettings),
    [params, simSettings],
  );
  const assemblyValidation = useMemo(
    () => validateAssemblyConfiguration(params, simSettings),
    [params, simSettings],
  );
  const assemblyFits = useMemo(
    () => computeAssemblyFitChecks(params, simSettings),
    [params, simSettings],
  );

  const isPrintLayoutView = params.viewMode === "print_layout";
  const printPack = useMemo(() => createPrintPack(params), [params]);

  const needsRapier = params.viewMode === "flight_sim" || debugSettings.physicsLines;
  const rapier = useRapierBundle(needsRapier);
  const isFlightSimView = params.viewMode === "flight_sim";
  const rendererLabel =
    rendererBackend === "webgpu"
      ? "WebGPU"
      : rendererBackend === "webgl2"
        ? "WebGL2 Fallback"
        : "Unknown";
  const snapshotClass =
    params.frameSize >= 250 ? "7-inch" : params.frameSize >= 200 ? "5-inch" : "3-inch";
  const cameraModeLabel =
    cameraMode === "hood" ? "Hood Cam" : cameraMode === "close" ? "Close Chase" : "Far Chase";

  const handleResetFlight = useCallback(() => {
    resetFlightPath();
    setFlightRuntimeIssue("controller", null);
    setFlightRuntimeIssue("physics", null);
    resetFlightTelemetry();
  }, [resetFlightPath, resetFlightTelemetry, setFlightRuntimeIssue]);

  const flightDamageDiagnosis = getFlightDamageDiagnosis(flightTelemetry, {
    actuatorMismatchPct: simSettings.actuatorMismatchPct,
  });
  const activeAssemblyGate = !assemblyValidation.isValid
    ? { source: "Current design", validation: assemblyValidation }
    : assemblyGateError;
  const invalidAssemblyTargets = activeAssemblyGate?.validation.failingTargets ?? [];
  const assemblyGateNotice = activeAssemblyGate
    ? {
        title: "Assembly constraint blocked",
        summary:
          activeAssemblyGate.source === "Current design"
            ? activeAssemblyGate.validation.issues[0]?.summary ?? "The current build is outside the validated assembly envelope."
            : `${activeAssemblyGate.source} rejected. ${activeAssemblyGate.validation.issues[0]?.summary ?? "The proposed build is outside the validated assembly envelope."} Last valid configuration kept.`,
        detail: activeAssemblyGate.validation.issues
          .slice(0, 2)
          .map((issue) => issue.title)
          .join(" • "),
      }
    : null;
  const assemblyWarningNotice = !activeAssemblyGate && assemblyValidation.warnings.length > 0
    ? {
        title: "Assembly warning",
        summary:
          assemblyValidation.warnings[0]?.summary ??
          "The current build is inside the warning band for one or more fit checks.",
        detail: assemblyValidation.warnings
          .slice(0, 2)
          .map((warning) => warning.title)
          .join(" • "),
      }
    : null;
  const activeFlightRuntimeIssue =
    flightRuntimeIssues.physics ?? flightRuntimeIssues.controller ?? null;

  useEffect(() => {
    if (params.viewMode === "flight_sim") {
      setIsLabPanelOpen(true);
      return;
    }

    setIsLabPanelOpen(false);
  }, [params.viewMode]);

  useEffect(() => {
    if (params.viewMode !== "flight_sim" && Object.keys(flightRuntimeIssues).length > 0) {
      setFlightRuntimeIssues({});
    }
  }, [flightRuntimeIssues, params.viewMode]);

  return (
    <div ref={appShellRef} className={`drone-app-shell flex h-screen w-full flex-col overflow-hidden font-sans text-neutral-200${isImmersive ? " is-fullscreen" : ""}`}>
      <div className="app-workspace-shell">
        {arePanelsVisible && (
          <Sidebar
            params={params}
            onChange={(next) => handleValidatedParamChange(next, "sidebar design controls")}
            onExport={handleExport}
            viewSettings={viewSettings}
            onViewSettingsChange={setViewSettings}
            simSettings={simSettings}
            onSimSettingsChange={(next) => handleValidatedSimSettingsChange(next, "sidebar assembly controls")}
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
                      setIsLabPanelOpen(false);
                    } else if (params.viewMode === "flight_sim") {
                      setIsLabPanelOpen(true);
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
              {isFlightSimView && (
                <button
                  type="button"
                  onClick={() => {
                    if (!arePanelsVisible) {
                      setArePanelsVisible(true);
                      setIsLabPanelOpen(true);
                      return;
                    }

                    setIsLabPanelOpen((prev) => !prev);
                  }}
                  className={isLabPanelOpen ? "toolbar-chip toolbar-chip-primary" : "toolbar-chip"}
                >
                  Engineering Lab
                </button>
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
                    onChange={(e) =>
                      setPresetId(e.target.value as FlightPathPresetId)
                    }
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
                    onClick={loadPresetWaypoints}
                    disabled={isFlyingPath}
                  >
                    Load
                  </button>
                  <button
                    className="toolbar-chip disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={clearWaypoints}
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
                    onClick={startFlightPath}
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
                          <div className="text-neutral-100 text-right">{simSettings.materialDensityGcm3.toFixed(2)} g/cm³</div>
                          <div className="text-white/45">MODULUS</div>
                          <div className="text-neutral-100 text-right">{simSettings.materialElasticModulusGPa.toFixed(0)} GPa</div>
                          <div className="text-white/45">YIELD</div>
                          <div className="text-neutral-100 text-right">{simSettings.materialYieldStrengthMPa.toFixed(0)} MPa</div>
                          <div className="text-white/45">TOLERANCE</div>
                          <div className="text-neutral-100 text-right">±{simSettings.manufacturingToleranceMm.toFixed(2)} mm</div>
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
                          <div className="text-neutral-400">TIP DEFLECT</div>
                          <div className="text-neutral-200 text-right">{engData.tipDeflection_mm.toFixed(2)} mm</div>
                          <div className="text-neutral-400">PEAK STRAIN</div>
                          <div className="text-neutral-200 text-right">{engData.peakStrain_pct.toFixed(3)} %</div>
                          <div className="text-neutral-400">BRITTLE RISK</div>
                          <div className={`text-right font-bold ${engData.brittleRisk_pct > 70 ? "text-rose-500" : engData.brittleRisk_pct > 40 ? "text-yellow-500" : "text-emerald-500"}`}>
                            {engData.brittleRisk_pct.toFixed(0)} %
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

                      <div>
                        <div className="text-[9px] text-neutral-500 mb-1.5 uppercase tracking-wider">
                          Tolerance & Wiring
                        </div>
                        <div className="grid grid-cols-2 gap-1 text-[11px] font-mono">
                          <div className="text-neutral-400">STACK-UP</div>
                          <div className="text-neutral-200 text-right">{engData.toleranceStack_mm.toFixed(2)} mm</div>
                          <div className="text-neutral-400">HARNESS OD</div>
                          <div className="text-neutral-200 text-right">{engData.harnessBundleDiameter_mm.toFixed(1)} mm</div>
                          <div className="text-neutral-400">CHANNEL</div>
                          <div className="text-neutral-200 text-right">{engData.harnessChannelWidth_mm.toFixed(1)} mm</div>
                          <div className="text-neutral-400">WIRE MARGIN</div>
                          <div className={`text-right font-bold ${engData.wiringMargin_mm < 0 ? "text-rose-500" : engData.wiringMargin_mm < 2 ? "text-yellow-500" : "text-emerald-500"}`}>
                            {engData.wiringMargin_mm.toFixed(1)} mm
                          </div>
                          <div className="text-neutral-400">CUR DENSITY</div>
                          <div className={`text-right font-bold ${engData.wiringCurrentDensity_Amm2 > 12 ? "text-rose-500" : engData.wiringCurrentDensity_Amm2 > 8 ? "text-yellow-500" : "text-emerald-500"}`}>
                            {engData.wiringCurrentDensity_Amm2.toFixed(1)} A/mm²
                          </div>
                        </div>
                      </div>

                      <div>
                        <div className="text-[9px] text-neutral-500 mb-1.5 uppercase tracking-wider">
                          Assembly Fit Checks
                        </div>
                        <div className="space-y-1 text-[11px] font-mono">
                          {assemblyFits.map((fit) => (
                            <div key={fit.label} className="grid grid-cols-[1fr_auto_auto] gap-2">
                              <div className="text-neutral-400">{fit.label}</div>
                              <div className="text-neutral-200 text-right">{fit.minClearanceMm.toFixed(2)} mm</div>
                              <div className={`text-right font-bold ${fit.severity === "fail" ? "text-rose-500" : fit.severity === "warn" ? "text-yellow-500" : "text-emerald-500"}`}>
                                {fit.severity.toUpperCase()}
                              </div>
                            </div>
                          ))}
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
          gl={glFactory as unknown as CanvasGlFactory}
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
                  invalidTargets={invalidAssemblyTargets}
                  groupRef={groupRef}
                  flightTelemetryRef={flightTelemetryRef}
                  rapier={{
                    RigidBody: rapier.RigidBody,
                    CuboidCollider: rapier.CuboidCollider,
                  }}
                  resetToken={flightResetToken}
                  waypoints={waypoints}
                  isFlyingPath={isFlyingPath}
                  onFlightComplete={stopFlightPath}
                  controlSensitivity={controlSensitivity}
                  onRuntimeIssue={setFlightRuntimeIssue}
                />

                <mesh
                  rotation={[-Math.PI / 2, 0, 0]}
                  position={[0, 0, 0]}
                  visible={false}
                  onPointerDown={(e) => {
                    if (!isFlyingPath) {
                      appendWaypoint(e.point);
                    }
                  }}
                >
                  <planeGeometry args={[2000, 2000]} />
                  <meshBasicMaterial />
                </mesh>

                <FlightPathOverlay
                  flightPathLine={flightPathLine}
                  waypoints={waypoints}
                />

                <FlightDebugOverlays
                  telemetry={flightTelemetry}
                  debugSettings={debugSettings}
                  params={params}
                  targetRef={groupRef}
                />
              </rapier.Physics>
            ) : (
              // Rapier is still loading; show the model immediately.
              <DroneModel
                params={params}
                viewSettings={viewSettings}
                simSettings={simSettings}
                invalidTargets={invalidAssemblyTargets}
                groupRef={groupRef}
                flightTelemetryRef={flightTelemetryRef}
                resetToken={flightResetToken}
                waypoints={waypoints}
                isFlyingPath={isFlyingPath}
                onFlightComplete={stopFlightPath}
                controlSensitivity={controlSensitivity}
                onRuntimeIssue={setFlightRuntimeIssue}
              />
            )
          ) : (
            <DroneModel
              params={params}
              viewSettings={viewSettings}
              simSettings={simSettings}
              invalidTargets={invalidAssemblyTargets}
              groupRef={groupRef}
              flightTelemetryRef={flightTelemetryRef}
              resetToken={flightResetToken}
              waypoints={waypoints}
              isFlyingPath={isFlyingPath}
              onFlightComplete={stopFlightPath}
              controlSensitivity={controlSensitivity}
              onRuntimeIssue={setFlightRuntimeIssue}
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
              {isFlightSimView && debugSettings.debugInspector && (
                <div className="flight-debug-inset">
                  <FlightDebugInspector
                    telemetry={inspectorTelemetry}
                    logSamples={flightLog}
                    replayEnabled={isReplayEnabled}
                    replayCursorSec={replayCursorSec}
                  />
                </div>
              )}
            </div>
          </section>

        </div>

        {arePanelsVisible && isFlightSimView && isLabPanelOpen && (
          <EngineeringPanel
            simSettings={simSettings}
            onSimSettingsChange={(next) => handleValidatedSimSettingsChange(next, "engineering lab controls")}
            debugSettings={debugSettings}
            onDebugSettingsChange={setDebugSettings}
            flightTelemetry={flightTelemetry}
            flightLogSamples={flightLogSummary.samples}
            flightLogDurationSec={flightLogSummary.durationSec}
            replayEnabled={isReplayEnabled}
            replayCursorSec={replayCursorSec}
            onReplayEnabledChange={setIsReplayEnabled}
            onReplayCursorSecChange={setReplayCursorSec}
            onClearFlightLog={clearFlightLog}
          />
        )}
        </main>
      </div>

      <footer className="status-bar">
        {assemblyGateNotice && (
          <div className="status-notice status-notice-critical">
            <span className="status-notice-label">{assemblyGateNotice.title}</span>
            <span className="status-notice-copy">{assemblyGateNotice.summary}</span>
            <span className="status-notice-detail">{assemblyGateNotice.detail}</span>
          </div>
        )}
        {isFlightSimView && flightDamageDiagnosis && (
          <div className={`status-notice status-notice-${flightDamageDiagnosis.severity}`}>
            <span className="status-notice-label">{flightDamageDiagnosis.title}</span>
            <span className="status-notice-copy">{flightDamageDiagnosis.summary}</span>
            <span className="status-notice-detail">{flightDamageDiagnosis.detail}</span>
          </div>
        )}
        {assemblyWarningNotice && (
          <div className="status-notice status-notice-warn">
            <span className="status-notice-label">{assemblyWarningNotice.title}</span>
            <span className="status-notice-copy">{assemblyWarningNotice.summary}</span>
            <span className="status-notice-detail">{assemblyWarningNotice.detail}</span>
          </div>
        )}
        {isFlightSimView && activeFlightRuntimeIssue && (
          <div className="status-notice status-notice-warn">
            <span className="status-notice-label">Runtime warning</span>
            <span className="status-notice-copy">{activeFlightRuntimeIssue}</span>
          </div>
        )}
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
  );
}
