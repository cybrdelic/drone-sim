import {
  ComponentFocus,
  ComponentVisibility,
  DroneParams,
  SimSettings,
  ViewMode,
  ViewSettings,
} from "../types";
import {
  Checkbox,
  ControlGroup,
  Select,
  Slider,
  SimSettingsSliderList,
} from "./panels/PanelControls";
import {
  sidebarChassisControls,
  sidebarMassControls,
} from "./panels/simControlSchema";

interface SidebarProps {
  params: DroneParams;
  onChange: (params: DroneParams) => void;
  onExport: () => void;
  viewSettings: ViewSettings;
  onViewSettingsChange: (next: ViewSettings) => void;
  simSettings: SimSettings;
  onSimSettingsChange: (next: SimSettings) => void;
}

export function Sidebar({
  params,
  onChange,
  onExport,
  viewSettings,
  onViewSettingsChange,
  simSettings,
  onSimSettingsChange,
}: SidebarProps) {
  const handleChange = <K extends keyof DroneParams>(
    key: K,
    value: DroneParams[K],
  ) => {
    onChange({ ...params, [key]: value });
  };
  const updateBuild = (patch: Partial<SimSettings>) => {
    onSimSettingsChange({ ...simSettings, ...patch });
  };
  const updateSimSetting = <K extends keyof SimSettings>(
    key: K,
    value: SimSettings[K],
  ) => {
    onSimSettingsChange({ ...simSettings, [key]: value });
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
      inspectTarget: "all",
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
            onChange={(checked) => updateSimSetting("motorAudioEnabled", checked)}
          />
          <Slider
            label="Audio Volume"
            value={simSettings.motorAudioVolume}
            min={0}
            max={1}
            step={0.05}
            unit=""
            onChange={(v) => updateSimSetting("motorAudioVolume", v)}
          />
          <Slider
            label="Vibration Amount"
            value={simSettings.vibrationAmount}
            min={0}
            max={1}
            step={0.05}
            unit=""
            onChange={(v) => updateSimSetting("vibrationAmount", v)}
          />
        </ControlGroup>

        <ControlGroup title="Chassis Dimensions">
          <SimSettingsSliderList
            controls={sidebarChassisControls}
            simSettings={simSettings}
            onChange={updateBuild}
          />
        </ControlGroup>

        <ControlGroup title="Hardware Mounting">
          <Select
            label="FC Stack Mounting"
            value={simSettings.buildFcMountMm}
            onChange={(v) => updateBuild({ buildFcMountMm: parseFloat(v) })}
            options={[
              { label: "20 x 20 mm (Micro)", value: 20 },
              { label: "25.5 x 25.5 mm (Whoop)", value: 25.5 },
              { label: "30.5 x 30.5 mm (Standard)", value: 30.5 },
            ]}
          />
          <Select
            label="Motor Mounting Pattern"
            value={simSettings.buildMotorMountPatternMm}
            onChange={(v) => updateBuild({ buildMotorMountPatternMm: parseFloat(v) })}
            options={[
              { label: "9 x 9 mm (M2)", value: 9 },
              { label: "12 x 12 mm (M2)", value: 12 },
              { label: "16 x 16 mm (M3)", value: 16 },
              { label: "19 x 19 mm (M3)", value: 19 },
            ]}
          />
          <Slider
            label="Motor Center Shaft Hole"
            value={simSettings.buildMotorShaftHoleMm}
            min={4}
            max={10}
            step={0.5}
            onChange={(v) => updateBuild({ buildMotorShaftHoleMm: v })}
          />
        </ControlGroup>

        <ControlGroup title="Real Build Mass">
          <SimSettingsSliderList
            controls={sidebarMassControls}
            simSettings={simSettings}
            onChange={updateBuild}
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
          <Checkbox
            label="Enable TPU Parts"
            checked={params.showTPU}
            onChange={(checked) => handleChange("showTPU", checked)}
            className="w-4 h-4 accent-emerald-500"
          />
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
