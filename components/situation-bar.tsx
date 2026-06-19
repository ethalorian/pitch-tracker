"use client";

import { cn } from "@/lib/utils";
import { basesLabel } from "@/lib/situation";
import FieldChart, { type SprayMarker } from "@/components/field-chart";
import type { Situation } from "@/lib/types";

/**
 * Game-situation control for the call screen. The hero is a ghosted field
 * showing the current batter's balls in play, with the base runners tapped
 * directly onto their true positions — so you read the real picture at a
 * glance. Inning, outs and score sit below. All coach-set, stamped per pitch.
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
    <div className="flex h-full flex-col rounded-2xl border-2 border-primary/40 bg-card px-3.5 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-bold tracking-widest text-primary">
          SITUATION
        </span>
        <span className="text-[11px] font-semibold tracking-wide text-muted-foreground">
          {basesLabel(s)}
        </span>
      </div>

      {/* field: ghosted spray for the batter at bat, tappable bases overlaid */}
      <div className="mb-3 overflow-hidden rounded-xl border bg-background/40">
        <FieldChart
          className="w-full"
          ghost
          markers={spray}
          bases={{ on1: s.on1, on2: s.on2, on3: s.on3 }}
          onBase={(k) => set({ [k]: !s[k] } as Partial<Situation>)}
        />
      </div>

      {/* inning · outs · new half */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
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
        <ScoreStep
          label="US"
          value={s.us}
          onDelta={(d) => set({ us: Math.max(0, s.us + d) })}
          accent
        />
        <ScoreStep
          label="OPP"
          value={s.them}
          onDelta={(d) => set({ them: Math.max(0, s.them + d) })}
        />
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
