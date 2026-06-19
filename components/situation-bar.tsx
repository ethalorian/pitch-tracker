"use client";

import { cn } from "@/lib/utils";
import { basesLabel } from "@/lib/situation";
import FieldChart, { type SprayMarker } from "@/components/field-chart";
import type { Situation } from "@/lib/types";

/**
 * Compact game-situation control for the call screen: inning/half, outs,
 * base runners (tap the diamond), and score. Everything is coach-set —
 * predictable over clever — and stamped onto each pitch for later analysis.
 */
export default function SituationBar({
  s,
  set,
  newHalf,
  spray = [],
}: {
  s: Situation;
  set: (patch: Partial<Situation>) => void;
  newHalf: () => void;
  spray?: SprayMarker[];
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border-2 border-primary/40 bg-card px-3.5 py-3">
      {/* ghost spray chart of this game's balls in play, behind the controls */}
      {spray.length > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.12]"
        >
          <FieldChart className="h-full w-auto max-w-none" markers={spray} />
        </div>
      )}
      <div className="relative mb-2.5 flex items-center justify-between">
        <span className="text-[11px] font-bold tracking-widest text-primary">
          SITUATION
        </span>
        <span className="text-[11px] font-semibold tracking-wide text-muted-foreground">
          {basesLabel(s)}
        </span>
      </div>
      <div className="relative flex flex-wrap items-center gap-x-4 gap-y-2.5">
        {/* inning + half */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold tracking-widest text-muted-foreground">
            INN
          </span>
          <button
            onClick={() => set({ half: s.half === "top" ? "bottom" : "top" })}
            aria-label={`Half-inning: ${s.half}, tap to toggle`}
            className="press rounded-xl border px-3 py-1.5 text-sm font-bold"
          >
            {s.half === "top" ? "▲" : "▼"}
          </button>
          <Stepper
            value={s.inning}
            onDelta={(d) => set({ inning: Math.max(1, s.inning + d) })}
          />
        </div>

        {/* outs — tap to cycle 0→1→2 */}
        <button
          onClick={() => set({ outs: (s.outs + 1) % 3 })}
          aria-label={`${s.outs} out, tap to change`}
          className="press flex items-center gap-1.5"
        >
          <span className="text-[10px] font-semibold tracking-widest text-muted-foreground">
            OUTS
          </span>
          <span className="flex gap-1">
            {[0, 1].map((i) => (
              <span
                key={i}
                aria-hidden
                className={cn(
                  "size-4 rounded-full border-2",
                  i < s.outs
                    ? "border-primary bg-primary"
                    : "border-muted-foreground/50"
                )}
              />
            ))}
          </span>
        </button>

        {/* bases */}
        <Diamond s={s} set={set} />

        {/* new half-inning: clear outs + bases, advance */}
        <button
          onClick={newHalf}
          aria-label="New half-inning — clear outs and bases"
          className="press ml-auto rounded-lg border px-2.5 py-1.5 text-[11px] font-bold tracking-wide text-muted-foreground hover:bg-accent"
        >
          NEW ½
        </button>
      </div>

      {/* score — we're on defense */}
      <div className="relative mt-2.5 flex items-center gap-5 border-t pt-2.5">
        <ScoreStep label="US" value={s.us} onDelta={(d) => set({ us: Math.max(0, s.us + d) })} accent />
        <ScoreStep label="OPP" value={s.them} onDelta={(d) => set({ them: Math.max(0, s.them + d) })} />
      </div>
    </div>
  );
}

function Stepper({
  value,
  onDelta,
}: {
  value: number;
  onDelta: (d: number) => void;
}) {
  return (
    <span className="flex items-center gap-1">
      <button
        onClick={() => onDelta(-1)}
        aria-label="Decrease"
        className="press size-9 rounded-xl border text-base font-bold leading-none text-muted-foreground hover:bg-accent"
      >
        −
      </button>
      <span className="scoreboard min-w-5 text-center font-mono text-base font-extrabold">
        {value}
      </span>
      <button
        onClick={() => onDelta(1)}
        aria-label="Increase"
        className="press size-9 rounded-xl border text-base font-bold leading-none text-muted-foreground hover:bg-accent"
      >
        +
      </button>
    </span>
  );
}

function ScoreStep({
  label,
  value,
  onDelta,
  accent,
}: {
  label: string;
  value: number;
  onDelta: (d: number) => void;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-semibold tracking-widest text-muted-foreground">
        {label}
      </span>
      <button
        onClick={() => onDelta(-1)}
        aria-label={`${label} minus`}
        className="press size-9 rounded-xl border text-base font-bold leading-none text-muted-foreground hover:bg-accent"
      >
        −
      </button>
      <span
        className={cn(
          "scoreboard min-w-6 text-center font-mono text-lg font-extrabold",
          accent ? "text-primary" : "text-foreground"
        )}
      >
        {value}
      </span>
      <button
        onClick={() => onDelta(1)}
        aria-label={`${label} plus`}
        className="press size-9 rounded-xl border text-base font-bold leading-none text-muted-foreground hover:bg-accent"
      >
        +
      </button>
    </div>
  );
}

/** Tappable base diamond: home bottom, 1st right, 2nd top, 3rd left. */
function Diamond({
  s,
  set,
}: {
  s: Situation;
  set: (patch: Partial<Situation>) => void;
}) {
  const base = (on: boolean, cx: number, cy: number, toggle: () => void, label: string) => (
    <g
      onClick={toggle}
      role="button"
      aria-label={`${label} ${on ? "occupied, tap to clear" : "empty, tap to set"}`}
      style={{ cursor: "pointer" }}
    >
      {/* generous transparent hit area for finger taps */}
      <circle cx={cx} cy={cy} r={16} fill="transparent" />
      <circle
        cx={cx}
        cy={cy}
        r={10}
        fill={on ? "var(--primary)" : "var(--card)"}
        stroke={on ? "var(--primary)" : "var(--muted-foreground)"}
        strokeWidth={2.5}
      />
    </g>
  );
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-semibold tracking-widest text-muted-foreground">
        BASES
      </span>
      <svg viewBox="0 0 60 60" className="h-20 w-20" aria-hidden="false">
        {/* diamond guide */}
        <path
          d="M30 50 L50 30 L30 10 L10 30 Z"
          fill="none"
          stroke="var(--border)"
          strokeWidth={2}
        />
        {base(s.on1, 50, 30, () => set({ on1: !s.on1 }), "First base")}
        {base(s.on2, 30, 10, () => set({ on2: !s.on2 }), "Second base")}
        {base(s.on3, 10, 30, () => set({ on3: !s.on3 }), "Third base")}
        {/* home plate marker */}
        <rect x="25" y="45" width="10" height="10" rx="2" fill="var(--muted-foreground)" />
      </svg>
    </div>
  );
}
