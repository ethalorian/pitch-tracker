/**
 * Wristband call sheet. A "card" maps pitch+location buckets to lists of
 * relay codes; the coach yells a random code and players decode it on the
 * band. Cards are stored in Supabase (editable, rotatable). The default
 * below (NeverMissASign "NC SPARK") is the offline fallback / seed.
 *
 * The bucket structure is fixed because it mirrors the physical card's
 * columns; only the codes inside each bucket change when you rotate cards.
 */

export type CallCardBuckets = Record<string, string[]>;

/** Bucket keys in display order, with human labels for the editor. */
export const BUCKET_DEFS: { key: string; label: string }[] = [
  { key: "FBIH", label: "Fastball inside-high" },
  { key: "FBIL", label: "Fastball inside-low" },
  { key: "FBOH", label: "Fastball outside-high" },
  { key: "FBOL", label: "Fastball outside-low" },
  { key: "CHI", label: "Changeup inside" },
  { key: "CHO", label: "Changeup outside" },
  { key: "DPI", label: "Drop inside" },
  { key: "DPO", label: "Drop outside" },
  { key: "CRVI", label: "Curve inside" },
  { key: "CRVO", label: "Curve outside" },
  { key: "SCREW", label: "Screwball inside" },
];

export const DEFAULT_CARD_NAME = "NC SPARK";

export const DEFAULT_CARD_BUCKETS: CallCardBuckets = {
  FBIH: ["043", "123", "124", "242", "341", "421", "512", "542"],
  FBIL: ["113", "134", "222", "232", "233", "244", "314", "531"],
  FBOH: ["014", "031", "034", "112", "143", "214", "241", "331", "344", "423"],
  FBOL: ["024", "044", "212", "223", "313", "522", "541", "543"],
  CHI: ["012", "213", "312", "333", "424", "431", "432", "524"],
  CHO: ["033", "122", "221", "224", "231", "343", "433", "532", "533"],
  DPI: ["032", "114", "144", "243", "321", "324", "334", "413", "442", "514"],
  DPO: ["042", "132", "234", "441", "443", "513", "523", "534", "544"],
  CRVI: ["022", "111", "131", "133", "322", "411", "414", "434", "521"],
  CRVO: ["011", "013", "021", "121", "141", "211", "323", "332"],
  SCREW: ["023", "041", "142", "311", "342", "412", "422", "444", "511"],
};

/** zone index → card bucket for a pitch type; null if the card has no entry */
export function callBucket(type: string, zone: number): string | null {
  const inside = zone % 3 === 0; // left column of the 3×3 grid
  const high = zone < 3; // top row
  switch (type) {
    case "FB":
      return inside ? (high ? "FBIH" : "FBIL") : high ? "FBOH" : "FBOL";
    case "CH":
      return inside ? "CHI" : "CHO";
    case "DR":
      return inside ? "DPI" : "DPO";
    case "CU":
      return inside ? "CRVI" : "CRVO";
    case "SC":
      return "SCREW";
    default:
      return null; // custom pitches aren't on the card
  }
}

/** Random relay code for a call from a given card, or null if uncovered. */
export function randomCall(
  buckets: CallCardBuckets,
  type: string,
  zone: number
): string | null {
  const bucket = callBucket(type, zone);
  if (!bucket) return null;
  const list = buckets[bucket];
  if (!list?.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}
