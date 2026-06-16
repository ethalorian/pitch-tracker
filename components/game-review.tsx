"use client";

import { useMemo, useState } from "react";
import FieldChart, { type SprayMarker } from "@/components/field-chart";
import SequencingView from "@/components/sequencing-view";
import { STANDARD_PITCHES, type PitchDef } from "@/lib/catalog";
import {
  ZONES,
  swingOf,
  type AbResult,
  type Batter,
  type Pitch,
  type Pitcher,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Read-only analytics over a set of pitches — used for a single past
 * game and for a team's pooled scouting corpus. Filterable by pitcher.
 */
export default function GameReview({
  pitchers,
  batters,
  pitches,
  abResults = [],
}: {
  pitchers: Pitcher[];
  batters: Batter[];
  pitches: Pitch[];
  abResults?: AbResult[];
}) {
  const [filter, setFilter] = useState<string | "all">("all");

  const defs = useMemo<PitchDef[]>(() => {
    const all: PitchDef[] = [];
    for (const p of pitchers)
      for (const d of p.pitches)
        if (!all.some((x) => x.k === d.k)) all.push(d);
    return all.length ? all : STANDARD_PITCHES;
  }, [pitchers]);

  const shown = useMemo(
    () =>
      (filter === "all"
        ? pitches
        : pitches.filter((p) => (p.pitcherId ?? null) === filter)
      ).filter((p) => p.outcome != null),
    [pitches, filter]
  );

  const stats = useMemo(() => {
    const isStrike = (p: Pitch) => p.outcome !== "ball";
    const total = shown.length;
    const strikes = shown.filter(isStrike).length;
    const first = shown.filter((p) => p.b === 0 && p.s === 0);
    const fps = first.filter(isStrike).length;
    return {
      total,
      strikePct: total ? Math.round((strikes / total) * 100) : null,
      fpsPct: first.length ? Math.round((fps / first.length) * 100) : null,
    };
  }, [shown]);

  const teamSpray = useMemo<SprayMarker[]>(
    () =>
      shown
        .filter((p) => p.contact?.x != null && p.contact?.y != null)
        .map((p) => ({
          x: p.contact!.x!,
          y: p.contact!.y!,
          quality: p.contact!.quality,
          trajectory: p.contact!.trajectory,
        })),
    [shown]
  );

  // batters present, keyed by jersey so the same hitter pools across games
  const batterGroups = useMemo(() => {
    const byJersey: Record<string, { batter: Batter; pitches: Pitch[] }> = {};
    const lookup = new Map(batters.map((b) => [b.id, b]));
    for (const p of shown) {
      const b = lookup.get(p.batterId);
      const jersey = b?.jersey ?? "?";
      byJersey[jersey] = byJersey[jersey] ?? {
        batter: b ?? { id: jersey, jersey, hand: "R" },
        pitches: [],
      };
      byJersey[jersey].pitches.push(p);
    }
    return Object.values(byJersey).sort(
      (a, b) => b.pitches.length - a.pitches.length
    );
  }, [shown, batters]);

  if (!shown.length) {
    return (
      <div className="p-5 text-sm text-muted-foreground/60">
        No pitches logged for this selection.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* pitcher filter */}
      {pitchers.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <Chip on={filter === "all"} onClick={() => setFilter("all")}>
            ALL
          </Chip>
          {pitchers
            .filter((p) => pitches.some((x) => x.pitcherId === p.id))
            .map((p) => (
              <Chip
                key={p.id}
                on={filter === p.id}
                onClick={() => setFilter(p.id)}
              >
                {p.name}
              </Chip>
            ))}
        </div>
      )}

      {/* stat line */}
      <div className="grid grid-cols-3 gap-1.5">
        {(
          [
            ["PITCHES", stats.total],
            ["STRIKE %", stats.strikePct ?? "—"],
            ["1ST-PITCH K %", stats.fpsPct ?? "—"],
          ] as const
        ).map(([l, v]) => (
          <div
            key={l}
            className="tile-accent rounded-2xl border border-border/70 bg-card px-3 py-2.5 text-center"
          >
            <div className="text-[10px] font-semibold tracking-widest text-muted-foreground">
              {l}
            </div>
            <div className="scoreboard font-mono text-2xl font-extrabold text-primary tnum">
              {v}
            </div>
          </div>
        ))}
      </div>

      {/* team spray */}
      {teamSpray.length > 0 && (
        <div className="rounded-2xl border bg-card p-4">
          <div className="mb-2 text-xs font-bold tracking-widest text-muted-foreground">
            TEAM SPRAY · {teamSpray.length} IN PLAY
          </div>
          <FieldChart className="w-full" markers={teamSpray} />
        </div>
      )}

      {/* sequencing */}
      <div>
        <div className="mb-2 text-xs font-bold tracking-widest text-muted-foreground">
          SEQUENCING · what finishes hitters
        </div>
        <SequencingView pitches={shown} abResults={abResults} defs={defs} />
      </div>

      {/* per-batter */}
      {batterGroups.map(({ batter, pitches: bp }) => (
        <BatterCard key={batter.jersey} batter={batter} pitches={bp} />
      ))}
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "press rounded-2xl border px-3 py-1.5 text-xs font-bold tracking-wide",
        on
          ? "border-primary bg-primary/15 text-primary"
          : "border-border text-muted-foreground hover:bg-accent"
      )}
    >
      {children}
    </button>
  );
}

