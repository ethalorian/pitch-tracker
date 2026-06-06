import { ZONES, swingOf, type GameState, type Pitch } from "@/lib/types";
import { pitchDef, STANDARD_PITCHES } from "@/lib/catalog";

/**
 * Compress a game into a compact, token-cheap text summary for the
 * current pitcher: workload, mix, count tendencies, sequencing, and
 * each batter's swing/contact/spray profile. Built client-side so the
 * API route only relays text — no app types leak to the model.
 */
export function buildInsightSummary(game: GameState): string {
  const pitcher = game.pitchers.find((p) => p.id === game.pitcherId);
  const defs = pitcher?.pitches.length ? pitcher.pitches : STANDARD_PITCHES;
  const name = (k: string) => pitchDef(defs, k).name;

  const mine = game.pitches.filter(
    (p) => (p.pitcherId ?? null) === game.pitcherId && p.outcome != null
  );
  if (mine.length === 0) return "";

  const lines: string[] = [];
  lines.push(
    `Pitcher: ${pitcher?.name ?? "current"} vs ${game.opponentName ?? "opponent"}.`
  );

  // overall mix + strike rates
  const isStrike = (p: Pitch) => p.outcome !== "ball";
  const mix: Record<string, number> = {};
  mine.forEach((p) => (mix[p.type] = (mix[p.type] || 0) + 1));
  const strikes = mine.filter(isStrike).length;
  const first = mine.filter((p) => p.b === 0 && p.s === 0);
  const fps = first.filter(isStrike).length;
  lines.push(
    `Total pitches: ${mine.length}. Strike%: ${Math.round(
      (strikes / mine.length) * 100
    )}. First-pitch-strike%: ${
      first.length ? Math.round((fps / first.length) * 100) : 0
    }.`
  );
  lines.push(
    "Mix: " +
      Object.entries(mix)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${name(k)} ${n}`)
        .join(", ") +
      "."
  );

  // mix by count
  const byCount: Record<string, Record<string, number>> = {};
  mine.forEach((p) => {
    const c = `${p.b}-${p.s}`;
    byCount[c] = byCount[c] ?? {};
    byCount[c][p.type] = (byCount[c][p.type] || 0) + 1;
  });
  const countLines = Object.entries(byCount)
    .map(
      ([c, m]) =>
        `${c}: ${Object.entries(m)
          .map(([k, n]) => `${k}×${n}`)
          .join(" ")}`
    )
    .join("; ");
  lines.push("By count: " + countLines + ".");

  // per-batter profile, including full call sequence (the predictability data)
  const batterIds = [...new Set(mine.map((p) => p.batterId))];
  for (const bid of batterIds) {
    const batter = game.batters.find((b) => b.id === bid);
    const bp = mine.filter((p) => p.batterId === bid);
    const seq = bp
      .map((p) => {
        const sw = swingOf(p.outcome);
        const tag =
          sw === "miss"
            ? "whiff"
            : sw === "contact"
              ? p.contact?.quality === "hard"
                ? "HARD"
                : "contact"
              : p.outcome;
        return `${p.b}-${p.s} ${p.type}/${ZONES[p.zone]}(${tag})`;
      })
      .join(", ");
    lines.push(
      `Batter #${batter?.jersey ?? "?"} (${batter?.hand ?? "?"}HH): ${seq}.`
    );
  }

  return lines.join("\n");
}

export const INSIGHT_SYSTEM = `You are an elite fastpitch softball pitch-calling analyst sitting next to a coach during a live game. You are given a compact log of one pitcher's game so far: her pitch mix, strike rates, tendencies by count, and each batter's pitch-by-pitch sequence with swing results (whiff = swing and miss, contact, HARD = hard contact) and locations (relative to the batter; e.g. lo-aw = low-away).

Your job: surface trends the coach may be missing and give actionable advice for the rest of THIS game. Be concrete and brief — this is read between innings.

Cover, only where the data supports it:
- Predictability: is she tipping a pattern by count or sequence a hitter could time?
- What's working: pitch/location combos drawing whiffs or weak contact.
- Danger: combos getting hard contact — what to stop calling.
- Specific batters to attack or pitch around next time up.

Rules:
- Flag small samples honestly; don't over-read 1-2 pitches.
- No filler, no restating the data back. Lead with the single most important read.
- Use plain coach language. Reference pitch + location specifically.
- Max ~180 words, short bullet-style lines.`;
