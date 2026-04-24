import { ReactNode, useEffect, useState } from "react";
import type { NumericSimSettingKey } from "../../sim/config";
import type { SimSettings } from "../../types";

export interface NumericSimControl {
  key: NumericSimSettingKey;
  label: string;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}

export function releaseFlightInputFocus() {
  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement) {
    activeElement.blur();
  }

  window.setTimeout(() => {
    if (document.body instanceof HTMLElement) {
      document.body.focus?.();
    }
  }, 0);
}

export function ControlGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="kicker mb-3 border-b border-white/8 pb-2">{title}</div>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    if (localValue !== value) {
      const timer = setTimeout(() => {
        onChange(localValue);
      }, 150);
      return () => clearTimeout(timer);
    }

    return undefined;
  }, [localValue, onChange, value]);

  return (
    <div>
      <div className="mb-1 flex items-end justify-between">
        <label className="ui-label">{label}</label>
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
        onPointerUp={() => releaseFlightInputFocus()}
        onKeyUp={() => releaseFlightInputFocus()}
        className="ui-slider cursor-pointer"
      />
    </div>
  );
}

export function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number | string;
  options: { label: string; value: number | string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="ui-label mb-1.5 block">{label}</label>
      <select
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          releaseFlightInputFocus();
        }}
        className="ui-select cursor-pointer"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  className = "ui-check",
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="ui-label">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => {
          onChange(e.target.checked);
          releaseFlightInputFocus();
        }}
        className={className}
      />
    </label>
  );
}

export function SimSettingsSliderList({
  controls,
  simSettings,
  onChange,
}: {
  controls: readonly NumericSimControl[];
  simSettings: SimSettings;
  onChange: (patch: Partial<SimSettings>) => void;
}) {
  return (
    <>
      {controls.map((control) => (
        <Slider
          key={control.key}
          label={control.label}
          value={simSettings[control.key]}
          min={control.min}
          max={control.max}
          step={control.step}
          unit={control.unit}
          onChange={(value) =>
            onChange({ [control.key]: value } as Partial<SimSettings>)
          }
        />
      ))}
    </>
  );
}
