"use client";

import { cn } from "@/lib/utils";
import type { DetectorResult, PitcherStatus } from "@/lib/pitcher-status";

/**
 * GAME-tab monitor: two separate reads on one pitcher — is she TIRING
 * (command fading) and are they ON HER (lineup catching up) — plus a
 * command-trend strip. Factual, conservative, on-device. It flags the
 * trend; the coach decides whether to pull her or change the pattern.
 */

const LEVEL_TEXT: Record<string, string> = {
  ok: "text-green-600 dark:text-green-400",
  watch: "text-primary",
  alert: "text-red-600 dark:text-red-400",
  thin: "text-muted-foreground",
};

const LEVEL_BORDER: Record<string, string> = {
  ok: "border-l-green-500",
  watch: "border-l-primary",
  alert: "border-l-red-500",
  thin: "border-l-border",
};

function DetectorRow({
  kind,
  d,
}: {
  kind: string;
  d: DetectorResult;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl border border-l-4 bg-card px-3 py-2.5",
        LEVEL_BORDER[d.level]
      )}
    >
      <div className="min-w-[88px]">
        <div className="text-[11px] font-semibold tracking-widest text-muted-foreground">
          {kind}
        </div>
        <div className={cn("text-base font-extrabold leading-tight", LEVEL_TEXT[d.level])}>
          {d.headline}
        </div>
      </div>
      <div className="flex-1 font-mono text-xs leading-snug text-muted-foreground">
        {d.reason}
      </div>
    </div>
  );
}

export default function PitcherStatusPanel({
  name,
  status,
}: {
  name: string;
  status: PitcherStatus;
}) {
  const { blocks } = status;
  const maxStrike = Math.max(100, ...blocks.map((b) => b.strikePct));
  const barColor = (v: number) =>
    v >= 60 ? "#36d67a" : v >= 45 ? "var(--primary)" : "#ff5a3c";

  return (
    <div className="rounded-2xl border bg-card/40 p-3">
      <div className="mb-2.5 flex items-baseline justify-between">
        <div className="text-xs font-bold tracking-widest text-muted-foreground">
          {name.toUpperCase()} · STATUS
        </div>
        <div className="scoreboard font-mono text-sm font-bold text-foreground">
          {status.pitchCount}
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            pitches
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <DetectorRow kind="TIRING?" d={status.command} />
        <DetectorRow kind="ON HER?" d={status.contact} />
      </div>

      {blocks.length > 1 && (
        <>
          <div className="mb-1.5 mt-3 text-[10px] font-semibold tracking-widest text-muted-foreground">
            COMMAND TREND · strike% by block
          </div>
          {/* bars: direct children of a fixed-height, bottom-aligned row */}
          <div className="flex h-24 items-end gap-1.5 pt-4">
            {blocks.map((b, i) => (
              <div
                key={i}
                className="relative flex-1 rounded-t-md"
                style={{
                  height: `${Math.max((b.strikePct / maxStrike) * 100, 2)}%`,
                  background: barColor(b.strikePct),
                }}
                title={`pitches ${b.label}: ${b.strikePct}% strikes, ${b.hard} hard`}
              >
                <span className="tnum absolute -top-4 left-1/2 -translate-x-1/2 font-mono text-[10px] font-bold text-muted-foreground">
                  {b.strikePct}
                </span>
              </div>
            ))}
          </div>
          {/* hard-contact per block, the "on her" trace */}
          <div className="mt-1 flex gap-1.5">
            {blocks.map((b, i) => (
              <div
                key={i}
                className="flex-1 text-center font-mono text-[11px] text-red-600/80 dark:text-red-400/80"
                title={`${b.hard} hard-hit`}
              >
                {b.hard > 0 ? `●${b.hard}` : ""}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
