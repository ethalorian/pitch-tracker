import { swingOf, type GameState, type Pitch } from "@/lib/types";

/**
 * Season aggregation for one pitcher across many games. Built for
 * development: command trend, workload, and per-pitch effectiveness
 * (what gets whiffs vs. what gets hit).
 */

export interface PerPitchStat {
  type: string;
  count: number;
  usagePct: number;
  strikePct: number;
  whiffPct: number; // misses / thrown
  hard: number; // hard-contact count
  inplay: number;
}

export interface PerGameStat {
  id: string;
  label: string;
  pitches: number;
  strikePct: number | null;
  whiffPct: number | null;
  ks: number;
}

export interface PitcherSeason {
  games: number;
  totalPitches: number;
  batters: number;
  strikePct: number | null;
  fpsPct: number | null;
  whiffPct: number | null;
  ks: number;
  bbs: number;
  perPitch: PerPitchStat[];
  perGame: PerGameStat[];
}

export interface GameBundle {
  id: string;
  label: string;
  state: GameState;
}

const isStrike = (p: Pitch) => p.outcome != null && p.outcome !== "ball";

export function aggregatePitcherSeason(
  bundles: GameBundle[],
  pitcherId: string
): PitcherSeason {
  let totalPitches = 0;
  let strikes = 0;
  let firstPitches = 0;
  let firstStrikes = 0;
  let misses = 0;
  let ks = 0;
  let bbs = 0;
  const battersSet = new Set<string>();
  const thrown: Record<string, number> = {};
  const pStrikes: Record<string, number> = {};
  const pMiss: Record<string, number> = {};
  const pHard: Record<string, number> = {};
  const pInplay: Record<string, number> = {};
  const perGame: PerGameStat[] = [];

  for (const { id, label, state } of bundles) {
    const mine = state.pitches.filter(
      (p) => (p.pitcherId ?? null) === pitcherId && p.outcome != null
    );
    if (!mine.length) continue;

    let gStrikes = 0;
    let gMiss = 0;
    for (const p of mine) {
      totalPitches++;
      thrown[p.type] = (thrown[p.type] || 0) + 1;
      battersSet.add(`${id}:${p.ab}`);
      if (isStrike(p)) {
        strikes++;
        gStrikes++;
        pStrikes[p.type] = (pStrikes[p.type] || 0) + 1;
      }
      if (p.b === 0 && p.s === 0) {
        firstPitches++;
        if (isStrike(p)) firstStrikes++;
      }
      const sw = swingOf(p.outcome);
      if (sw === "miss") {
        misses++;
        gMiss++;
        pMiss[p.type] = (pMiss[p.type] || 0) + 1;
      }
      if (sw === "contact" && p.contact?.quality === "hard")
        pHard[p.type] = (pHard[p.type] || 0) + 1;
      if (p.outcome === "inplay") pInplay[p.type] = (pInplay[p.type] || 0) + 1;
    }

    // K/BB from this game's results, for abs this pitcher threw in
    const myAbs = new Set(mine.map((p) => p.ab));
    let gKs = 0;
    for (const r of state.abResults) {
      if (!myAbs.has(r.ab)) continue;
      if (r.result === "K") {
        ks++;
        gKs++;
      } else if (r.result === "BB") bbs++;
    }

    perGame.push({
      id,
      label,
      pitches: mine.length,
      strikePct: Math.round((gStrikes / mine.length) * 100),
      whiffPct: Math.round((gMiss / mine.length) * 100),
      ks: gKs,
    });
  }

  const perPitch: PerPitchStat[] = Object.keys(thrown)
    .map((type) => ({
      type,
      count: thrown[type],
      usagePct: Math.round((thrown[type] / totalPitches) * 100),
      strikePct: Math.round(((pStrikes[type] || 0) / thrown[type]) * 100),
      whiffPct: Math.round(((pMiss[type] || 0) / thrown[type]) * 100),
      hard: pHard[type] || 0,
      inplay: pInplay[type] || 0,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    games: perGame.length,
    totalPitches,
    batters: battersSet.size,
    strikePct: totalPitches ? Math.round((strikes / totalPitches) * 100) : null,
    fpsPct: firstPitches
      ? Math.round((firstStrikes / firstPitches) * 100)
      : null,
    whiffPct: totalPitches ? Math.round((misses / totalPitches) * 100) : null,
    ks,
    bbs,
    perPitch,
    perGame,
  };
}
