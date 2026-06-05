"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { createGameRow, saveGameRow } from "@/lib/supabase/sync";
import { getSupabase } from "@/lib/supabase/client";

/* ───────────────────────── types ───────────────────────── */
type Hand = "R" | "L";
type Outcome = "ball" | "strike" | "foul" | "inplay";
type AbEnd = "BB" | "K" | "IP";

interface Batter {
  id: string;
  jersey: string;
  hand: Hand;
}

interface Pitch {
  id: string;
  batterId: string;
  ab: number;
  type: PitchKey;
  zone: number;
  b: number;
  s: number;
  outcome: Outcome | null;
  ts: number;
}

interface AbResult {
  ab: number;
  batterId: string;
  result: AbEnd;
}

interface GameState {
  batters: Batter[];
  pitches: Pitch[];
  abResults: AbResult[];
  currentBatterId: string | null;
  currentAb: number;
  abCounter: number;
  count: { b: number; s: number };
  pending: { type?: PitchKey; zone?: number };
  abOver: boolean;
  lastLogged: string | null;
}

/* ───────────────────────── constants ───────────────────────── */
const PITCHES = [
  { k: "FB", name: "Fastball", c: "#ff5a3c" },
  { k: "CH", name: "Change", c: "#22c7d6" },
  { k: "DR", name: "Drop", c: "#36d67a" },
  { k: "CU", name: "Curve", c: "#b06bff" },
  { k: "SC", name: "Screw", c: "#ffc23c" },
] as const;
type PitchKey = (typeof PITCHES)[number]["k"];
const PMAP = Object.fromEntries(PITCHES.map((p) => [p.k, p])) as Record<
  PitchKey,
  (typeof PITCHES)[number]
>;

// zone 0..8, labeled relative to the batter (how a caller thinks)
const ZONES = [
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

const STORE_KEY = "fastpitch-caller-v1";
const GAME_ID_KEY = "fastpitch-caller-game-id";
const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const ck = (b: number, s: number) => `${b}-${s}`;

const EMPTY: GameState = {
  batters: [],
  pitches: [],
  abResults: [],
  currentBatterId: null,
  currentAb: 0,
  abCounter: 0,
  count: { b: 0, s: 0 },
  pending: {},
  abOver: false,
  lastLogged: null,
};

/* ───────────────────────── component ───────────────────────── */
const emptySubscribe = () => () => {};

function loadGame(): GameState {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw) {
      return { ...EMPTY, ...(JSON.parse(raw) as GameState), pending: {} };
    }
  } catch {
    /* fresh game */
  }
  return EMPTY;
}