function BatterCard({
  batter,
  pitches,
}: {
  batter: Batter;
  pitches: Pitch[];
}) {
  const combos: Record<string, { contact: number; miss: number; hard: number }> =
    {};
  const spray: SprayMarker[] = [];
  pitches.forEach((p) => {
    const sw = swingOf(p.outcome);
    if (sw === "contact" || sw === "miss") {
      const k = `${p.type} ${ZONES[p.zone]}`;
      combos[k] = combos[k] ?? { contact: 0, miss: 0, hard: 0 };
      combos[k][sw === "contact" ? "contact" : "miss"]++;
      if (sw === "contact" && p.contact?.quality === "hard") combos[k].hard++;
    }
    if (p.contact?.x != null && p.contact?.y != null) {
      spray.push({
        x: p.contact.x,
        y: p.contact.y,
        quality: p.contact.quality,
        trajectory: p.contact.trajectory,
      });
    }
  });
  const hits = Object.entries(combos)
    .filter(([, v]) => v.contact > 0)
    .sort((a, b) => b[1].hard - a[1].hard || b[1].contact - a[1].contact);
  const whiffs = Object.entries(combos)
    .filter(([, v]) => v.miss > 0 && v.miss >= v.contact)
    .sort((a, b) => b[1].miss - a[1].miss);

  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="mb-3 text-lg font-bold">
        <span className="scoreboard font-mono font-extrabold text-primary tnum">
          #{batter.jersey}
        </span>
        {batter.name && <span className="ml-2">{batter.name}</span>}
        <span className="ml-2 text-sm font-normal text-muted-foreground">
          {batter.hand}HH · {pitches.length} seen
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_1.2fr]">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-red-500/50 p-2.5">
            <div className="mb-1.5 text-[10px] font-bold tracking-widest text-red-600 dark:text-red-400">
              ON THESE
            </div>
            {hits.length ? (
              hits.map(([k, v]) => (
                <div key={k} className="py-1 font-mono text-xs tnum">
                  <span className="font-bold text-red-600 dark:text-red-400">
                    {v.contact}×
                  </span>{" "}
                  {k}
                  {v.hard > 0 && (
                    <span className="ml-1 font-bold text-red-600 dark:text-red-400">
                      ({v.hard}H)
                    </span>
                  )}
                </div>
              ))
            ) : (
              <div className="font-mono text-xs text-muted-foreground/60">—</div>
            )}
          </div>
          <div className="rounded-2xl border border-blue-500/50 p-2.5">
            <div className="mb-1.5 text-[10px] font-bold tracking-widest text-blue-600 dark:text-blue-400">
              MISSING
            </div>
            {whiffs.length ? (
              whiffs.map(([k, v]) => (
                <div key={k} className="py-1 font-mono text-xs tnum">
                  <span className="font-bold text-blue-600 dark:text-blue-400">
                    {v.miss}×
                  </span>{" "}
                  {k}
                </div>
              ))
            ) : (
              <div className="font-mono text-xs text-muted-foreground/60">—</div>
            )}
          </div>
        </div>
        {spray.length > 0 ? (
          <FieldChart className="w-full" markers={spray} />
        ) : (
          <div className="flex items-center justify-center rounded-2xl border border-dashed text-xs text-muted-foreground/50">
            no balls in play
          </div>
        )}
      </div>
    </div>
  );
}
