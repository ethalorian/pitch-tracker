import { swingOf, type AbResult, type Pitch } from "@/lib/types";

/**
 * Live pitcher-status read for ONE pitcher, this game. Two SEPARATE
 * detectors, because they call for opposite responses:
 *
 *  - command (TIRING): she's lost the strike zone vs. her own early
 *    baseline — strike% / first-pitch-strike% sliding, balls climbing.
 *    Response: rest or pull her.
 *  - contact (ON HER): the lineup has caught up — hard contact rising,
 *    whiffs turning into contact, put-aways fouled off, louder the 2nd
 *    time through. Response: change sequencing / flip locations.
 *
 * Everything compares a RECENT window to an EARLY baseline of the same
 * pitcher, on-device, and stays quiet until the sample is real. There is
 * no velocity input, so "tiring" is inferred from command + results.
 *
 * Thresholds are deliberately conservative and live here as named
 * constants so they're a one-line tune.
 */

export const HIGH_PITCH_COUNT = 95; // soft workload flag — tune per league/age
const MIN_TOTAL = 22; // logged pitches needed before we judge anything
const MIN_WINDOW = 10; // floor for the baseline / recent windows
const BLOCK = 15; // trend block size (pitches)

// command (tiring) — conservative: strike% naturally bounces, so only
// flag drops large enough to clear normal game-to-game noise.
const STRIKE_DROP_ALERT = 18; // recent strike% this far under baseline → TIRING
const STRIKE_DROP_WATCH = 12;

// contact (on her)
const HARD_RECENT_ALERT = 3; // hard-contact in the recent window → ON HER
const HARD_RECENT_WATCH = 2;
const WHIFF_DROP_WATCH = 15; // recent whiff% this far under baseline → WATCH
const TTO_HARD_JUMP = 15; // hard% jump 2nd+ time through the order → note

export type StatusLevel = "ok" | "watch" | "alert" | "thin";

export interface DetectorResult {
  level: StatusLevel;
  headline: string;
  reason: string;
}

export interface TrendBlock {
  label: string;
  pitches: number;
  strikePct: number;
  hard: number;
}

export interface PitcherStatus {
  pitcherId: string | null;
  total: number;
  pitchCount: number;
  baseStrikePct: number;
  recentStrikePct: number;
  command: DetectorResult; // tiring
  contact: DetectorResult; // on her
  blocks: TrendBlock[];
  timesThru: {
    firstHardPct: number | null;
    laterHardPct: number | null;
    note: string | null;
  };
}

const pct = (num: number, den: number) =>
  den ? Math.round((num / den) * 100) : 0;
const isStrike = (p: Pitch) => p.outcome != null && p.outcome !== "ball";
const isBall = (p: Pitch) => p.outcome === "ball";
const isHard = (p: Pitch) => p.contact?.quality === "hard";
const isSwing = (p: Pitch) => {
  const s = swingOf(p.outcome);
  return s === "contact" || s === "miss";
};

