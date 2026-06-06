"use client";

import { useMemo } from "react";
import { analyzeSequencing, type ComboStat } from "@/lib/sequencing";
import { pitchDef, STANDARD_PITCHES, type PitchDef } from "@/lib/catalog";
import { ZONES, type AbResult, type Pitch } from "@/lib/types";

/** Graphical sequencing — what finishes hitters, at a glance. */
export default function SequencingView({
  pitches,
  abResults,
  defs = STANDARD_PITCHES,
}: {
  pitches: Pitch[];
  abResults: AbResult[];
  defs?: PitchDef[];
}) {
  const seq = useMemo(
    () => analyzeSequencing(pitches, abResults),
    [pitches, abResults]
  );
  const color = (type: string) => pitchDef(defs, type).c;

  const hasAny =
    seq.putAway.length ||
    seq.whiffs.length ||
    seq.afterWhiff.length ||
    seq.twoStrike.length;

  if (!hasAny) {
    return (
      <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        Sequencing builds as you log swings and at-bat results.
      </div>
    );
  }

  const topK = seq.putAway[0];
  const maxWhiff = Math.max(1, ...seq.whiffs.map((w) => w.count));
  const maxAfter = Math.max(1, ...seq.afterWhiff.map((a) => a.count));

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {/* hero: put-away pitch */}
      <Card className="md:col-span-2">
        <Header title="Put-away pitch" sub={`${seq.totalKs} K this set`} />
        {topK ? (
          <div className="mt-1 flex items-center gap-4">
            <Chip type={topK.type} zone={topK.zone} color={color(topK.type)} big />
            <div
              className="ml-auto font-mono text-4xl font-bold leading-none"
              style={{ color: color(topK.type) }}
            >
              {topK.count}
              <span className="ml-1 align-top text-sm text-muted-foreground">
                K
              </span>
            </div>
          </div>
        ) : (
          <Empty>No strikeouts yet.</Empty>
        )}
        {seq.putAway.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {seq.putAway.slice(1, 5).map((c) => (
              <span
                key={c.key}
                className="rounded-md border px-2 py-1 font-mono text-xs"
                style={{ borderColor: color(c.type), color: color(c.type) }}
              >
                {c.type} {ZONES[c.zone]} · {c.count}
              </span>
            ))}
          </div>
        )}
      </Card>

      {/* swing & miss bars */}
      <Card>
        <Header title="Swing & miss" sub="whiffs · rate" />
        {seq.whiffs.length ? (
          <div className="mt-1 flex flex-col gap-2">
            {seq.whiffs.slice(0, 6).map((c) => (
              <BarRow
                key={c.key}
                type={c.type}
                zone={c.zone}
                color={color(c.type)}
                pct={(c.count / maxWhiff) * 100}
                right={`${c.count} · ${c.extra ?? 0}%`}
              />
            ))}
          </div>
        ) : (
          <Empty>No whiffs yet.</Empty>
        )}
      </Card>

      {/* after a whiff */}
      <Card>
        <Header title="After a whiff" sub="next pitch · finished" />
        {seq.afterWhiff.length ? (
          <div className="mt-1 flex flex-col gap-2">
            {seq.afterWhiff.slice(0, 6).map((c) => {
              const finPct = c.count ? (c.finished / c.count) * 100 : 0;
              return (
                <div key={c.key} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 truncate font-mono text-xs">
                    {c.key}
                  </span>
                  <div className="relative h-4 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-muted-foreground/30"
                      style={{ width: `${(c.count / maxAfter) * 100}%` }}
                    />
                    <div
                      className="absolute top-0 h-full rounded-full bg-green-500"
                      style={{ width: `${(finPct / 100) * (c.count / maxAfter) * 100}%` }}
                    />
                  </div>
                  <span className="w-14 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                    {c.count}× {c.finished}✓
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty>No follow-ups yet.</Empty>
        )}
      </Card>

      {/* two-strike approach — stacked outcome bars */}
      <Card className="md:col-span-2">
        <Header title="Two-strike approach" sub="" />
        <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
          <Legend className="bg-green-500" label="K" />
          <Legend className="bg-muted-foreground/40" label="foul" />
          <Legend className="bg-red-500" label="in-play" />
          <Legend className="bg-blue-500/40" label="ball" />
        </div>
        {seq.twoStrike.length ? (
          <div className="flex flex-col gap-2">
            {seq.twoStrike.slice(0, 8).map((c) => {
              const t = c.thrown || 1;
              const seg = (n: number) => `${(n / t) * 100}%`;
              return (
                <div key={c.key} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 truncate font-mono text-xs">
                    {c.key}
                  </span>
                  <div className="flex h-5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="bg-green-500" style={{ width: seg(c.k) }} />
                    <div
                      className="bg-muted-foreground/40"
                      style={{ width: seg(c.foul) }}
                    />
                    <div className="bg-red-500" style={{ width: seg(c.inplay) }} />
                    <div className="bg-blue-500/40" style={{ width: seg(c.ball) }} />
                  </div>
                  <span className="w-10 shrink-0 text-right font-mono text-[11px] font-bold text-green-600 dark:text-green-400">
                    {c.k}K
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty>No two-strike pitches yet.</Empty>
        )}
      </Card>
    </div>
  );
}

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border bg-card p-3.5 ${className}`}>
      {children}
    </div>
  );
}

function Header({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-1 flex items-baseline justify-between">
      <span className="text-sm font-bold tracking-wide">{title}</span>
      {sub && (
        <span className="text-[10px] tracking-widest text-muted-foreground/70">
          {sub}
        </span>
      )}
    </div>
  );
}

function Chip({
  type,
  zone,
  color,
  big,
}: {
  type: string;
  zone: number;
  color: string;
  big?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`grid place-items-center rounded-xl font-mono font-bold text-black ${
          big ? "size-14 text-2xl" : "size-9 text-sm"
        }`}
        style={{ background: color }}
      >
        {type}
      </span>
      <span
        className={`font-semibold uppercase tracking-wide ${
          big ? "text-lg" : "text-sm"
        }`}
      >
        {ZONES[zone]}
      </span>
    </div>
  );
}

function BarRow({
  type,
  zone,
  color,
  pct,
  right,
}: {
  type: string;
  zone: number;
  color: string;
  pct: number;
  right: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 truncate font-mono text-xs">
        <span className="font-bold" style={{ color }}>
          {type}
        </span>{" "}
        {ZONES[zone]}
      </span>
      <div className="h-4 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="w-16 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
        {right}
      </span>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`size-2.5 rounded-sm ${className}`} />
      {label}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="py-2 font-mono text-xs text-muted-foreground/60">
      {children}
    </div>
  );
}

export type { ComboStat };
