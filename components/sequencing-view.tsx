"use client";

import { useMemo } from "react";
import { analyzeSequencing } from "@/lib/sequencing";
import type { AbResult, Pitch } from "@/lib/types";

/** Sequencing read-out: what finishes hitters. */
export default function SequencingView({
  pitches,
  abResults,
}: {
  pitches: Pitch[];
  abResults: AbResult[];
}) {
  const seq = useMemo(
    () => analyzeSequencing(pitches, abResults),
    [pitches, abResults]
  );

  const hasAny =
    seq.putAway.length ||
    seq.whiffs.length ||
    seq.afterWhiff.length ||
    seq.twoStrike.length;

  if (!hasAny) {
    return (
      <div className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
        Sequencing builds as you log swings and at-bat results.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* put-away pitch */}
      <Panel
        title="PUT-AWAY PITCH"
        sub={`${seq.totalKs} strikeout${seq.totalKs === 1 ? "" : "s"}`}
      >
        {seq.putAway.length ? (
          seq.putAway.map((c) => (
            <Row key={c.key} left={c.key} right={`${c.count} K`} accent="green" />
          ))
        ) : (
          <Empty>No strikeouts logged yet.</Empty>
        )}
      </Panel>

      {/* whiff generators */}
      <Panel title="SWING-AND-MISS" sub="whiffs · rate">
        {seq.whiffs.length ? (
          seq.whiffs
            .slice(0, 6)
            .map((c) => (
              <Row
                key={c.key}
                left={c.key}
                right={`${c.count} · ${c.extra ?? 0}%`}
                accent="blue"
              />
            ))
        ) : (
          <Empty>No whiffs yet.</Empty>
        )}
      </Panel>

      {/* after a whiff */}
      <Panel title="AFTER A WHIFF" sub="next pitch · finished it">
        {seq.afterWhiff.length ? (
          seq.afterWhiff
            .slice(0, 6)
            .map((c) => (
              <Row
                key={c.key}
                left={c.key}
                right={`${c.count}× · ${c.finished} fin`}
              />
            ))
        ) : (
          <Empty>No follow-up data yet.</Empty>
        )}
      </Panel>

      {/* two-strike approach */}
      <Panel title="TWO-STRIKE APPROACH" sub="K · foul · in-play · ball">
        {seq.twoStrike.length ? (
          seq.twoStrike.slice(0, 8).map((c) => (
            <div
              key={c.key}
              className="flex items-center justify-between py-0.5 font-mono text-xs"
            >
              <span className="text-card-foreground">{c.key}</span>
              <span className="flex gap-2">
                <span className="text-green-600 dark:text-green-400">{c.k}K</span>
                <span className="text-muted-foreground">{c.foul}F</span>
                <span className="text-red-600 dark:text-red-400">
                  {c.inplay}IP
                </span>
                <span className="text-muted-foreground/60">{c.ball}B</span>
              </span>
            </div>
          ))
        ) : (
          <Empty>No two-strike pitches yet.</Empty>
        )}
      </Panel>
    </div>
  );
}

function Panel({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[11px] font-bold tracking-widest text-muted-foreground">
          {title}
        </span>
        {sub && (
          <span className="text-[10px] tracking-wide text-muted-foreground/60">
            {sub}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function Row({
  left,
  right,
  accent,
}: {
  left: string;
  right: string;
  accent?: "green" | "blue";
}) {
  return (
    <div className="flex items-center justify-between py-0.5 font-mono text-xs">
      <span className="text-card-foreground">{left}</span>
      <span
        className={
          accent === "green"
            ? "font-bold text-green-600 dark:text-green-400"
            : accent === "blue"
              ? "font-bold text-blue-600 dark:text-blue-400"
              : "text-muted-foreground"
        }
      >
        {right}
      </span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-xs text-muted-foreground/60">{children}</div>
  );
}