export function analyzePitcherStatus(
  pitchesIn: Pitch[],
  _abResults: AbResult[]
): PitcherStatus {
  const logged = pitchesIn
    .filter((p) => p.outcome != null)
    .sort((a, b) => a.ts - b.ts);
  const total = logged.length;
  const pitcherId = logged[0]?.pitcherId ?? null;

  // ── trend blocks: even-sized so there's no tiny trailing remainder ──
  const blocks: TrendBlock[] = [];
  const nBlocks = Math.max(1, Math.round(total / BLOCK));
  const size = Math.max(1, Math.ceil(total / nBlocks));
  for (let i = 0; i < total; i += size) {
    const seg = logged.slice(i, i + size);
    if (!seg.length) break;
    blocks.push({
      label: `${i + 1}-${Math.min(i + size, total)}`,
      pitches: seg.length,
      strikePct: pct(seg.filter(isStrike).length, seg.length),
      hard: seg.filter(isHard).length,
    });
  }

  // ── baseline vs recent windows ──
  const win = Math.max(MIN_WINDOW, Math.round(total / 3));
  const base = logged.slice(0, win);
  const recent = logged.slice(-win);
  const baseStrikePct = pct(base.filter(isStrike).length, base.length);
  const recentStrikePct = pct(recent.filter(isStrike).length, recent.length);

  // ── times-through-the-order: hard contact on 1st PA vs 2nd+ PA ──
  const absByBatter = new Map<string, number[]>();
  for (const p of logged) {
    const arr = absByBatter.get(p.batterId) ?? [];
    if (!arr.includes(p.ab)) arr.push(p.ab);
    absByBatter.set(p.batterId, arr);
  }
  for (const arr of absByBatter.values()) arr.sort((a, b) => a - b);
  let firstC = 0,
    firstH = 0,
    lateC = 0,
    lateH = 0;
  for (const p of logged) {
    if (swingOf(p.outcome) !== "contact") continue;
    const paIdx = absByBatter.get(p.batterId)!.indexOf(p.ab);
    const hard = isHard(p) ? 1 : 0;
    if (paIdx <= 0) {
      firstC++;
      firstH += hard;
    } else {
      lateC++;
      lateH += hard;
    }
  }
  const firstHardPct = firstC ? pct(firstH, firstC) : null;
  const laterHardPct = lateC ? pct(lateH, lateC) : null;
  const ttoNote =
    firstHardPct != null &&
    laterHardPct != null &&
    lateC >= 4 &&
    laterHardPct - firstHardPct >= TTO_HARD_JUMP
      ? `2nd+ time thru: hard ${firstHardPct}%→${laterHardPct}%`
      : null;

  // ── not enough yet: stay quiet ──
  if (total < MIN_TOTAL) {
    const thin: DetectorResult = {
      level: "thin",
      headline: "BUILDING",
      reason: `need ${MIN_TOTAL - total} more pitches`,
    };
    return {
      pitcherId,
      total,
      pitchCount: total,
      baseStrikePct,
      recentStrikePct,
      command: thin,
      contact: { ...thin },
      blocks,
      timesThru: { firstHardPct, laterHardPct, note: ttoNote },
    };
  }

  // ── command (tiring) ──
  const drop = baseStrikePct - recentStrikePct; // positive = falling off
  const recentBallPct = pct(recent.filter(isBall).length, recent.length);
  const baseBallPct = pct(base.filter(isBall).length, base.length);
  const highWorkload = total >= HIGH_PITCH_COUNT;
  let command: DetectorResult;
  const cmdReason =
    `strike% ${baseStrikePct}→${recentStrikePct}` +
    (recentBallPct - baseBallPct >= 10
      ? ` · balls ${baseBallPct}→${recentBallPct}`
      : "") +
    (highWorkload ? ` · ${total} pitches` : "");
  if (drop >= STRIKE_DROP_ALERT) {
    command = { level: "alert", headline: "TIRING", reason: cmdReason };
  } else if (drop >= STRIKE_DROP_WATCH || highWorkload) {
    command = { level: "watch", headline: "WATCH", reason: cmdReason };
  } else {
    command = { level: "ok", headline: "DEALING", reason: cmdReason };
  }

  // ── contact (on her) ──
  const recentHard = recent.filter(isHard).length;
  const baseSwings = base.filter(isSwing).length;
  const recentSwings = recent.filter(isSwing).length;
  const baseWhiffPct = pct(base.filter((p) => swingOf(p.outcome) === "miss").length, baseSwings);
  const recentWhiffPct = pct(
    recent.filter((p) => swingOf(p.outcome) === "miss").length,
    recentSwings
  );
  const whiffDrop = baseWhiffPct - recentWhiffPct;
  let contact: DetectorResult;
  const conReason =
    `${recentHard} hard last ${recent.length}` +
    (recentSwings >= 4 && whiffDrop >= 10
      ? ` · whiffs ${baseWhiffPct}→${recentWhiffPct}%`
      : "") +
    (ttoNote ? ` · ${ttoNote}` : "");
  if (recentHard >= HARD_RECENT_ALERT) {
    contact = { level: "alert", headline: "ON HER", reason: conReason };
  } else if (
    recentHard >= HARD_RECENT_WATCH ||
    (recentSwings >= 4 && whiffDrop >= WHIFF_DROP_WATCH) ||
    ttoNote
  ) {
    contact = { level: "watch", headline: "WATCH", reason: conReason };
  } else {
    contact = { level: "ok", headline: "QUIET", reason: conReason };
  }

  return {
    pitcherId,
    total,
    pitchCount: total,
    baseStrikePct,
    recentStrikePct,
    command,
    contact,
    blocks,
    timesThru: { firstHardPct, laterHardPct, note: ttoNote },
  };
}
