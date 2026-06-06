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
  FBIH: ["014", "031", "142", "223", "245", "254", "312", "335", "423", "432", "434", "444", "543"],
  FBIL: ["021", "041", "054", "113", "122", "133", "224", "244", "321", "331", "352", "413", "541"],
  FBOH: ["024", "043", "112", "115", "121", "125", "135", "145", "235", "354", "452", "524", "535"],
  FBOL: ["025", "034", "051", "144", "214", "243", "322", "353", "355", "514", "525", "544", "553"],
  CHI: ["023", "055", "132", "134", "153", "221", "241", "242", "311", "443", "445", "511", "515", "554"],
  CHO: ["011", "012", "032", "033", "052", "141", "211", "222", "341", "345", "421", "454", "513"],
  DPI: ["131", "152", "154", "213", "233", "252", "334", "343", "422", "435", "442", "453", "522", "532"],
  DPO: ["015", "022", "111", "114", "231", "253", "324", "342", "424", "425", "451", "521", "531", "533", "534", "545"],
  CRVI: ["035", "123", "151", "155", "215", "225", "313", "314", "323", "325", "351", "441", "552"],
  CRVO: ["045", "053", "124", "143", "212", "234", "315", "332", "344", "411", "414", "512", "542", "551"],
  SCREW: ["013", "042", "044", "232", "251", "255", "333", "412", "415", "431", "433", "455", "523", "555"],
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
