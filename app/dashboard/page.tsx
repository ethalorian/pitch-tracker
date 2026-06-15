"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import AppHeader, { Skeleton } from "@/components/app-header";
import SequencingView from "@/components/sequencing-view";
import { listGamesFull, listPitchers } from "@/lib/supabase/sync";
import {
  aggregatePitcherSeason,
  type GameBundle,
} from "@/lib/pitcher-stats";
import { pitchDef, STANDARD_PITCHES, type PitchDef } from "@/lib/catalog";
import { cn } from "@/lib/utils";
import type { AbResult, Pitch, Pitcher } from "@/lib/types";

const emptySubscribe = () => () => {};

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso.slice(5, 10);
  }
}

export default function DashboardPage() {
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
  const [pitchers, setPitchers] = useState<Pitcher[]>([]);
  const [bundles, setBundles] = useState<GameBundle[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    Promise.all([listPitchers(), listGamesFull()]).then(([ps, games]) => {
      if (!live) return;
      setPitchers(ps);
      setBundles(
        games
          .filter((g) => g.state)
          .map((g) => ({
            id: g.id,
            label: `${g.opponent ?? "?"} ${fmt(g.startedAt)}`,
            state: g.state!,
          }))
      );
      setSel(ps[0]?.id ?? null);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, []);

  const pitcher = pitchers.find((p) => p.id === sel) ?? null;
  const defs: PitchDef[] = pitcher?.pitches.length
    ? pitcher.pitches
    : STANDARD_PITCHES;

  const season = useMemo(
    () => (sel ? aggregatePitcherSeason(bundles, sel) : null),
    [bundles, sel]
  );

  // pooled pitches + abResults (ab-namespaced per game) for sequencing
  const pooled = useMemo(() => {
    const pitches: Pitch[] = [];
    const abResults: AbResult[] = [];
    if (!sel) return { pitches, abResults };
    bundles.forEach((b, gi) => {
      const base = gi * 100000;
      b.state.pitches
        .filter((p) => (p.pitcherId ?? null) === sel)
        .forEach((p) => pitches.push({ ...p, ab: p.ab + base }));
      b.state.abResults.forEach((r) =>
        abResults.push({ ...r, ab: r.ab + base })
      );
    });
    return { pitches, abResults };
  }, [bundles, sel]);

  if (!mounted) return null;

  return (
    <div className="mx-auto w-full max-w-[760px] pb-24 font-sans">
      <AppHeader title="PITCHER" accent="DASH" />

      <div className="px-3.5 py-3">
        {loading ? (
          <div role="status" aria-label="Loading dashboard">
            <div className="mb-3 flex gap-1.5">
              <Skeleton className="h-10 w-24" />
              <Skeleton className="h-10 w-24" />
            </div>
            <div className="mb-4 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
            <Skeleton className="h-48" />
          </div>
        ) : pitchers.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No pitchers yet. Add them on the coach screen.
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {pitchers.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSel(p.id)}
                  aria-pressed={p.id === sel}
                  className={cn(
                    "press rounded-lg border px-3 py-2 text-sm font-bold",
                    p.id === sel
                      ? "border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      : "border-border text-foreground hover:bg-accent"
                  )}
                >
                  {p.name}
                </button>
              ))}
            </div>

            {!season || season.totalPitches === 0 ? (
              <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                No game data for {pitcher?.name ?? "this pitcher"} yet.
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {/* headline */}
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                  <Stat label="GAMES" value={season.games} />
                  <Stat label="PITCHES" value={season.totalPitches} />
                  <Stat
                    label="STRIKE %"
                    value={season.strikePct ?? "—"}
                  />
                  <Stat label="1ST-K %" value={season.fpsPct ?? "—"} />
                  <Stat label="WHIFF %" value={season.whiffPct ?? "—"} />
                  <Stat label="K / BB" value={`${season.ks}/${season.bbs}`} />
                </div>

                {/* per-pitch effectiveness */}
                <div>
                  <div className="mb-2 text-xs font-bold tracking-widest text-muted-foreground">
                    PER-PITCH EFFECTIVENESS
                  </div>
                  <div className="overflow-hidden rounded-xl border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-card/50 text-[10px] tracking-widest text-muted-foreground">
                          <th className="px-2 py-1.5 text-left">PITCH</th>
                          <th className="px-2 py-1.5 text-right">USE</th>
                          <th className="px-2 py-1.5 text-right">STR</th>
                          <th className="px-2 py-1.5 text-right">WHIFF</th>
                          <th className="px-2 py-1.5 text-right">HARD</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono">
                        {season.perPitch.map((s) => {
                          const d = pitchDef(defs, s.type);
                          return (
                            <tr key={s.type} className="border-b last:border-0">
                              <td className="px-2 py-2 font-bold" style={{ color: d.c }}>
                                {s.type}
                                <span className="ml-1 font-sans text-[10px] font-normal text-muted-foreground">
                                  {s.count}
                                </span>
                              </td>
                              <td className="px-2 py-2 text-right text-muted-foreground">
                                {s.usagePct}%
                              </td>
                              <td className="px-2 py-2 text-right">
                                {s.strikePct}%
                              </td>
                              <td className="px-2 py-2 text-right font-bold text-blue-600 dark:text-blue-400">
                                {s.whiffPct}%
                              </td>
                              <td className="px-2 py-2 text-right font-bold text-red-600 dark:text-red-400">
                                {s.hard}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground/60">
                    WHIFF% is your swing-and-miss rate per pitch — your
                    out-pitch is the high-whiff, low-hard line.
                  </div>
                </div>

                {/* per-game command trend */}
                <div>
                  <div className="mb-2 text-xs font-bold tracking-widest text-muted-foreground">
                    GAME-BY-GAME · strike% (bar) · whiff% (dot)
                  </div>
                  <div className="flex items-end gap-1.5 overflow-x-auto rounded-xl border bg-card p-3">
                    {season.perGame.map((g) => (
                      <div
                        key={g.id}
                        className="flex w-9 shrink-0 flex-col items-center gap-1"
                        title={`${g.label}: ${g.strikePct}% strikes, ${g.whiffPct}% whiff, ${g.ks}K`}
                      >
                        <div className="relative flex h-24 w-5 items-end rounded bg-muted">
                          <div
                            className="w-full rounded bg-amber-500"
                            style={{ height: `${g.strikePct ?? 0}%` }}
                          />
                          <div
                            className="absolute left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-blue-500"
                            style={{ bottom: `${g.whiffPct ?? 0}%` }}
                          />
                        </div>
                        <div className="text-[9px] text-muted-foreground">
                          {g.label.split(" ").slice(-1)[0]}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* sequencing across the season */}
                <div>
                  <div className="mb-2 text-xs font-bold tracking-widest text-muted-foreground">
                    SEASON SEQUENCING · what finishes hitters
                  </div>
                  <SequencingView
                    pitches={pooled.pitches}
                    abResults={pooled.abResults}
                    defs={defs}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="tile-accent rounded-xl border border-border/70 bg-card px-2 py-2 text-center">
      <div className="text-[9px] font-semibold tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="scoreboard font-mono text-xl font-extrabold text-primary">
        {value}
      </div>
    </div>
  );
}
