import type { PitchDef } from "./catalog";

export type Hand = "R" | "L";
/** "strike" is legacy (pre swing-tracking); UI now logs "called" or "miss" */
export type Outcome = "ball" | "strike" | "called" | "miss" | "foul" | "inplay";
export type AbEnd = "BB" | "K" | "IP";

export type Swing = "contact" | "miss" | "none";

export type ContactQuality = "hard" | "weak";

export type Trajectory = "ground" | "line" | "fly";

export const TRAJ_LABEL: Record<Trajectory, string> = {
  ground: "GB",
  line: "LD",
  fly: "FLY",
};

/** Legacy 6-zone field location (pre spray chart). */
export type FieldZone = "lf" | "cf" | "rf" | "if-l" | "if-m" | "if-r";

export interface ContactDetail {
  quality?: ContactQuality;
  trajectory?: Trajectory;
  /** spray chart coordinates, normalized 0–1 (x across, y down) */
  x?: number;
  y?: number;
  /** legacy coarse zone from the first iteration */
  field?: FieldZone;
  /** what the ball in play became: an out, a hit, or reached on error */
  result?: "out" | "hit" | "reach";
  /** on a reached-on-error, which fielder booted it (P,C,1B,2B,3B,SS,LF,CF,RF) */
  errorBy?: string;
}

/** Classify an outcome by what the batter's bat did. */
export function swingOf(o: Outcome | null): Swing | null {
  if (o === "foul" || o === "inplay") return "contact";
  if (o === "miss") return "miss";
  if (o === "ball" || o === "called") return "none";
  return null; // legacy "strike" or unlogged: swing unknown
}

export interface Batter {
  id: string;
  jersey: string;
  hand: Hand;
  name?: string;
}

export interface Pitcher {
  id: string;
  name: string;
  number?: string | null;
  pitches: PitchDef[];
}

export interface Team {
  id: string;
  name: string;
  batters: Batter[];
}

export interface Pitch {
  id: string;
  batterId: string;
  /** who threw it — pitchers can change mid-game */
  pitcherId: string | null;
  ab: number;
  type: string; // pitch key from the pitcher's repertoire
  zone: number;
  b: number;
  s: number;
  outcome: Outcome | null;
  /** filled by the post-IN-PLAY panel; absent on fouls/legacy pitches */
  contact?: ContactDetail;
  /** wristband code that was relayed for this call */
  call?: string;
  /** game situation when this pitch was thrown (for situational analysis) */
  outs?: number;
  bases?: number; // bitmask: 1 = on 1st, 2 = on 2nd, 4 = on 3rd
  ts: number;
}

export interface AbResult {
  ab: number;
  batterId: string;
  result: AbEnd;
}

/** Live game situation — we're on defense, so "us" is our score. */
export interface Situation {
  outs: number; // 0–2
  on1: boolean;
  on2: boolean;
  on3: boolean;
  us: number; // our runs (defense)
  them: number; // opponent runs (offense)
  inning: number; // 1+
  half: "top" | "bottom";
}

export const EMPTY_SITUATION: Situation = {
  outs: 0,
  on1: false,
  on2: false,
  on3: false,
  us: 0,
  them: 0,
  inning: 1,
  half: "top",
};

export interface GameState {
  /** snapshot of available pitchers at game start (offline safety) */
  pitchers: Pitcher[];
  /** currently active pitcher id */
  pitcherId: string | null;
  /** linked opponent team row, when loaded/created */
  teamId: string | null;
  opponentName: string | null;
  batters: Batter[];
  pitches: Pitch[];
  abResults: AbResult[];
  currentBatterId: string | null;
  currentAb: number;
  abCounter: number;
  count: { b: number; s: number };
  /** when true, the next hitter in the order comes up automatically */
  autoAdvance: boolean;
  pending: { type?: string; zone?: number; call?: string };
  abOver: boolean;
  lastLogged: string | null;
  /** live outs/runners/score/inning; stamped onto each pitch */
  situation: Situation;
}

export const EMPTY_GAME: GameState = {
  pitchers: [],
  pitcherId: null,
  teamId: null,
  opponentName: null,
  batters: [],
  pitches: [],
  abResults: [],
  currentBatterId: null,
  currentAb: 0,
  abCounter: 0,
  count: { b: 0, s: 0 },
  autoAdvance: true,
  pending: {},
  abOver: false,
  lastLogged: null,
  situation: EMPTY_SITUATION,
};

export const ZONES = [
  "hi-in",
  "high",
  "hi-aw",
  "in",
  "mid",
  "away",
  "lo-in",
  "low",
  "lo-aw",
] as const;

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
