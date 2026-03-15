import React, { useEffect, useState } from "react";
import {
    ComponentFocus,
    ComponentVisibility,
    DebugSettings,
    DroneParams,
    FlightTelemetry,
    SimSettings,
    ViewMode,
    ViewSettings,
} from "../types";

interface SidebarProps {
  params: DroneParams;
  onChange: (params: DroneParams) => void;
  onExport: () => void;
  viewSettings: ViewSettings;
  onViewSettingsChange: (next: ViewSettings) => void;
  simSettings: SimSettings;
  onSimSettingsChange: (next: SimSettings) => void;
  debugSettings?: DebugSettings;
  onDebugSettingsChange?: (next: DebugSettings) => void;
  flightTelemetry?: FlightTelemetry;
}

function ControlGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="kicker mb-3 border-b border-white/8 pb-2">
        {title}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "mm",
  onChange,
}: SliderProps) {
  const [localValue, setLocalValue] = useState(value);

  // Sync with external value if it changes
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // Debounce the actual onChange callback to prevent freezing the UI during heavy CAD calculations
  useEffect(() => {
    if (localValue !== value) {
      const timer = setTimeout(() => {
        onChange(localValue);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [localValue, value, onChange]);

  return (
    <div>
      <div className="flex justify-between items-end mb-1">
        <label className="ui-label">
          {label}
        </label>
        <span className="ui-value">
          {localValue.toFixed(step && step < 1 ? 1 : 0)}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={localValue}
        onChange={(e) => setLocalValue(parseFloat(e.target.value))}
        className="ui-slider cursor-pointer"
      />
    </div>
  );
}

interface SelectProps {
  label: string;
  value: number | string;
  options: { label: string; value: number | string }[];
  onChange: (value: any) => void;
}

function Select({ label, value, options, onChange }: SelectProps) {
  return (
    <div>
      <label className="ui-label block mb-1.5">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="ui-select cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="ui-label">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="ui-check"
      />
    </label>
  );
}

export function Sidebar({
  params,
  onChange,
  onExport,
  viewSettings,
  onViewSettingsChange,
  simSettings,
  onSimSettingsChange,
  debugSettings,
  onDebugSettingsChange,
  flightTelemetry,
}: SidebarProps) {
  const effectiveDebugSettings: DebugSettings =
    debugSettings ?? ({ physicsLines: false, flightTelemetry: false } as DebugSettings);
  const setDebugSettings = (next: DebugSettings) => {
    if (onDebugSettingsChange) onDebugSettingsChange(next);
  };
  const handleChange = <K extends keyof DroneParams>(
    key: K,
    value: DroneParams[K],
  ) => {
    onChange({ ...params, [key]: value });
  };

  const setVisibility = (next: Partial<ComponentVisibility>) => {
    onViewSettingsChange({
      ...viewSettings,
      visibility: { ...viewSettings.visibility, ...next },
      focus: "all",
    });
  };

  const applyFocusPreset = (focus: ComponentFocus) => {
    const presets: Record<ComponentFocus, ComponentVisibility> = {
      all: { frame: true, propulsion: true, electronics: true, accessories: true },
      frame: { frame: true, propulsion: false, electronics: false, accessories: false },
      propulsion: { frame: false, propulsion: true, electronics: false, accessories: false },
      electronics: { frame: false, propulsion: false, electronics: true, accessories: false },
      accessories: { frame: false, propulsion: false, electronics: false, accessories: true },
    };
    onViewSettingsChange({
      ...viewSettings,
      focus,
      visibility: presets[focus],
    });
  };

  return (
    <div className="etched-panel sidebar-shell text-neutral-100 select-none">
      <div className="sidebar-head">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="kicker mb-1">Inspector</div>
            <h1 className="text-[13px] font-semibold tracking-[0.01em] text-white">
              Drone Sim
            </h1>
          </div>
          <div className="text-[10px] text-white/55 uppercase tracking-[0.08em] pt-0.5">
            Ready
          </div>
        </div>
        <div className="sidebar-meta-row">
          <span>{params.frameSize.toFixed(0)} mm</span>
          <span>{params.propSize.toFixed(1)} in</span>
          <span>{params.viewMode.replace("_", " ")}</span>
        </div>
      </div>

      <div className="sidebar-body">
        <ControlGroup title="Workspace">
          <div className="segment-wrap">
            {(
              [
                "assembled",
                "exploded",
                "print_layout",
                "clearance_check",
                "flight_sim",
              ] as ViewMode[]
            ).map((mode) => (
              <button
                key={mode}
                onClick={() => handleChange("viewMode", mode)}
                className={`segment-chip ${
                  params.viewMode === mode
                    ? "segment-chip-active"
                    : ""
                }`}
              >
                {mode.replace("_", " ")}
              </button>
            ))}
          </div>
        </ControlGroup>

        <ControlGroup title="Views">
          <Checkbox
            label="Wireframe"
            checked={viewSettings.wireframe}
            onChange={(checked) =>
              onViewSettingsChange({ ...viewSettings, wireframe: checked })
            }
          />

          <Select
            label="Component View"
            value={viewSettings.focus}
            onChange={(v) => applyFocusPreset(v as ComponentFocus)}
            options={[
              { label: "All", value: "all" },
              { label: "Frame", value: "frame" },
              { label: "Propulsion (Motors/Props)", value: "propulsion" },
              { label: "Electronics", value: "electronics" },
              { label: "Accessories (TPU)", value: "accessories" },
            ]}
          />

          <div className="sidebar-subsection grid grid-cols-1 gap-3">
            <Checkbox
              label="Frame"
              checked={viewSettings.visibility.frame}
              onChange={(checked) => setVisibility({ frame: checked })}
            />
            <Checkbox
              label="Propulsion"
              checked={viewSettings.visibility.propulsion}
              onChange={(checked) => setVisibility({ propulsion: checked })}
            />
            <Checkbox
              label="Electronics"
              checked={viewSettings.visibility.electronics}
              onChange={(checked) => setVisibility({ electronics: checked })}
            />
            <Checkbox
              label="Accessories"
              checked={viewSettings.visibility.accessories}
              onChange={(checked) => setVisibility({ accessories: checked })}
            />
          </div>
        </ControlGroup>

        <ControlGroup title="Simulation">
          <Checkbox
            label="Motor / Prop Audio"
            checked={simSettings.motorAudioEnabled}
            onChange={(checked) =>
              onSimSettingsChange({ ...simSettings, motorAudioEnabled: checked })
            }
          />
          <Slider
            label="Audio Volume"
            value={simSettings.motorAudioVolume}
            min={0}
            max={1}
            step={0.05}
            unit=""
            onChange={(v) =>
              onSimSettingsChange({ ...simSettings, motorAudioVolume: v })
            }
          />
          <Slider
            label="Vibration Amount"
            value={simSettings.vibrationAmount}
            min={0}
            max={1}
            step={0.05}
            unit=""
            onChange={(v) =>
              onSimSettingsChange({ ...simSettings, vibrationAmount: v })
            }
          />
        </ControlGroup>

        <ControlGroup title="Chassis Dimensions">
          <Slider
            label="Motor-to-Motor Diagonal"
            value={params.frameSize}
            min={120}
            max={350}
            step={1}
            onChange={(v) => handleChange("frameSize", v)}
          />
          <Slider
            label="Propeller Size"
            value={params.propSize}
            min={2.5}
            max={8}
            step={0.1}
            unit=" in"
            onChange={(v) => handleChange("propSize", v)}
          />
          <Slider
            label="Bottom Plate Thickness"
            value={params.plateThickness}
            min={2}
            max={8}
            step={0.5}
            onChange={(v) => handleChange("plateThickness", v)}
          />
          <Slider
            label="Top Plate Thickness"
            value={params.topPlateThickness}
            min={1}
            max={4}
            step={0.5}
            onChange={(v) => handleChange("topPlateThickness", v)}
          />
          <Slider
            label="Standoff Height"
            value={params.standoffHeight}
            min={15}
            max={40}
            step={1}
            onChange={(v) => handleChange("standoffHeight", v)}
          />
          <Slider
            label="Arm Width"
            value={params.armWidth}
            min={8}
            max={25}
            step={1}
            onChange={(v) => handleChange("armWidth", v)}
          />
        </ControlGroup>

        <ControlGroup title="Hardware Mounting">
          <Select
            label="FC Stack Mounting"
            value={params.fcMounting}
            onChange={(v) => handleChange("fcMounting", parseFloat(v))}
            options={[
              { label: "20 x 20 mm (Micro)", value: 20 },
              { label: "25.5 x 25.5 mm (Whoop)", value: 25.5 },
              { label: "30.5 x 30.5 mm (Standard)", value: 30.5 },
            ]}
          />
          <Select
            label="Motor Mounting Pattern"
            value={params.motorMountPattern}
            onChange={(v) => handleChange("motorMountPattern", parseFloat(v))}
            options={[
              { label: "9 x 9 mm (M2)", value: 9 },
              { label: "12 x 12 mm (M2)", value: 12 },
              { label: "16 x 16 mm (M3)", value: 16 },
              { label: "19 x 19 mm (M3)", value: 19 },
            ]}
          />
          <Slider
            label="Motor Center Shaft Hole"
            value={params.motorCenterHole}
            min={4}
            max={10}
            step={0.5}
            onChange={(v) => handleChange("motorCenterHole", v)}
          />
        </ControlGroup>

        <ControlGroup title="Optimization">
          <Slider
            label="Arm Weight Reduction"
            value={params.weightReduction}
            min={0}
            max={80}
            step={5}
            unit="%"
            onChange={(v) => handleChange("weightReduction", v)}
          />
        </ControlGroup>

        <ControlGroup title="3D Printed Accessories">
          <div className="flex items-center justify-between mb-4">
            <label className="text-[11px] font-medium text-neutral-300">
              Enable TPU Parts
            </label>
            <input
              type="checkbox"
              checked={params.showTPU}
              onChange={(e) => handleChange("showTPU", e.target.checked)}
              className="w-4 h-4 accent-emerald-500"
            />
          </div>
          {params.showTPU && (
            <Select
              label="TPU Color"
              value={params.tpuColor}
              onChange={(v) => handleChange("tpuColor", v)}
              options={[
                { label: "Cyan", value: "#0ea5e9" },
                { label: "Magenta", value: "#d946ef" },
                { label: "Neon Green", value: "#22c55e" },
                { label: "Black", value: "#171717" },
                { label: "Red", value: "#ef4444" },
              ]}
            />
          )}
        </ControlGroup>

        <ControlGroup title="Debug">
          <Checkbox
            label="Show Physics Colliders"
            checked={effectiveDebugSettings.physicsLines}
            onChange={(checked) =>
              setDebugSettings({ ...effectiveDebugSettings, physicsLines: checked })
            }
          />
          <Checkbox
            label="Show Flight Telemetry"
            checked={effectiveDebugSettings.flightTelemetry}
            onChange={(checked) =>
              setDebugSettings({
                ...effectiveDebugSettings,
                flightTelemetry: checked,
              })
            }
          />

          {effectiveDebugSettings.flightTelemetry && (
            <div className="sidebar-subsection text-[11px] font-mono text-neutral-300">
              {params.viewMode !== "flight_sim" ? (
                <div className="text-white/55">
                  Switch to flight sim to view telemetry.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <div className="text-white/45">THR</div>
                  <div className="text-right text-[#dbe8ff]">
                    {(flightTelemetry?.throttle01 ?? 0).toFixed(2)}
                  </div>

                  <div className="text-white/45">T/W</div>
                  <div className="text-right text-[#dbe8ff]">
                    {(flightTelemetry?.tw ?? 0).toFixed(2)}
                  </div>

                  <div className="text-neutral-500">THRUST</div>
                  <div className="text-right">
                    {(flightTelemetry?.thrustN ?? 0).toFixed(1)} N
                  </div>

                  <div className="text-neutral-500">WEIGHT</div>
                  <div className="text-right">
                    {(flightTelemetry?.weightN ?? 0).toFixed(1)} N
                  </div>

                  <div className="text-neutral-500">ALT</div>
                  <div className="text-right">
                    {(flightTelemetry?.altitudeM ?? 0).toFixed(2)} m
                  </div>

                  <div className="text-neutral-500">SPD</div>
                  <div className="text-right">
                    {(flightTelemetry?.speedMS ?? 0).toFixed(2)} m/s
                  </div>

                  <div className="text-neutral-500">AIRS</div>
                  <div className="text-right">
                    {(flightTelemetry?.airspeedMS ?? 0).toFixed(2)} m/s
                  </div>

                  <div className="text-neutral-500">WIND</div>
                  <div className="text-right">
                    {(flightTelemetry?.windMS ?? 0).toFixed(2)} m/s
                  </div>

                  <div className="text-neutral-500">GE</div>
                  <div className="text-right">
                    {(flightTelemetry?.groundEffectMult ?? 1).toFixed(2)}×
                  </div>

                  <div className="text-neutral-500">BAT</div>
                  <div className="text-right">
                    {(flightTelemetry?.batteryV ?? 0).toFixed(2)} V
                  </div>

                  <div className="text-neutral-500">CUR</div>
                  <div className="text-right">
                    {(flightTelemetry?.batteryI ?? 0).toFixed(1)} A
                  </div>
                </div>
              )}
            </div>
          )}
        </ControlGroup>
      </div>

      <div className="sidebar-foot">
        <button
          onClick={onExport}
          className="ui-action"
        >
          {params.viewMode === "print_layout" ? "Export Print Pack STL" : "Export Production STL"}
        </button>
        <p className="text-[9px] text-white/45 text-center mt-3 uppercase tracking-[0.14em]">
          {params.viewMode === "print_layout"
            ? "Print pack staged with hardware references"
            : "Ready for CNC routing or 3D printing"}
        </p>
      </div>
    </div>
  );
}
