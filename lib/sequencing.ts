import { ZONES, swingOf, type AbResult, type Pitch } from "@/lib/types";

/**
 * Sequencing analysis tuned for getting outs and strikeouts:
 *  - putAway: the pitch that finished each strikeout (your K pitch)
 *  - whiffs: pitch+location combos by swing-and-miss
 *  - afterWhiff: what you throw after a whiff, and whether it finishes
 *  - twoStrike: your 2-strike approach and how it resolves
 *
 * Works on any pitch set; for cross-game pooling, callers must keep each
 * pitch's `ab` aligned with its game's abResults (namespace ab per game).
 */

export interface ComboStat {
  key: string; // "DR lo-aw"
  type: string;
  zone: number;
  count: number;
  extra?: number; // context-specific secondary number
}

export interface AfterWhiffStat {
  key: string;
  count: number; // times this pitch followed a whiff
  finished: number; // of those, how many got a whiff or ended the AB in a K/out
}

export interface TwoStrikeStat {
  key: string;
  thrown: number;
  k: number; // called or swinging strike three
  foul: number; // stayed alive
  inplay: number;
  ball: number;
}

export interface Sequencing {
  putAway: ComboStat[];
  whiffs: ComboStat[];
  afterWhiff: AfterWhiffStat[];
  twoStrike: TwoStrikeStat[];
  totalKs: number;
}

const label = (p: Pitch) => `${p.type} ${ZONES[p.zone]}`;

function abPitches(pitches: Pitch[]): Map<number, Pitch[]> {
  const m = new Map<number, Pitch[]>();
  for (const p of pitches) {
    const arr = m.get(p.ab) ?? [];
    arr.push(p);
    m.set(p.ab, arr);
  }
  for (const arr of m.values()) arr.sort((a, b) => a.ts - b.ts);
  return m;
}

export function analyzeSequencing(
  pitches: Pitch[],
  abResults: AbResult[]
): Sequencing {
  const logged = pitches.filter((p) => p.outcome != null);
  const byAb = abPitches(logged);

  // ── put-away: last pitch of each strikeout AB ──
  const putAwayMap: Record<string, ComboStat> = {};
  const kAbs = abResults.filter((r) => r.result === "K");
  for (const r of kAbs) {
    const arr = byAb.get(r.ab);
    if (!arr || !arr.length) continue;
    const last = arr[arr.length - 1];
    const k = label(last);
    putAwayMap[k] = putAwayMap[k] ?? {
      key: k,
      type: last.type,
      zone: last.zone,
      count: 0,
    };
    putAwayMap[k].count++;
  }

  // ── whiffs: misses by combo, with whiff rate context ──
  const thrownMap: Record<string, number> = {};
  const whiffMap: Record<string, ComboStat> = {};
  for (const p of logged) {
    const k = label(p);
    thrownMap[k] = (thrownMap[k] || 0) + 1;
    if (swingOf(p.outcome) === "miss") {
      whiffMap[k] = whiffMap[k] ?? {
        key: k,
        type: p.type,
        zone: p.zone,
        count: 0,
      };
      whiffMap[k].count++;
    }
  }
  for (const k of Object.keys(whiffMap)) {
    whiffMap[k].extra = Math.round((whiffMap[k].count / thrownMap[k]) * 100);
  }

  // ── after a whiff: next pitch in the AB + whether it finished ──
  const afterMap: Record<string, AfterWhiffStat> = {};
  for (const arr of byAb.values()) {
    for (let i = 0; i < arr.length - 1; i++) {
      if (swingOf(arr[i].outcome) !== "miss") continue;
      const next = arr[i + 1];
      const k = label(next);
      afterMap[k] = afterMap[k] ?? { key: k, count: 0, finished: 0 };
      afterMap[k].count++;
      // "finished" = the follow-up got a whiff or put the ball in play
      const sw = swingOf(next.outcome);
      if (sw === "miss" || next.outcome === "inplay") afterMap[k].finished++;
    }
  }

  // ── two-strike approach ──
  const twoMap: Record<string, TwoStrikeStat> = {};
  for (const p of logged) {
    if (p.s < 2) continue;
    const k = label(p);
    twoMap[k] = twoMap[k] ?? {
      key: k,
      thrown: 0,
      k: 0,
      foul: 0,
      inplay: 0,
      ball: 0,
    };
    const t = twoMap[k];
    t.thrown++;
    if (p.outcome === "miss" || p.outcome === "called") t.k++;
    else if (p.outcome === "foul") t.foul++;
    else if (p.outcome === "inplay") t.inplay++;
    else if (p.outcome === "ball") t.ball++;
  }

  const byCountDesc = <T extends { count: number }>(a: T, b: T) =>
    b.count - a.count;

  return {
    putAway: Object.values(putAwayMap).sort(byCountDesc),
    whiffs: Object.values(whiffMap).sort(byCountDesc),
    afterWhiff: Object.values(afterMap).sort(byCountDesc),
    twoStrike: Object.values(twoMap).sort((a, b) => b.k - a.k || b.thrown - a.thrown),
    totalKs: kAbs.length,
  };
}
