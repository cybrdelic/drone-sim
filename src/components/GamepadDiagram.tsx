import { useEffect, useMemo, useState } from "react";

type PadSnapshot = {
  id: string;
  mapping: string;
  buttons: boolean[];
  axes: number[];
};

function readFirstConnectedPad(): PadSnapshot | null {
  try {
    const pads = typeof navigator !== "undefined" && navigator.getGamepads
      ? navigator.getGamepads()
      : [];
    const gp = Array.from(pads).find(
      (p) => p && p.connected && (p.mapping === "standard" || typeof p.mapping === "string"),
    );
    if (!gp) return null;

    return {
      id: gp.id || "Controller",
      mapping: gp.mapping || "",
      buttons: (gp.buttons || []).map((b) => !!b?.pressed),
      axes: (gp.axes || []).slice(),
    };
  } catch {
    return null;
  }
}

function clamp11(v: number) {
  return Math.max(-1, Math.min(1, v));
}

function applyDeadzone(v: number, dz = 0.12) {
  const a = Math.abs(v);
  if (a < dz) return 0;
  const s = Math.sign(v);
  const t = (a - dz) / (1 - dz);
  return s * t;
}

function Btn({ label, active }: { label: string; active: boolean }) {
  return (
    <div
      className={
        "w-7 h-7 rounded-full border flex items-center justify-center text-[10px] font-mono " +
        (active
          ? "bg-emerald-500/25 border-emerald-500/60 text-emerald-200"
          : "bg-neutral-900 border-neutral-700 text-neutral-400")
      }
    >
      {label}
    </div>
  );
}

function Pill({ label, active }: { label: string; active: boolean }) {
  return (
    <div
      className={
        "h-6 px-2 rounded border flex items-center justify-center text-[10px] font-mono " +
        (active
          ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-200"
          : "bg-neutral-900 border-neutral-700 text-neutral-400")
      }
    >
      {label}
    </div>
  );
}

function Stick({ x, y }: { x: number; y: number }) {
  // x,y in [-1..1]; y positive = up
  const px = 16 * clamp11(x);
  const py = -16 * clamp11(y);
  return (
    <div className="relative w-14 h-14 rounded-full bg-neutral-900 border border-neutral-700">
      <div
        className="absolute left-1/2 top-1/2 w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-400/90"
        style={{ transform: `translate(calc(-50% + ${px}px), calc(-50% + ${py}px))` }}
      />
    </div>
  );
}

export function GamepadDiagram() {
  const [pad, setPad] = useState<PadSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      setPad(readFirstConnectedPad());
    };

    tick();
    const id = window.setInterval(tick, 50);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const s = useMemo(() => {
    const buttons = pad?.buttons ?? [];
    const axes = pad?.axes ?? [];

    const lsx = applyDeadzone(axes[0] ?? 0);
    const lsy = applyDeadzone(axes[1] ?? 0);
    const rsx = applyDeadzone(axes[2] ?? 0);
    const rsy = applyDeadzone(axes[3] ?? 0);

    const b = (i: number) => !!buttons[i];

    return {
      connected: !!pad,
      id: pad?.id ?? "No controller",
      mapping: pad?.mapping ?? "",
      // Standard mapping indices
      A: b(0),
      B: b(1),
      X: b(2),
      Y: b(3),
      LB: b(4),
      RB: b(5),
      LT: b(6),
      RT: b(7),
      Back: b(8),
      Start: b(9),
      LS: b(10),
      RS: b(11),
      DU: b(12),
      DD: b(13),
      DL: b(14),
      DR: b(15),
      ls: { x: clamp11(lsx), y: clamp11(-lsy) },
      rs: { x: clamp11(rsx), y: clamp11(-rsy) },
    };
  }, [pad]);

  return (
    <div className="bg-[#111]/90 backdrop-blur border border-neutral-800 p-3 rounded-lg shadow-2xl w-72">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-neutral-100">
            Controller
          </div>
          <div className="text-[10px] text-neutral-500 font-mono truncate max-w-[200px]">
            {s.id}
          </div>
        </div>
        <div
          className={
            "text-[10px] font-mono px-2 py-1 rounded border " +
            (s.connected
              ? "text-emerald-300 border-emerald-500/40 bg-emerald-500/10"
              : "text-neutral-400 border-neutral-700 bg-neutral-900")
          }
        >
          {s.connected ? "LIVE" : "NONE"}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 items-center">
        {/* Left cluster */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Stick x={s.ls.x} y={s.ls.y} />
            <div className="space-y-1">
              <Pill label="LB" active={s.LB} />
              <Pill label="LT" active={s.LT} />
              <Pill label="LS" active={s.LS} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1 justify-items-center">
            <div />
            <Btn label="↑" active={s.DU} />
            <div />
            <Btn label="←" active={s.DL} />
            <Btn label="↓" active={s.DD} />
            <Btn label="→" active={s.DR} />
          </div>
        </div>

        {/* Center cluster */}
        <div className="flex flex-col items-center gap-2">
          <div className="grid grid-cols-2 gap-2">
            <Pill label="BACK" active={s.Back} />
            <Pill label="START" active={s.Start} />
          </div>
          <div className="text-[10px] text-neutral-500 font-mono">
            {s.mapping ? s.mapping : ""}
          </div>
        </div>

        {/* Right cluster */}
        <div className="space-y-2">
          <div className="flex items-center justify-end gap-2">
            <div className="space-y-1">
              <Pill label="RB" active={s.RB} />
              <Pill label="RT" active={s.RT} />
              <Pill label="RS" active={s.RS} />
            </div>
            <Stick x={s.rs.x} y={s.rs.y} />
          </div>

          <div className="grid grid-cols-3 gap-1 justify-items-center">
            <div />
            <Btn label="Y" active={s.Y} />
            <div />
            <Btn label="X" active={s.X} />
            <Btn label="A" active={s.A} />
            <Btn label="B" active={s.B} />
          </div>
        </div>
      </div>
    </div>
  );
}
