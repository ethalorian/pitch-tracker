"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, RefreshCw, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import NewGameSetup, { type GameSetup } from "@/components/new-game-setup";
import {
  createGameRow,
  saveGameRow,
  syncTeamBatters,
} from "@/lib/supabase/sync";
import { getSupabase } from "@/lib/supabase/client";
import { STANDARD_PITCHES, pitchDef, type PitchDef } from "@/lib/catalog";
import {
  EMPTY_GAME,
  ZONES,
  uid,
  type GameState,
  type Hand,
  type Outcome,
  type Pitch,
  type Pitcher,
} from "@/lib/types";

const STORE_KEY = "fastpitch-caller-v1";
const GAME_ID_KEY = "fastpitch-caller-game-id";
const ck = (b: number, s: number) => `${b}-${s}`;

const emptySubscribe = () => () => {};

function loadGame(): GameState {
  if (typeof window === "undefined") return EMPTY_GAME;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw) {
      return { ...EMPTY_GAME, ...(JSON.parse(raw) as GameState), pending: {} };
    }
  } catch {
    /* fresh game */
  }
  return EMPTY_GAME;
}

/** Union of every repertoire in the game, for resolving strip colors. */
function buildDefMap(pitchers: Pitcher[]): PitchDef[] {
  const all: PitchDef[] = [];
  for (const p of pitchers) {
    for (const d of p.pitches) {
      if (!all.some((x) => x.k === d.k)) all.push(d);
    }
  }
  return all;
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
  const [showSetup, setShowSetup] = useState(false);
  const [pickingPitcher, setPickingPitcher] = useState(false);

  // true after hydration; gates rendering so SSR and first client render match
  const loaded = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  // ── Supabase game row tracking (localStorage stays the live source of truth) ──
  const gameIdRef = useRef<string | null | undefined>(undefined);
  const idPromiseRef = useRef<Promise<string | null> | null>(null);
  const gameMetaRef = useRef<{ opponent: string | null; teamId: string | null }>(
    { opponent: null, teamId: null }
  );

  const ensureGameId = () => {
    if (gameIdRef.current) return Promise.resolve(gameIdRef.current);
    if (!idPromiseRef.current) {
      const { opponent, teamId } = gameMetaRef.current;
      idPromiseRef.current = createGameRow(opponent, teamId).then((id) => {
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

  // persist: localStorage immediately; Supabase (game + roster) debounced
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
      gameMetaRef.current = {
        opponent: game.opponentName,
        teamId: game.teamId,
      };
    }
    const t = setTimeout(() => {
      void ensureGameId().then((id) => {
        if (id) void saveGameRow(id, game);
      });
      // roster sync-back: the saved team absorbs new/edited batters
      if (game.teamId && game.batters.length) {
        void syncTeamBatters(game.teamId, game.batters);
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [game, loaded]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1100);
  };

  /* ── derived ── */
  const curPitcher =
    game.pitchers.find((p) => p.id === game.pitcherId) ?? null;
  const repertoire: PitchDef[] = curPitcher?.pitches.length
    ? curPitcher.pitches
    : STANDARD_PITCHES; // legacy games / no pitcher yet
  const defMap = useMemo(() => {
    const defs = buildDefMap(game.pitchers);
    return defs.length ? defs : STANDARD_PITCHES;
  }, [game.pitchers]);
  const curBatter =
    game.batters.find((b) => b.id === game.currentBatterId) ?? null;
  const curAbPitches = game.pitches.filter((p) => p.ab === game.currentAb);

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

  const commit = (type: string, zone: number) =>
    setGame((g) => {
      if (!g.currentBatterId) return g;
      const pitch: Pitch = {
        id: uid(),
        batterId: g.currentBatterId,
        pitcherId: g.pitcherId,
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

  const pickType = (t: string) => {
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
      let ended: "BB" | "K" | "IP" | null = null;
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

  const startGame = (setup: GameSetup) => {
    setShowSetup(false);
    setGame({
      ...EMPTY_GAME,
      pitchers: setup.pitchers,
      pitcherId: setup.pitcherId,
      teamId: setup.teamId,
      opponentName: setup.opponentName,
      batters: setup.batters,
    });
    gameIdRef.current = null;
    idPromiseRef.current = null;
    gameMetaRef.current = {
      opponent: setup.opponentName,
      teamId: setup.teamId,
    };
    try {
      window.localStorage.removeItem(GAME_ID_KEY);
    } catch {
      /* ignore */
    }
    void ensureGameId();
  };

  const changePitcher = (pitcherId: string) => {
    setPickingPitcher(false);
    setGame((g) => ({ ...g, pitcherId, pending: {} }));
    const p = game.pitchers.find((x) => x.id === pitcherId);
    if (p) flash(`Now pitching: ${p.name}`);
  };

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
          <Link
            href="/team"
            aria-label="Coach setup"
            className="rounded-lg border p-1.5 text-muted-foreground hover:bg-accent"
          >
            <Users className="size-4" />
          </Link>
          <ThemeToggle />
          <button
            onClick={() => setShowSetup(true)}
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

      {/* game context bar: opponent + current pitcher */}
      <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2">
        <div className="min-w-0 truncate text-sm text-muted-foreground">
          {game.opponentName ? (
            <>
              vs <span className="font-bold text-foreground">{game.opponentName}</span>
            </>
          ) : (
            "no opponent set"
          )}
        </div>
        <button
          onClick={() =>
            game.pitchers.length > 1
              ? setPickingPitcher((v) => !v)
              : undefined
          }
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-bold",
            pickingPitcher
              ? "border-amber-500 text-amber-600 dark:text-amber-400"
              : "border-border hover:bg-accent"
          )}
        >
          {game.pitchers.length > 1 && <RefreshCw className="size-3.5" />}
          P: {curPitcher ? curPitcher.name : "—"}
        </button>
      </div>

      {/* mid-game pitcher switch (batters and log untouched) */}
      {pickingPitcher && (
        <div className="flex flex-wrap gap-1.5 border-b px-3.5 py-2">
          {game.pitchers.map((p) => {
            const on = p.id === game.pitcherId;
            return (
              <button
                key={p.id}
                onClick={() => changePitcher(p.id)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-sm font-bold",
                  on
                    ? "border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                    : "border-border hover:bg-accent"
                )}
              >
                {p.name}
                <span className="ml-1 text-[10px] text-muted-foreground">
                  {p.pitches.length}p
                </span>
              </button>
            );
          })}
        </div>
      )}

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

          {/* pitch types — adapts to the current pitcher's repertoire */}
          <div className="mx-0.5 mb-1.5 mt-0.5 flex justify-between text-xs tracking-widest text-muted-foreground">
            <span>① PITCH</span>
            {curPitcher && (
              <span className="opacity-60">{curPitcher.name}&apos;s arsenal</span>
            )}
          </div>
          <div
            className="mb-3.5 grid gap-1.5"
            style={{
              gridTemplateColumns: `repeat(${Math.min(
                Math.max(repertoire.length, 1),
                5
              )}, minmax(0, 1fr))`,
            }}
          >
            {repertoire.map((p) => {
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
              defs={defMap}
            />
          </div>
        </div>
      )}

      {tab === "batter" && (
        <BatterView
          game={game}
          viewBatter={viewBatter}
          setViewBatter={setViewBatter}
          defs={defMap}
        />
      )}

      {tab === "game" && <GameView game={game} defs={defMap} />}

      {showSetup && (
        <NewGameSetup
          onStart={startGame}
          onCancel={() => setShowSetup(false)}
        />
      )}

      {toast && (
        <div className="animate-pop fixed bottom-6 left-1/2 z-20 -translate-x-1/2 rounded-full bg-amber-500 px-4 py-2 text-[15px] font-bold tracking-wide text-black shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

/* ───────── sequence strip with repeat-detection (the predictability mirror) ───────── */
function Strip({
  pitches,
  all,
  defs,
}: {
  pitches: Pitch[];
  all?: Pitch[];
  defs: PitchDef[];
}) {
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
        const c = pitchDef(defs, p.type).c;
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
  defs,
}: {
  game: GameState;
  viewBatter: string | null;
  setViewBatter: (id: string | null) => void;
  defs: PitchDef[];
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
            #{batter.jersey}
            {batter.name && <span className="ml-2">{batter.name}</span>}{" "}
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
                <Strip pitches={ps} all={mine} defs={defs} />
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

/* ───────── game view: pooled mix-by-count, per pitcher ───────── */
function GameView({ game, defs }: { game: GameState; defs: PitchDef[] }) {
  const [filter, setFilter] = useState<string | "all">(
    game.pitcherId ?? "all"
  );

  const pitches = useMemo(
    () =>
      filter === "all"
        ? game.pitches
        : game.pitches.filter((p) => (p.pitcherId ?? null) === filter),
    [game.pitches, filter]
  );

  const overall = useMemo(() => {
    const m: Record<string, number> = {};
    pitches.forEach((p) => (m[p.type] = (m[p.type] || 0) + 1));
    return m;
  }, [pitches]);

  const byCount = useMemo(() => {
    const m: Record<string, { total: number; t: Record<string, number> }> = {};
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
  const typesUsed = defs.filter((d) => overall[d.k]);

  return (
    <div className="px-3.5 py-2">
      {/* pitcher filter — tendencies are pitcher-specific */}
      {game.pitchers.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <button
            onClick={() => setFilter("all")}
            className={cn(
              "rounded-lg border px-2.5 py-1.5 text-xs font-bold tracking-widest",
              filter === "all"
                ? "border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                : "border-border text-muted-foreground hover:bg-accent"
            )}
          >
            ALL
          </button>
          {game.pitchers.map((p) => (
            <button
              key={p.id}
              onClick={() => setFilter(p.id)}
              className={cn(
                "rounded-lg border px-2.5 py-1.5 text-xs font-bold",
                filter === p.id
                  ? "border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                  : "border-border text-muted-foreground hover:bg-accent"
              )}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {!total ? (
        <div className="p-5 text-muted-foreground/60">
          {filter === "all"
            ? "Log some pitches to see tendencies."
            : "No pitches from this pitcher yet."}
        </div>
      ) : (
        <>
          <div className="mx-0.5 mb-2 mt-1 text-xs tracking-widest text-muted-foreground">
            OVERALL MIX · {total} pitches
          </div>
          <div className="mb-1.5 flex h-[30px] overflow-hidden rounded-lg">
            {typesUsed.map((p) => (
              <div
                key={p.k}
                title={p.k}
                className="flex items-center justify-center text-xs font-bold text-black"
                style={{
                  width: `${((overall[p.k] || 0) / total) * 100}%`,
                  background: p.c,
                }}
              >
                {Math.round(((overall[p.k] || 0) / total) * 100) >= 10
                  ? p.k
                  : ""}
              </div>
            ))}
          </div>
          <div className="mb-4 flex flex-wrap gap-2.5">
            {typesUsed.map((p) => (
              <span
                key={p.k}
                className="font-mono text-xs text-muted-foreground"
              >
                <span style={{ color: p.c }}>■</span> {p.k} {overall[p.k]} (
                {Math.round(((overall[p.k] || 0) / total) * 100)}%)
              </span>
            ))}
          </div>

          <div className="mx-0.5 mb-2 mt-1 text-xs tracking-widest text-muted-foreground">
            MIX BY COUNT{" "}
            <span className="opacity-60">
              · raw counts shown — watch thin cells
            </span>
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
                    {defs
                      .filter((p) => row.t[p.k])
                      .map((p) => (
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
            Cells under 5 pitches are flagged red — they&apos;re too thin to
            read as a tendency. This view pools all batters; per-batter
            patterns live in the BATTER tab as sequence, not percentages.
          </div>
        </>
      )}
    </div>
  );
}
