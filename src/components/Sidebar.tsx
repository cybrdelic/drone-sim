import React, { useState, useEffect } from "react";
import { DroneParams, ViewMode } from "../types";

interface SidebarProps {
  params: DroneParams;
  onChange: (params: DroneParams) => void;
  onExport: () => void;
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
      <div className="text-[10px] font-bold text-neutral-500 mb-3 uppercase tracking-widest border-b border-neutral-800 pb-2">
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
        <label className="text-[11px] font-medium text-neutral-300">
          {label}
        </label>
        <span className="text-[10px] font-mono text-emerald-400">
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
        className="w-full h-1.5 bg-neutral-800 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-emerald-400 hover:[&::-webkit-slider-thumb]:bg-emerald-300"
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
      <label className="text-[11px] font-medium text-neutral-300 block mb-1">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-neutral-900 border border-neutral-700 text-neutral-200 text-xs p-2 rounded outline-none focus:border-emerald-500 transition-colors cursor-pointer"
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

export function Sidebar({ params, onChange, onExport }: SidebarProps) {
  const handleChange = <K extends keyof DroneParams>(
    key: K,
    value: DroneParams[K],
  ) => {
    onChange({ ...params, [key]: value });
  };

  return (
    <div className="w-80 bg-[#111] text-neutral-100 flex flex-col h-full overflow-y-auto border-r border-neutral-800 z-10 select-none shadow-2xl">
      <div className="p-6 border-b border-neutral-800 bg-[#0a0a0a]">
        <h1 className="text-lg font-bold tracking-tight text-white">
          AeroForge PRO
        </h1>
        <div className="text-[10px] font-mono text-emerald-500 mt-1 flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          PRODUCTION CAD ENGINE
        </div>
      </div>

      <div className="flex-1 p-6">
        <ControlGroup title="Workspace">
          <div className="flex flex-wrap bg-neutral-900 rounded-lg p-1 border border-neutral-800 gap-1">
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
                className={`flex-1 min-w-[30%] py-2 text-[10px] uppercase tracking-wider font-medium rounded transition-all ${
                  params.viewMode === mode
                    ? "bg-neutral-700 text-white shadow-sm"
                    : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {mode.replace("_", " ")}
              </button>
            ))}
          </div>
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
      </div>

      <div className="p-6 border-t border-neutral-800 bg-[#0a0a0a]">
        <button
          onClick={onExport}
          className="w-full py-3 bg-emerald-500 text-black text-[11px] font-bold uppercase tracking-widest rounded hover:bg-emerald-400 active:bg-emerald-600 transition-colors shadow-[0_0_15px_rgba(16,185,129,0.2)]"
        >
          Export Production STL
        </button>
        <p className="text-[9px] text-neutral-500 text-center mt-3">
          Ready for CNC routing or 3D Printing
        </p>
      </div>
    </div>
  );
}
