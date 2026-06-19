import { EMPTY_SITUATION, type Situation } from "@/lib/types";

/**
 * Game-situation helpers + live cues. We're on defense, so cues are about
 * how the base/out state should shape the call. These ARM the coach — they
 * flag the risk or the opening; they never name the pitch.
 */

/** runners → bitmask (1 = 1st, 2 = 2nd, 4 = 3rd) for stamping on a pitch */
export function basesMask(s: Situation | undefined): number {
  if (!s) return 0;
  return (s.on1 ? 1 : 0) | (s.on2 ? 2 : 0) | (s.on3 ? 4 : 0);
}

export const withSituationDefaults = (s: Situation | undefined): Situation =>
  s ?? EMPTY_SITUATION;

/** short base label like "1st & 3rd", "RISP", "bases empty" */
export function basesLabel(s: Situation): string {
  const on: string[] = [];
  if (s.on1) on.push("1st");
  if (s.on2) on.push("2nd");
  if (s.on3) on.push("3rd");
  if (on.length === 3) return "loaded";
  if (on.length === 0) return "bases empty";
  return on.join(" & ");
}

export type CueTone = "warn" | "go" | "info";

export interface SituationCue {
  tone: CueTone;
  text: string;
}

/**
 * The few situation reads worth flagging for pitch selection. Order =
 * priority; we surface the single most important one.
 */
export function situationCue(s: Situation): SituationCue | null {
  const risp = s.on2 || s.on3;
  const lead = s.us - s.them;

  // runner on 3rd, under 2 outs: a pitch in the dirt scores the run
  if (s.on3 && s.outs < 2) {
    return {
      tone: "warn",
      text: "R3, <2 out — a ball in the dirt scores. Keep drops/curves up in the zone.",
    };
  }

  // 2 outs with a runner in scoring position: go get the out
  if (s.outs === 2 && risp) {
    return { tone: "go", text: "2 out, RISP — go get the strikeout, attack the zone." };
  }

  // first base open with a runner on: room to expand or pitch around
  if (!s.on1 && risp) {
    return { tone: "info", text: "1st base open — you can expand or pitch around." };
  }

  // runners on, under 2 outs, none on 3rd: a ground ball is a double play
  if ((s.on1 || s.on2) && s.outs < 2 && !s.on3) {
    return { tone: "info", text: "DP in order — a low ball on the ground helps." };
  }

  // protecting a slim late lead: throw strikes, don't walk the leadoff
  if (lead > 0 && lead <= 2 && s.inning >= 5 && !(s.on1 || s.on2 || s.on3)) {
    return { tone: "info", text: "Protecting the lead — fill it up, no free passes." };
  }

  return null;
}