export default function PitchCaller() {
  const router = useRouter();
  const [game, setGame] = useState<GameState>(loadGame);
  const [tab, setTab] = useState<"call" | "batter" | "game">("call");
  const [viewBatter, setViewBatter] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [jIn, setJIn] = useState("");
  const [hIn, setHIn] = useState<Hand>("R");

  // true after hydration; gates rendering so SSR and first client render match
  const loaded = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  // ── Supabase game row tracking (localStorage stays the live source of truth) ──
  const gameIdRef = useRef<string | null | undefined>(undefined);
  const idPromiseRef = useRef<Promise<string | null> | null>(null);

  const ensureGameId = (opponent?: string | null) => {
    if (gameIdRef.current) return Promise.resolve(gameIdRef.current);
    if (!idPromiseRef.current) {
      idPromiseRef.current = createGameRow(opponent).then((id) => {
        if (id) {
          gameIdRef.current = id;
          try {
            window.localStorage.setItem(GAME_ID_KEY, id);
          } catch {
            /* ignore */
          }
        }
        idPromiseRef.current = null;
        return id;
      });
    }
    return idPromiseRef.current;
  };

  // persist: localStorage immediately, Supabase debounced + best-effort
  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(game));
    } catch {
      /* storage unavailable */
    }
    if (gameIdRef.current === undefined) {
      try {
        gameIdRef.current = window.localStorage.getItem(GAME_ID_KEY);
      } catch {
        gameIdRef.current = null;
      }
    }
    const t = setTimeout(() => {
      void ensureGameId().then((id) => {
        if (id) void saveGameRow(id, game);
      });
    }, 1500);
    return () => clearTimeout(t);
  }, [game, loaded]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1100);
  };

  /* ── actions ── */
  const bringUp = (batterId: string) =>
    setGame((g) => ({
      ...g,
      currentBatterId: batterId,
      currentAb: g.abCounter + 1,
      abCounter: g.abCounter + 1,
      count: { b: 0, s: 0 },
      pending: {},
      abOver: false,
    }));

  const addBatter = () => {
    const jersey = jIn.trim();
    if (!jersey) return;
    setGame((g) => {
      const exist = g.batters.find((b) => b.jersey === jersey);
      const id = exist ? exist.id : uid();
      const batters = exist
        ? g.batters
        : [...g.batters, { id, jersey, hand: hIn }];
      return {
        ...g,
        batters,
        currentBatterId: id,
        currentAb: g.abCounter + 1,
        abCounter: g.abCounter + 1,
        count: { b: 0, s: 0 },
        pending: {},
        abOver: false,
      };
    });
    setJIn("");
    setAdding(false);
  };

  const commit = (type: PitchKey, zone: number) =>
    setGame((g) => {
      if (!g.currentBatterId) return g;
      const pitch: Pitch = {
        id: uid(),
        batterId: g.currentBatterId,
        ab: g.currentAb,
        type,
        zone,
        b: g.count.b,
        s: g.count.s,
        outcome: null,
        ts: Date.now(),
      };
      return {
        ...g,
        pitches: [...g.pitches, pitch],
        pending: {},
        lastLogged: pitch.id,
        abOver: false,
      };
    });

  const pickType = (t: PitchKey) => {
    if (!game.currentBatterId) {
      flash("Pick a batter first");
      return;
    }
    if (game.pending.zone != null) {
      commit(t, game.pending.zone);
      flash(`${t} · ${ZONES[game.pending.zone]}`);
    } else {
      setGame((g) => ({ ...g, pending: { ...g.pending, type: t } }));
    }
  };

  const pickZone = (z: number) => {
    if (!game.currentBatterId) {
      flash("Pick a batter first");
      return;
    }
    if (game.pending.type) {
      commit(game.pending.type, z);
      flash(`${game.pending.type} · ${ZONES[z]}`);
    } else {
      setGame((g) => ({ ...g, pending: { ...g.pending, zone: z } }));
    }
  };

  const outcome = (o: Outcome) =>
    setGame((g) => {
      const pitches = [...g.pitches];
      for (let i = pitches.length - 1; i >= 0; i--) {
        if (pitches[i].ab === g.currentAb) {
          if (!pitches[i].outcome) pitches[i] = { ...pitches[i], outcome: o };
          break;
        }
      }
      let { b, s } = g.count;
      let ended: AbEnd | null = null;
      if (o === "ball") {
        b++;
        if (b >= 4) ended = "BB";
      } else if (o === "strike") {
        s++;
        if (s >= 3) ended = "K";
      } else if (o === "foul") {
        if (s < 2) s++;
      } else if (o === "inplay") {
        ended = "IP";
      }
      if (ended && g.currentBatterId) {
        return {
          ...g,
          pitches,
          abResults: [
            ...g.abResults,
            { ab: g.currentAb, batterId: g.currentBatterId, result: ended },
          ],
          count: { b: 0, s: 0 },
          abOver: true,
        };
      }
      return { ...g, pitches, count: { b, s } };
    });

  const newGame = () => {
    if (!window.confirm("Start a new game? The current game stays saved in Supabase.")) {
      return;
    }
    const opponent = window.prompt("Opponent (optional):")?.trim() || null;
    setGame(EMPTY);
    gameIdRef.current = null;
    idPromiseRef.current = null;
    try {
      window.localStorage.removeItem(GAME_ID_KEY);
    } catch {
      /* ignore */
    }
    void ensureGameId(opponent);
  };

  /* ── derived ── */
  const curBatter =
    game.batters.find((b) => b.id === game.currentBatterId) ?? null;
  const curAbPitches = game.pitches.filter((p) => p.ab === game.currentAb);

  if (!loaded) {
    return (
      <div className="mx-auto w-full max-w-[480px] p-10 text-center text-muted-foreground">
        loading…
      </div>
    );
  }

  return (
    <div className="relative mx-auto w-full max-w-[480px] pb-24 font-sans">
      {/* header */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-3.5 py-3">
        <div className="text-lg font-bold tracking-wide">
          PITCH
          <span className="text-amber-600 dark:text-amber-400">CALL</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            onClick={newGame}
            className="rounded-lg border px-2.5 py-1.5 text-xs tracking-widest text-muted-foreground hover:bg-accent"
          >
            NEW GAME
          </button>
          <button
            aria-label="Sign out"
            onClick={async () => {
              await getSupabase()?.auth.signOut();
              router.push("/login");
              router.refresh();
            }}
            className="rounded-lg border p-1.5 text-muted-foreground hover:bg-accent"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>

      {/* tabs */}
      <div className="flex gap-1.5 px-3.5 pb-1 pt-2.5">
        {(
          [
            ["call", "CALL"],
            ["batter", "BATTER"],
            ["game", "GAME"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            onClick={() => {
              setTab(k);
              if (k === "batter" && !viewBatter)
                setViewBatter(game.currentBatterId);
            }}
            className={cn(
              "flex-1 rounded-lg border py-2 text-sm font-bold tracking-widest transition-colors",
              tab === k
                ? "border-amber-500 bg-amber-500 text-black"
                : "border-border text-muted-foreground hover:bg-accent"
            )}
          >
            {l}
          </button>
        ))}
      </div>

      {tab === "call" && (
        <div className="px-3.5 py-2">
          {/* roster */}
          <div className="flex gap-1.5 overflow-x-auto pb-2.5 pt-1">
            {game.batters.map((b) => {
              const on = b.id === game.currentBatterId;
              return (
                <button
                  key={b.id}
                  onClick={() => bringUp(b.id)}
                  className={cn(
                    "shrink-0 rounded-lg border px-3 py-1.5 text-[15px] font-bold",
                    on
                      ? "border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      : "border-border bg-card text-card-foreground hover:bg-accent"
                  )}
                >
                  #{b.jersey}
                  <span className="ml-1 text-[11px] text-muted-foreground">
                    {b.hand}
                  </span>
                </button>
              );
            })}
            {adding ? (
              <div className="flex shrink-0 items-center gap-1">
                <input
                  autoFocus
                  value={jIn}
                  onChange={(e) => setJIn(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addBatter()}
                  placeholder="#"
                  className="w-[52px] rounded-lg border border-amber-500 bg-background px-2 py-1.5 font-mono text-[15px] text-foreground outline-none"
                />
                <button
                  onClick={() => setHIn(hIn === "R" ? "L" : "R")}
                  className="rounded-lg border bg-card px-2.5 py-1.5 font-bold text-card-foreground"
                >
                  {hIn}
                </button>
                <button
                  onClick={addBatter}
                  className="rounded-lg bg-amber-500 px-3 py-1.5 font-bold text-black"
                >
                  OK
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="shrink-0 rounded-lg border border-dashed px-3.5 py-1.5 text-[15px] font-bold text-muted-foreground hover:bg-accent"
              >
                + BATTER
              </button>
            )}
          </div>

          {/* batter + count */}
          <div className="mb-2.5 flex items-center justify-between rounded-xl border bg-card px-4 py-2.5">
            <div>
              <div className="text-xs tracking-widest text-muted-foreground">
                AT BAT
              </div>
              <div className="text-[26px] font-bold leading-none">
                {curBatter ? `#${curBatter.jersey}` : "—"}
                {curBatter && (
                  <span className="ml-1.5 text-sm text-muted-foreground">
                    {curBatter.hand}HH
                  </span>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs tracking-widest text-muted-foreground">
                COUNT
              </div>
              <div className="font-mono text-[40px] font-bold leading-none text-amber-600 dark:text-amber-400">
                {game.count.b}
                <span className="text-muted-foreground">-</span>
                {game.count.s}
              </div>
            </div>
          </div>

          {game.abOver && (
            <div className="mb-2.5 rounded-xl border border-amber-500 bg-card px-3.5 py-2 text-center font-bold tracking-wide text-amber-600 dark:text-amber-400">
              AT-BAT ENDED — tap a batter to start the next AB
            </div>
          )}

          {/* pitch types */}
          <div className="mx-0.5 mb-1.5 mt-0.5 text-xs tracking-widest text-muted-foreground">
            ① PITCH
          </div>
          <div className="mb-3.5 grid grid-cols-5 gap-1.5">
            {PITCHES.map((p) => {
              const on = game.pending.type === p.k;
              return (
                <button
                  key={p.k}
                  onClick={() => pickType(p.k)}
                  className="rounded-xl border-2 py-4 text-lg font-bold transition-all"
                  style={
                    on
                      ? { borderColor: p.c, background: p.c, color: "#0a0c10" }
                      : { borderColor: "var(--border)", color: p.c }
                  }
                >
                  {p.k}
                </button>
              );
            })}
          </div>

          {/* location */}
          <div className="mx-0.5 mb-1.5 mt-0.5 flex justify-between text-xs tracking-widest text-muted-foreground">
            <span>② LOCATION</span>
            <span className="opacity-60">relative to batter</span>
          </div>
          <div className="mb-3.5 grid grid-cols-3 gap-1.5">
            {ZONES.map((z, i) => {
              const on = game.pending.zone === i;
              return (
                <button
                  key={i}
                  onClick={() => pickZone(i)}
                  className={cn(
                    "rounded-xl border-2 py-5 text-[13px] font-semibold uppercase tracking-wide",
                    on
                      ? "border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      : "border-border bg-card text-muted-foreground hover:bg-accent"
                  )}
                >
                  {z}
                </button>
              );
            })}
          </div>

          {/* outcome */}
          <div className="mx-0.5 mb-1.5 mt-0.5 flex justify-between text-xs tracking-widest text-muted-foreground">
            <span>③ RESULT</span>
            <span className="opacity-60">advances the count</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {(
              [
                ["ball", "BALL"],
                ["strike", "STRIKE"],
                ["foul", "FOUL"],
                ["inplay", "IN PLAY"],
              ] as const
            ).map(([o, l]) => (
              <button
                key={o}
                onClick={() => outcome(o)}
                disabled={!curBatter}
                className={cn(
                  "rounded-xl border bg-card py-3.5 text-[13px] font-bold tracking-wide text-card-foreground hover:bg-accent disabled:opacity-40",
                  curAbPitches.some((p) => !p.outcome) && "animate-pulse-glow"
                )}
              >
                {l}
              </button>
            ))}
          </div>

          {/* live AB strip */}
          <div className="mt-4">
            <div className="mb-1.5 text-xs tracking-widest text-muted-foreground">
              THIS AT-BAT
            </div>
            <Strip
              pitches={curAbPitches}
              all={game.pitches.filter(
                (p) => p.batterId === game.currentBatterId
              )}
            />
          </div>
        </div>
      )}

      {tab === "batter" && (
        <BatterView
          game={game}
          viewBatter={viewBatter}
          setViewBatter={setViewBatter}
        />
      )}

      {tab === "game" && <GameView game={game} />}

      {toast && (
        <div className="animate-pop fixed bottom-6 left-1/2 z-20 -translate-x-1/2 rounded-full bg-amber-500 px-4.5 py-2 text-[15px] font-bold tracking-wide text-black shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

/* ───────── sequence strip with repeat-detection (the predictability mirror) ───────── */
function Strip({ pitches, all }: { pitches: Pitch[]; all?: Pitch[] }) {
  // a call is a "repeat" if same type+zone+count seen earlier for this batter
  const seen: Record<string, number> = {};
  const flagged = (all ?? pitches).map((p) => {
    const key = `${p.type}|${p.zone}|${p.b}-${p.s}`;
    const rep = !!seen[key];
    seen[key] = (seen[key] || 0) + 1;
    return { id: p.id, rep };
  });
  const repMap = Object.fromEntries(flagged.map((f) => [f.id, f.rep]));

  if (!pitches.length) {
    return (
      <div className="px-0.5 py-1.5 text-sm text-muted-foreground/60">
        no pitches yet
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {pitches.map((p, i) => {
        const c = PMAP[p.type].c;
        const back =
          i > 0 &&
          pitches[i - 1].type === p.type &&
          pitches[i - 1].zone === p.zone;
        const warn = repMap[p.id] || back;
        return (
          <div
            key={p.id}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border bg-card px-2 py-1 font-mono text-xs",
              warn ? "border-red-500" : "border-border"
            )}
          >
            <span className="text-muted-foreground">
              {p.b}-{p.s}
            </span>
            <span className="font-bold" style={{ color: c }}>
              {p.type}
            </span>
            <span className="text-card-foreground/80">{ZONES[p.zone]}</span>
            {p.outcome && (
              <span className="text-[10px] text-muted-foreground/60">
                {p.outcome[0].toUpperCase()}
              </span>
            )}
            {warn && (
              <span className="text-[11px] text-red-600 dark:text-red-400">
                ⟲
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ───────── batter view: her night by at-bat + repeat alerts ───────── */
function BatterView({
  game,
  viewBatter,
  setViewBatter,
}: {
  game: GameState;
  viewBatter: string | null;
  setViewBatter: (id: string | null) => void;
}) {
  const id = viewBatter ?? game.currentBatterId;
  const batter = game.batters.find((b) => b.id === id);
  const mine = game.pitches.filter((p) => p.batterId === id);
  const abs = [...new Set(mine.map((p) => p.ab))];

  // repeats: type+zone+count keys hit 2+ times
  const counts: Record<string, number> = {};
  mine.forEach((p) => {
    const k = `${p.type} ${ZONES[p.zone]} in ${p.b}-${p.s}`;
    counts[k] = (counts[k] || 0) + 1;
  });
  const repeats = Object.entries(counts)
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="px-3.5 py-2">
      <div className="flex gap-1.5 overflow-x-auto pb-2.5">
        {game.batters.map((b) => {
          const on = b.id === id;
          return (
            <button
              key={b.id}
              onClick={() => setViewBatter(b.id)}
              className={cn(
                "shrink-0 rounded-lg border px-3 py-1.5 text-[15px] font-bold",
                on
                  ? "border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                  : "border-border bg-card text-card-foreground hover:bg-accent"
              )}
            >
              #{b.jersey}
            </button>
          );
        })}
      </div>

      {!batter ? (
        <div className="p-2.5 text-muted-foreground/60">
          No batter selected.
        </div>
      ) : (
        <>
          <div className="mb-1 text-[22px] font-bold">
            #{batter.jersey}{" "}
            <span className="text-sm text-muted-foreground">
              {batter.hand}HH · {mine.length} pitches · {abs.length} AB
            </span>
          </div>

          {repeats.length > 0 && (
            <div className="mb-3.5 mt-2 rounded-xl border border-red-500 bg-card px-3.5 py-2.5">
              <div className="mb-1.5 text-[13px] font-bold tracking-widest text-red-600 dark:text-red-400">
                ⟲ YOU&apos;VE REPEATED ON HER
              </div>
              {repeats.map(([k, n]) => (
                <div
                  key={k}
                  className="py-0.5 font-mono text-[13px] text-card-foreground"
                >
                  <span className="text-amber-600 dark:text-amber-400">
                    {n}×
                  </span>{" "}
                  {k}
                </div>
              ))}
            </div>
          )}

          {abs.map((ab) => {
            const ps = mine.filter((p) => p.ab === ab);
            const res = game.abResults.find((r) => r.ab === ab);
            return (
              <div key={ab} className="mb-3.5">
                <div className="mb-1.5 text-xs tracking-widest text-muted-foreground">
                  AT-BAT {abs.indexOf(ab) + 1}
                  {res && (
                    <span className="ml-2 text-amber-600 dark:text-amber-400">
                      → {res.result}
                    </span>
                  )}
                </div>
                <Strip pitches={ps} all={mine} />
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

/* ───────── game view: pooled mix-by-count (where the sample is thick enough) ───────── */
function GameView({ game }: { game: GameState }) {
  const { pitches } = game;

  const overall = useMemo(() => {
    const m: Partial<Record<PitchKey, number>> = {};
    pitches.forEach((p) => (m[p.type] = (m[p.type] || 0) + 1));
    return m;
  }, [pitches]);

  const byCount = useMemo(() => {
    const m: Record<
      string,
      { total: number; t: Partial<Record<PitchKey, number>> }
    > = {};
    pitches.forEach((p) => {
      const k = ck(p.b, p.s);
      m[k] = m[k] || { total: 0, t: {} };
      m[k].total++;
      m[k].t[p.type] = (m[k].t[p.type] || 0) + 1;
    });
    return m;
  }, [pitches]);

  const total = pitches.length;
  const order = [
    "0-0",
    "1-0",
    "0-1",
    "2-0",
    "1-1",
    "0-2",
    "3-0",
    "2-1",
    "1-2",
    "3-1",
    "2-2",
    "3-2",
  ];
  const present = order.filter((k) => byCount[k]);

  if (!total) {
    return (
      <div className="p-5 text-muted-foreground/60">
        Log some pitches to see tendencies.
      </div>
    );
  }

  return (
    <div className="px-3.5 py-2">
      <div className="mx-0.5 mb-2 mt-1 text-xs tracking-widest text-muted-foreground">
        OVERALL MIX · {total} pitches
      </div>
      <div className="mb-1.5 flex h-[30px] overflow-hidden rounded-lg">
        {PITCHES.filter((p) => overall[p.k]).map((p) => (
          <div
            key={p.k}
            title={p.k}
            className="flex items-center justify-center text-xs font-bold text-black"
            style={{
              width: `${((overall[p.k] || 0) / total) * 100}%`,
              background: p.c,
            }}
          >
            {Math.round(((overall[p.k] || 0) / total) * 100) >= 10 ? p.k : ""}
          </div>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-2.5">
        {PITCHES.filter((p) => overall[p.k]).map((p) => (
          <span key={p.k} className="font-mono text-xs text-muted-foreground">
            <span style={{ color: p.c }}>■</span> {p.k} {overall[p.k]} (
            {Math.round(((overall[p.k] || 0) / total) * 100)}%)
          </span>
        ))}
      </div>

      <div className="mx-0.5 mb-2 mt-1 text-xs tracking-widest text-muted-foreground">
        MIX BY COUNT{" "}
        <span className="opacity-60">· raw counts shown — watch thin cells</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {present.map((k) => {
          const row = byCount[k];
          const thin = row.total < 5;
          return (
            <div
              key={k}
              className="flex items-center gap-2.5 rounded-xl border bg-card px-3 py-2"
            >
              <div className="w-[46px] font-mono text-xl font-bold text-amber-600 dark:text-amber-400">
                {k}
              </div>
              <div className="flex h-[22px] flex-1 overflow-hidden rounded-md bg-muted">
                {PITCHES.filter((p) => row.t[p.k]).map((p) => (
                  <div
                    key={p.k}
                    style={{
                      width: `${((row.t[p.k] || 0) / row.total) * 100}%`,
                      background: p.c,
                    }}
                  />
                ))}
              </div>
              <div
                className={cn(
                  "w-16 text-right font-mono text-xs",
                  thin
                    ? "text-red-600 dark:text-red-400"
                    : "text-muted-foreground"
                )}
              >
                {row.total} pitch{row.total > 1 ? "es" : ""}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 font-mono text-[11px] leading-relaxed text-muted-foreground/60">
        Cells under 5 pitches are flagged red — they&apos;re too thin to read as
        a tendency. This view pools all batters so the numbers mean something;
        per-batter patterns live in the BATTER tab as sequence, not percentages.
      </div>
    </div>
  );
}
