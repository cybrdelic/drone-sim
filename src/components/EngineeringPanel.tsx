import { useState } from "react";
import {
  applyDebugPreset,
  debugPresetOptions,
  type NonCustomDebugPreset,
} from "../sim/config";
import { getFlightDamageDiagnosis } from "../sim/flightDamageUx";
import { parseTuneImport } from "../sim/tuneImport";
import {
  Checkbox,
  ControlGroup,
  releaseFlightInputFocus,
  Select,
  Slider,
} from "./panels/PanelControls";
import {
  DebugSettings,
  EnvironmentPreset,
  FlightTelemetry,
  RateProfileMode,
  SimSettings,
} from "../types";

interface EngineeringPanelProps {
  simSettings: SimSettings;
  onSimSettingsChange: (next: SimSettings) => void;
  debugSettings: DebugSettings;
  onDebugSettingsChange: (next: DebugSettings) => void;
  flightTelemetry: FlightTelemetry;
  flightLogSamples: number;
  flightLogDurationSec: number;
  replayEnabled: boolean;
  replayCursorSec: number;
  onReplayEnabledChange: (enabled: boolean) => void;
  onReplayCursorSecChange: (seconds: number) => void;
  onClearFlightLog: () => void;
}

export function EngineeringPanel({
  simSettings,
  onSimSettingsChange,
  debugSettings,
  onDebugSettingsChange,
  flightTelemetry,
  flightLogSamples,
  flightLogDurationSec,
  replayEnabled,
  replayCursorSec,
  onReplayEnabledChange,
  onReplayCursorSecChange,
  onClearFlightLog,
}: EngineeringPanelProps) {
  const [tuneImportText, setTuneImportText] = useState("");
  const [tuneImportStatus, setTuneImportStatus] = useState<string | null>(null);
  const flightDamageDiagnosis = getFlightDamageDiagnosis(flightTelemetry, {
    actuatorMismatchPct: simSettings.actuatorMismatchPct,
  });

  const patchSimSettings = (patch: Partial<SimSettings>) => {
    onSimSettingsChange({
      ...simSettings,
      ...patch,
    });
  };

  const updateSimSetting = <K extends keyof SimSettings>(
    key: K,
    value: SimSettings[K],
  ) => {
    onSimSettingsChange({
      ...simSettings,
      [key]: value,
    });
  };

  const updateDebugSettings = (patch: Partial<Omit<DebugSettings, "debugPreset">>) => {
    onDebugSettingsChange({
      ...debugSettings,
      ...patch,
      debugPreset: "custom",
    });
  };

  const applyTuneImport = () => {
    const patch = parseTuneImport(tuneImportText);
    if (!patch) {
      setTuneImportStatus("No valid build or tune fields found.");
      return;
    }

    patchSimSettings(patch);
    setTuneImportStatus(`Applied ${Object.keys(patch).length} tune fields.`);
    releaseFlightInputFocus();
  };

  return (
    <aside className="etched-panel sidebar-shell lab-shell text-neutral-100 select-none">
      <div className="sidebar-head lab-head">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="kicker mb-1">Engineering Lab</div>
            <h2 className="text-[13px] font-semibold tracking-[0.01em] text-white">
              Flight Analysis Workspace
            </h2>
          </div>
          <div className="pt-0.5 text-[10px] uppercase tracking-[0.08em] text-white/55">
            {replayEnabled ? "Replay" : "Live"}
          </div>
        </div>
        <div className="sidebar-meta-row">
          <span>{debugSettings.debugPreset.replace("_", " ")}</span>
          <span>{flightLogSamples} samples</span>
          <span>{flightLogDurationSec.toFixed(1)} s</span>
        </div>
      </div>

      <div className="sidebar-body lab-body">
        <ControlGroup title="World & Actuators">
          <Select
            label="Environment Preset"
            value={simSettings.environmentPreset}
            onChange={(value) =>
              updateSimSetting("environmentPreset", value as EnvironmentPreset)
            }
            options={[
              { label: "Lab Calm", value: "lab_calm" },
              { label: "Wind Tunnel", value: "wind_tunnel" },
              { label: "Field Gusty", value: "field_gusty" },
            ]}
          />
          <Slider
            label="Ambient Temperature"
            value={simSettings.ambientTempC}
            min={-10}
            max={45}
            step={1}
            unit=" C"
            onChange={(value) => updateSimSetting("ambientTempC", value)}
          />
          <Slider
            label="Humidity"
            value={simSettings.humidityPct}
            min={0}
            max={100}
            step={5}
            unit="%"
            onChange={(value) => updateSimSetting("humidityPct", value)}
          />
          <Slider
            label="Mean Wind"
            value={simSettings.meanWindMS}
            min={0}
            max={20}
            step={0.2}
            unit=" m/s"
            onChange={(value) => updateSimSetting("meanWindMS", value)}
          />
          <Slider
            label="Gust Amplitude"
            value={simSettings.gustAmplitudeMS}
            min={0}
            max={10}
            step={0.1}
            unit=" m/s"
            onChange={(value) => updateSimSetting("gustAmplitudeMS", value)}
          />
          <Slider
            label="Turbulence"
            value={simSettings.turbulenceMS}
            min={0}
            max={5}
            step={0.05}
            unit=" m/s"
            onChange={(value) => updateSimSetting("turbulenceMS", value)}
          />
          <Slider
            label="ESC Latency"
            value={simSettings.escLatencyMs}
            min={0}
            max={120}
            step={2}
            unit=" ms"
            onChange={(value) => updateSimSetting("escLatencyMs", value)}
          />
          <Slider
            label="Actuator Mismatch"
            value={simSettings.actuatorMismatchPct}
            min={0}
            max={20}
            step={0.5}
            unit="%"
            onChange={(value) => updateSimSetting("actuatorMismatchPct", value)}
          />
          <Slider
            label="Current Limit"
            value={simSettings.motorCurrentLimitA}
            min={20}
            max={220}
            step={5}
            unit=" A"
            onChange={(value) => updateSimSetting("motorCurrentLimitA", value)}
          />
          <Slider
            label="Motor Cooling"
            value={simSettings.motorCoolingScale}
            min={0.3}
            max={2}
            step={0.05}
            unit="x"
            onChange={(value) => updateSimSetting("motorCoolingScale", value)}
          />
          <Slider
            label="Motor KV"
            value={simSettings.buildMotorKV}
            min={500}
            max={4200}
            step={10}
            unit=" kv"
            onChange={(value) => updateSimSetting("buildMotorKV", value)}
          />
          <Slider
            label="Battery Cells"
            value={simSettings.buildBatteryCells}
            min={3}
            max={8}
            step={1}
            unit=" s"
            onChange={(value) => updateSimSetting("buildBatteryCells", value)}
          />
          <Slider
            label="Prop Pitch"
            value={simSettings.buildPropPitchIn}
            min={2}
            max={8}
            step={0.1}
            unit=' in'
            onChange={(value) => updateSimSetting("buildPropPitchIn", value)}
          />
          <Slider
            label="Pack Resistance"
            value={simSettings.buildPackResistanceMilliOhm}
            min={4}
            max={80}
            step={1}
            unit=" mOhm"
            onChange={(value) => updateSimSetting("buildPackResistanceMilliOhm", value)}
          />
          <Slider
            label="Rotor Inertia"
            value={simSettings.rotorInertiaScale}
            min={0.35}
            max={3}
            step={0.01}
            unit="x"
            onChange={(value) => updateSimSetting("rotorInertiaScale", value)}
          />
          <Slider
            label="Acro Rate"
            value={simSettings.acroRateDegPerSec}
            min={360}
            max={1400}
            step={10}
            unit=" deg/s"
            onChange={(value) => updateSimSetting("acroRateDegPerSec", value)}
          />
          <Slider
            label="Acro Expo"
            value={simSettings.acroExpo}
            min={0}
            max={0.75}
            step={0.01}
            unit=""
            onChange={(value) => updateSimSetting("acroExpo", value)}
          />
          <Slider
            label="Air-Mode Authority"
            value={simSettings.airmodeStrength}
            min={0}
            max={1}
            step={0.01}
            unit=""
            onChange={(value) => updateSimSetting("airmodeStrength", value)}
          />
          <Slider
            label="Prop-Wash Coupling"
            value={simSettings.propWashCoupling}
            min={0}
            max={1}
            step={0.01}
            unit=""
            onChange={(value) => updateSimSetting("propWashCoupling", value)}
          />
        </ControlGroup>

        <ControlGroup title="Structure & Wiring">
          <Slider
            label="Manufacturing Tolerance"
            value={simSettings.manufacturingToleranceMm}
            min={0.01}
            max={0.5}
            step={0.01}
            unit=" mm"
            onChange={(value) => updateSimSetting("manufacturingToleranceMm", value)}
          />
          <Slider
            label="Material Density"
            value={simSettings.materialDensityGcm3}
            min={1}
            max={2.2}
            step={0.01}
            unit=" g/cc"
            onChange={(value) => updateSimSetting("materialDensityGcm3", value)}
          />
          <Slider
            label="Elastic Modulus"
            value={simSettings.materialElasticModulusGPa}
            min={20}
            max={140}
            step={1}
            unit=" GPa"
            onChange={(value) => updateSimSetting("materialElasticModulusGPa", value)}
          />
          <Slider
            label="Yield Strength"
            value={simSettings.materialYieldStrengthMPa}
            min={120}
            max={1200}
            step={10}
            unit=" MPa"
            onChange={(value) => updateSimSetting("materialYieldStrengthMPa", value)}
          />
          <Slider
            label="Brittle Strain Limit"
            value={simSettings.materialBrittleStrainPct}
            min={0.2}
            max={3}
            step={0.01}
            unit=" %"
            onChange={(value) => updateSimSetting("materialBrittleStrainPct", value)}
          />
          <Slider
            label="Impact Fragility"
            value={simSettings.impactFragilityScale}
            min={0.25}
            max={3}
            step={0.01}
            unit="x"
            onChange={(value) => updateSimSetting("impactFragilityScale", value)}
          />
          <Slider
            label="Wire Outer Diameter"
            value={simSettings.wireOuterDiameterMm}
            min={0.6}
            max={4}
            step={0.05}
            unit=" mm"
            onChange={(value) => updateSimSetting("wireOuterDiameterMm", value)}
          />
          <Slider
            label="Harness Conductors"
            value={simSettings.wiringBundleCount}
            min={1}
            max={24}
            step={1}
            unit=""
            onChange={(value) => updateSimSetting("wiringBundleCount", value)}
          />
          <Slider
            label="Wire Keepout"
            value={simSettings.wiringMinSpacingMm}
            min={1}
            max={12}
            step={0.1}
            unit=" mm"
            onChange={(value) => updateSimSetting("wiringMinSpacingMm", value)}
          />
          <Slider
            label="Harness Current"
            value={simSettings.wiringCurrentA}
            min={1}
            max={180}
            step={1}
            unit=" A"
            onChange={(value) => updateSimSetting("wiringCurrentA", value)}
          />
          <Slider
            label="Motor Screw Clearance"
            value={simSettings.motorScrewClearanceMm}
            min={0.05}
            max={1}
            step={0.01}
            unit=" mm"
            onChange={(value) => updateSimSetting("motorScrewClearanceMm", value)}
          />
          <Slider
            label="Stack Screw Clearance"
            value={simSettings.stackScrewClearanceMm}
            min={0.05}
            max={1}
            step={0.01}
            unit=" mm"
            onChange={(value) => updateSimSetting("stackScrewClearanceMm", value)}
          />
          <Slider
            label="Camera TPU Clearance"
            value={simSettings.cameraTpuClearanceMm}
            min={0.1}
            max={2}
            step={0.01}
            unit=" mm"
            onChange={(value) => updateSimSetting("cameraTpuClearanceMm", value)}
          />
          <Slider
            label="Antenna Tube Clearance"
            value={simSettings.antennaTubeClearanceMm}
            min={0.1}
            max={2}
            step={0.01}
            unit=" mm"
            onChange={(value) => updateSimSetting("antennaTubeClearanceMm", value)}
          />
          <Slider
            label="Stack Height"
            value={simSettings.stackHeightMm}
            min={4}
            max={30}
            step={0.5}
            unit=" mm"
            onChange={(value) => updateSimSetting("stackHeightMm", value)}
          />
          <Slider
            label="Arm Fracture Threshold"
            value={simSettings.armFractureForceN}
            min={80}
            max={2000}
            step={10}
            unit=" N"
            onChange={(value) => updateSimSetting("armFractureForceN", value)}
          />
          <Slider
            label="Motor Damage Threshold"
            value={simSettings.motorDamageForceN}
            min={40}
            max={1200}
            step={10}
            unit=" N"
            onChange={(value) => updateSimSetting("motorDamageForceN", value)}
          />
          <Slider
            label="Battery Damage Threshold"
            value={simSettings.batteryDamageForceN}
            min={60}
            max={1600}
            step={10}
            unit=" N"
            onChange={(value) => updateSimSetting("batteryDamageForceN", value)}
          />
        </ControlGroup>

        <ControlGroup title="Rates & Throttle">
          <Select
            label="Rate Profile"
            value={simSettings.rateProfileMode}
            onChange={(value) =>
              updateSimSetting("rateProfileMode", value as RateProfileMode)
            }
            options={[
              { label: "Actual", value: "actual" },
              { label: "Betaflight", value: "betaflight" },
            ]}
          />
          <Slider
            label="BF RC Rate"
            value={simSettings.betaflightRcRate}
            min={0.2}
            max={3}
            step={0.01}
            unit=""
            onChange={(value) => updateSimSetting("betaflightRcRate", value)}
          />
          <Slider
            label="BF Super Rate"
            value={simSettings.betaflightSuperRate}
            min={0}
            max={0.95}
            step={0.01}
            unit=""
            onChange={(value) => updateSimSetting("betaflightSuperRate", value)}
          />
          <Slider
            label="BF Expo"
            value={simSettings.betaflightExpo}
            min={0}
            max={0.95}
            step={0.01}
            unit=""
            onChange={(value) => updateSimSetting("betaflightExpo", value)}
          />
          <Slider
            label="BF Yaw RC Rate"
            value={simSettings.betaflightYawRcRate}
            min={0.2}
            max={3}
            step={0.01}
            unit=""
            onChange={(value) => updateSimSetting("betaflightYawRcRate", value)}
          />
          <Slider
            label="BF Yaw Super"
            value={simSettings.betaflightYawSuperRate}
            min={0}
            max={0.95}
            step={0.01}
            unit=""
            onChange={(value) => updateSimSetting("betaflightYawSuperRate", value)}
          />
          <Slider
            label="BF Yaw Expo"
            value={simSettings.betaflightYawExpo}
            min={0}
            max={0.95}
            step={0.01}
            unit=""
            onChange={(value) => updateSimSetting("betaflightYawExpo", value)}
          />
          <Slider
            label="Throttle Mid"
            value={simSettings.throttleMid01}
            min={0.05}
            max={0.95}
            step={0.01}
            unit=""
            onChange={(value) => updateSimSetting("throttleMid01", value)}
          />
          <Slider
            label="Throttle Expo"
            value={simSettings.throttleExpo}
            min={0}
            max={0.95}
            step={0.01}
            unit=""
            onChange={(value) => updateSimSetting("throttleExpo", value)}
          />
          <div>
            <label className="ui-label mb-1.5 block">Tune Import</label>
            <textarea
              value={tuneImportText}
              onChange={(event) => setTuneImportText(event.target.value)}
              onBlur={() => releaseFlightInputFocus()}
              rows={7}
              placeholder={[
                "set roll_rc_rate = 120",
                "set roll_srate = 72",
                "set roll_expo = 10",
                "set yaw_rc_rate = 100",
                "set thr_mid = 50",
                "set thr_expo = 20",
              ].join("\n")}
              className="ui-textarea"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <button type="button" onClick={applyTuneImport} className="toolbar-chip">
                Apply Import
              </button>
              <button
                type="button"
                onClick={() => {
                  setTuneImportText([
                    "set roll_rc_rate = 120",
                    "set roll_srate = 72",
                    "set roll_expo = 10",
                    "set yaw_rc_rate = 100",
                    "set yaw_srate = 62",
                    "set yaw_expo = 5",
                    "set thr_mid = 50",
                    "set thr_expo = 20",
                    "buildMotorKV = 1950",
                    "buildBatteryCells = 6",
                    "buildPropPitchIn = 4.3",
                    "manufacturingToleranceMm = 0.05",
                    "materialElasticModulusGPa = 70",
                    "materialYieldStrengthMPa = 600",
                    "wireOuterDiameterMm = 1.6",
                    "wiringBundleCount = 8",
                    "motorScrewClearanceMm = 0.25",
                    "cameraTpuClearanceMm = 0.45",
                    "armFractureForceN = 420",
                    "motorDamageForceN = 220",
                    "batteryDamageForceN = 320",
                  ].join("\n"));
                  setTuneImportStatus(null);
                }}
                className="toolbar-chip"
              >
                Load Example
              </button>
            </div>
            {tuneImportStatus ? (
              <div className="ui-note mt-2">{tuneImportStatus}</div>
            ) : null}
          </div>
        </ControlGroup>

        <ControlGroup title="Sensors">
          <Checkbox
            label="GPS"
            checked={simSettings.gpsEnabled}
            onChange={(checked) => updateSimSetting("gpsEnabled", checked)}
          />
          <Checkbox
            label="Barometer"
            checked={simSettings.barometerEnabled}
            onChange={(checked) => updateSimSetting("barometerEnabled", checked)}
          />
          <Checkbox
            label="Magnetometer"
            checked={simSettings.magnetometerEnabled}
            onChange={(checked) => updateSimSetting("magnetometerEnabled", checked)}
          />
          <Checkbox
            label="Rangefinder"
            checked={simSettings.rangefinderEnabled}
            onChange={(checked) => updateSimSetting("rangefinderEnabled", checked)}
          />
          <Slider
            label="Sensor Noise"
            value={simSettings.sensorNoiseScale}
            min={0}
            max={2}
            step={0.05}
            unit="x"
            onChange={(value) => updateSimSetting("sensorNoiseScale", value)}
          />
          <Slider
            label="GPS Update Rate"
            value={simSettings.gpsRateHz}
            min={1}
            max={20}
            step={1}
            unit=" Hz"
            onChange={(value) => updateSimSetting("gpsRateHz", value)}
          />
          <Slider
            label="Recorder Window"
            value={simSettings.sensorLogSeconds}
            min={10}
            max={180}
            step={5}
            unit=" s"
            onChange={(value) => updateSimSetting("sensorLogSeconds", value)}
          />
        </ControlGroup>

        <ControlGroup title="Debug">
          <Select
            label="Debug Preset"
            value={debugSettings.debugPreset}
            onChange={(value) => {
              if (value === "custom") {
                onDebugSettingsChange({
                  ...debugSettings,
                  debugPreset: "custom",
                });
                return;
              }

              onDebugSettingsChange(
                applyDebugPreset(value as NonCustomDebugPreset),
              );
            }}
            options={[...debugPresetOptions]}
          />
          <Checkbox
            label="Show Debug Inspector"
            checked={debugSettings.debugInspector}
            onChange={(checked) => updateDebugSettings({ debugInspector: checked })}
          />
          <Checkbox
            label="Show Physics Colliders"
            checked={debugSettings.physicsLines}
            onChange={(checked) => updateDebugSettings({ physicsLines: checked })}
          />
          <Checkbox
            label="Show Flight Telemetry"
            checked={debugSettings.flightTelemetry}
            onChange={(checked) => updateDebugSettings({ flightTelemetry: checked })}
          />
          <Checkbox
            label="Show Sensor Overlays"
            checked={debugSettings.sensorOverlays}
            onChange={(checked) => updateDebugSettings({ sensorOverlays: checked })}
          />
          <Checkbox
            label="Show Sensor Frustums"
            checked={debugSettings.sensorFrustums}
            onChange={(checked) => updateDebugSettings({ sensorFrustums: checked })}
          />
          <Checkbox
            label="Show Force Vectors"
            checked={debugSettings.forceVectors}
            onChange={(checked) => updateDebugSettings({ forceVectors: checked })}
          />
          <Checkbox
            label="Show Collision Volumes"
            checked={debugSettings.collisionVolumes}
            onChange={(checked) => updateDebugSettings({ collisionVolumes: checked })}
          />
          <Checkbox
            label="Show Impact Events"
            checked={debugSettings.impactEvents}
            onChange={(checked) => updateDebugSettings({ impactEvents: checked })}
          />
          <Checkbox
            label="Show Wind Field"
            checked={debugSettings.windField}
            onChange={(checked) => updateDebugSettings({ windField: checked })}
          />
          <Checkbox
            label="Show Flight Trail"
            checked={debugSettings.flightTrail}
            onChange={(checked) => updateDebugSettings({ flightTrail: checked })}
          />

          <div className="sidebar-subsection text-[11px] font-mono text-neutral-300">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <div className="text-white/45">LOG</div>
              <div className="text-right text-[#dbe8ff]">{flightLogSamples}</div>

              <div className="text-neutral-500">WINDOW</div>
              <div className="text-right">{flightLogDurationSec.toFixed(1)} s</div>

              <div className="text-neutral-500">MODE</div>
              <div className="text-right">{replayEnabled ? "Replay" : "Live"}</div>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <Checkbox
                label="Replay"
                checked={replayEnabled}
                onChange={onReplayEnabledChange}
              />
              <button
                type="button"
                onClick={onClearFlightLog}
                className="toolbar-chip"
              >
                Clear Log
              </button>
            </div>

            <div className="mt-3">
              <div className="mb-1 flex items-end justify-between">
                <label className="ui-label">Replay Cursor</label>
                <span className="ui-value">{replayCursorSec.toFixed(1)} s</span>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0.1, flightLogDurationSec)}
                step={0.05}
                value={Math.min(replayCursorSec, Math.max(0.1, flightLogDurationSec))}
                onChange={(e) => onReplayCursorSecChange(parseFloat(e.target.value))}
                onPointerUp={() => releaseFlightInputFocus()}
                onKeyUp={() => releaseFlightInputFocus()}
                disabled={!replayEnabled || flightLogSamples < 2}
                className="ui-slider cursor-pointer disabled:opacity-40"
              />
            </div>
          </div>

          {debugSettings.flightTelemetry && (
            <div className="sidebar-subsection text-[11px] font-mono text-neutral-300">
              {flightDamageDiagnosis && (
                <div className="mb-3 rounded-[4px] border border-[#7f8ea3]/30 bg-[#20242a] px-3 py-2 text-[10px] leading-[1.45] text-[#d6dde8]">
                  <div className="mb-1 font-semibold uppercase tracking-[0.08em] text-[#f0b36c]">
                    {flightDamageDiagnosis.title}
                  </div>
                  <div>{flightDamageDiagnosis.summary}</div>
                  <div className="mt-1 text-white/45">{flightDamageDiagnosis.detail}</div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <div className="text-white/45">THR</div>
                <div className="text-right text-[#dbe8ff]">
                  {(flightTelemetry.throttle01 ?? 0).toFixed(2)}
                </div>

                <div className="text-white/45">T/W</div>
                <div className="text-right text-[#dbe8ff]">
                  {(flightTelemetry.tw ?? 0).toFixed(2)}
                </div>

                <div className="text-neutral-500">THRUST</div>
                <div className="text-right">{(flightTelemetry.thrustN ?? 0).toFixed(1)} N</div>

                <div className="text-neutral-500">WEIGHT</div>
                <div className="text-right">{(flightTelemetry.weightN ?? 0).toFixed(1)} N</div>

                <div className="text-neutral-500">MASS</div>
                <div className="text-right">{(flightTelemetry.totalMassG ?? 0).toFixed(0)} g</div>

                <div className="text-neutral-500">ALT</div>
                <div className="text-right">{(flightTelemetry.altitudeM ?? 0).toFixed(2)} m</div>

                <div className="text-neutral-500">SPD</div>
                <div className="text-right">{(flightTelemetry.speedMS ?? 0).toFixed(2)} m/s</div>

                <div className="text-neutral-500">AIRS</div>
                <div className="text-right">{(flightTelemetry.airspeedMS ?? 0).toFixed(2)} m/s</div>

                <div className="text-neutral-500">WIND</div>
                <div className="text-right">{(flightTelemetry.windMS ?? 0).toFixed(2)} m/s</div>

                <div className="text-neutral-500">GE</div>
                <div className="text-right">{(flightTelemetry.groundEffectMult ?? 1).toFixed(2)}x</div>

                <div className="text-neutral-500">BAT</div>
                <div className="text-right">{(flightTelemetry.batteryV ?? 0).toFixed(2)} V</div>

                <div className="text-neutral-500">SAG</div>
                <div className="text-right">{(flightTelemetry.batterySagV ?? 0).toFixed(2)} V</div>

                <div className="text-neutral-500">CUR</div>
                <div className="text-right">{(flightTelemetry.batteryI ?? 0).toFixed(1)} A</div>

                <div className="text-neutral-500">CUR LIM</div>
                <div className="text-right">{(flightTelemetry.currentLimitA ?? 0).toFixed(0)} A</div>

                <div className="text-neutral-500">TEMP</div>
                <div className="text-right">{(flightTelemetry.ambientTempC ?? 0).toFixed(1)} C</div>

                <div className="text-neutral-500">PROFILE</div>
                <div className="text-right">{flightTelemetry.rateProfileMode ?? "actual"}</div>

                <div className="text-neutral-500">KV</div>
                <div className="text-right">{(flightTelemetry.buildMotorKV ?? 0).toFixed(0)}</div>

                <div className="text-neutral-500">CELLS</div>
                <div className="text-right">{(flightTelemetry.buildBatteryCells ?? 0).toFixed(0)} s</div>

                <div className="text-neutral-500">PITCH</div>
                <div className="text-right">{(flightTelemetry.buildPropPitchIn ?? 0).toFixed(1)} in</div>

                <div className="text-neutral-500">PACK R</div>
                <div className="text-right">{(flightTelemetry.buildPackResistanceMilliOhm ?? 0).toFixed(0)} mOhm</div>

                <div className="text-neutral-500">INERTIA</div>
                <div className="text-right">{(flightTelemetry.rotorInertiaScale ?? 0).toFixed(2)}x</div>

                <div className="text-neutral-500">RATE</div>
                <div className="text-right">{(flightTelemetry.acroRateDegPerSec ?? 0).toFixed(0)} deg/s</div>

                <div className="text-neutral-500">EXPO</div>
                <div className="text-right">{(flightTelemetry.acroExpo ?? 0).toFixed(2)}</div>

                <div className="text-neutral-500">AIRMODE</div>
                <div className="text-right">{((flightTelemetry.airmodeStrength ?? 0) * 100).toFixed(0)} %</div>

                <div className="text-neutral-500">WASH LOSS</div>
                <div className="text-right">{((flightTelemetry.propWashLoss ?? 0) * 100).toFixed(0)} %</div>

                <div className="text-neutral-500">RELOAD</div>
                <div className="text-right">{((flightTelemetry.rotorReloadLoss ?? 0) * 100).toFixed(0)} %</div>

                <div className="text-neutral-500">MOTOR AVG</div>
                <div className="text-right">{(flightTelemetry.avgMotorTempC ?? 0).toFixed(1)} C</div>

                <div className="text-neutral-500">MOTOR PEAK</div>
                <div className="text-right">{(flightTelemetry.peakMotorTempC ?? 0).toFixed(1)} C</div>

                <div className="text-neutral-500">THERM LIM</div>
                <div className="text-right">{((flightTelemetry.thermalLimitScale ?? 1) * 100).toFixed(0)} %</div>

                <div className="text-neutral-500">CUR LIM %</div>
                <div className="text-right">{((flightTelemetry.currentLimitScale ?? 1) * 100).toFixed(0)} %</div>

                <div className="text-neutral-500">RHO</div>
                <div className="text-right">{(flightTelemetry.airDensityKgM3 ?? 0).toFixed(3)}</div>

                <div className="text-neutral-500">GUST</div>
                <div className="text-right">{(flightTelemetry.gustMS ?? 0).toFixed(2)} m/s</div>

                <div className="text-neutral-500">ACT</div>
                <div className="text-right">{(flightTelemetry.actuatorSpreadPct ?? 0).toFixed(1)} %</div>

                <div className="text-neutral-500">GPS ALT</div>
                <div className="text-right">{(flightTelemetry.gpsAltitudeM ?? 0).toFixed(2)} m</div>

                <div className="text-neutral-500">BARO</div>
                <div className="text-right">{(flightTelemetry.baroAltitudeM ?? 0).toFixed(2)} m</div>

                <div className="text-neutral-500">RANGE</div>
                <div className="text-right">{(flightTelemetry.rangefinderM ?? 0).toFixed(2)} m</div>

                <div className="text-neutral-500">HDG</div>
                <div className="text-right">{(flightTelemetry.headingDeg ?? 0).toFixed(1)} deg</div>

                <div className="text-neutral-500">GYRO</div>
                <div className="text-right">{(flightTelemetry.gyroDps ?? 0).toFixed(1)} dps</div>

                <div className="text-neutral-500">ACC</div>
                <div className="text-right">{(flightTelemetry.accelMS2 ?? 0).toFixed(2)} m/s^2</div>
              </div>
            </div>
          )}
        </ControlGroup>
      </div>
    </aside>
  );
}
