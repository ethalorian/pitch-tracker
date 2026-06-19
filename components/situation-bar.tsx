"use client";

import { cn } from "@/lib/utils";
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
}: {
  s: Situation;
  set: (patch: Partial<Situation>) => void;
  newHalf: () => void;
}) {
  return (
    <div className="rounded-2xl border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        {/* inning + half */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold tracking-widest text-muted-foreground">
            INN
          </span>
          <button
            onClick={() => set({ half: s.half === "top" ? "bottom" : "top" })}
            aria-label={`Half-inning: ${s.half}, tap to toggle`}
            className="press rounded-lg border px-2 py-1 text-xs font-bold"
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
                  "size-3 rounded-full border-2",
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
      <div className="mt-2.5 flex items-center gap-5 border-t pt-2.5">
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
        className="press size-6 rounded-lg border text-sm font-bold leading-none text-muted-foreground hover:bg-accent"
      >
        −
      </button>
      <span className="scoreboard min-w-5 text-center font-mono text-base font-extrabold">
        {value}
      </span>
      <button
        onClick={() => onDelta(1)}
        aria-label="Increase"
        className="press size-6 rounded-lg border text-sm font-bold leading-none text-muted-foreground hover:bg-accent"
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
        className="press size-6 rounded-lg border text-sm font-bold leading-none text-muted-foreground hover:bg-accent"
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
        className="press size-6 rounded-lg border text-sm font-bold leading-none text-muted-foreground hover:bg-accent"
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
    <circle
      cx={cx}
      cy={cy}
      r={7}
      onClick={toggle}
      role="button"
      aria-label={`${label} ${on ? "occupied" : "empty"}`}
      style={{ cursor: "pointer" }}
      fill={on ? "var(--primary)" : "var(--card)"}
      stroke={on ? "var(--primary)" : "var(--muted-foreground)"}
      strokeWidth={2}
    />
  );
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-semibold tracking-widest text-muted-foreground">
        BASES
      </span>
      <svg viewBox="0 0 60 60" className="h-12 w-12" aria-hidden="false">
        {/* diamond guide */}
        <path
          d="M30 50 L50 30 L30 10 L10 30 Z"
          fill="none"
          stroke="var(--border)"
          strokeWidth={1.5}
        />
        {base(s.on1, 50, 30, () => set({ on1: !s.on1 }), "First base")}
        {base(s.on2, 30, 10, () => set({ on2: !s.on2 }), "Second base")}
        {base(s.on3, 10, 30, () => set({ on3: !s.on3 }), "Third base")}
        {/* home plate marker */}
        <rect x="26" y="46" width="8" height="8" rx="1.5" fill="var(--muted-foreground)" />
      </svg>
    </div>
  );
}
