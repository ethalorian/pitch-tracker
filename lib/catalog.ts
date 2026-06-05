/**
 * Pitch catalog: the fastpitch standards with stable colors so FB is
 * red on every pitcher and every chart, plus a color pool for custom
 * extras a coach adds to a specific pitcher.
 */

export interface PitchDef {
  k: string; // short key shown on buttons/strips ("FB", "RS", custom)
  name: string; // full name ("Fastball", "Rise", "Knuckle")
  c: string; // stable display color
}

export const STANDARD_PITCHES: PitchDef[] = [
  { k: "FB", name: "Fastball", c: "#ff5a3c" },
  { k: "CH", name: "Change", c: "#22c7d6" },
  { k: "DR", name: "Drop", c: "#36d67a" },
  { k: "CU", name: "Curve", c: "#b06bff" },
  { k: "SC", name: "Screw", c: "#ffc23c" },
  { k: "RS", name: "Rise", c: "#ff7ab8" },
];

/** Colors handed out to custom pitches, in order, skipping ones in use. */
export const CUSTOM_COLOR_POOL = [
  "#6ba8ff", // blue
  "#d6c322", // olive gold
  "#ff9d5c", // orange
  "#7be0c3", // mint
  "#c98bff", // lilac
  "#e0e36b", // chartreuse
];

export function nextCustomColor(used: string[]): string {
  return (
    CUSTOM_COLOR_POOL.find((c) => !used.includes(c)) ??
    CUSTOM_COLOR_POOL[used.length % CUSTOM_COLOR_POOL.length]
  );
}

/** Look up a pitch def from a pitcher's repertoire, with a safe fallback. */
export function pitchDef(
  repertoire: PitchDef[],
  k: string
): PitchDef {
  return (
    repertoire.find((p) => p.k === k) ??
    STANDARD_PITCHES.find((p) => p.k === k) ?? {
      k,
      name: k,
      c: "#9aa4af",
    }
  );
}
