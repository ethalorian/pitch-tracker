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
import {
  History,
  LogOut,
  RefreshCw,
  Sparkles,
  StopCircle,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import NewGameSetup, { type GameSetup } from "@/components/new-game-setup";
import PitcherEditor from "@/components/pitcher-editor";
import {
  createGameRow,
  endGame,
  getActiveCard,
  getActiveGame,
  listPitchers,
  saveGameRow,
  syncTeamBatters,
} from "@/lib/supabase/sync";
import { getSupabase } from "@/lib/supabase/client";
import { STANDARD_PITCHES, pitchDef, type PitchDef } from "@/lib/catalog";
import {
  DEFAULT_CARD_BUCKETS,
  randomCall,
  type CallCardBuckets,
} from "@/lib/callsheet";
import { buildInsightSummary } from "@/lib/insight";
import FieldChart, { type SprayMarker } from "@/components/field-chart";
import SequencingView from "@/components/sequencing-view";
import {
  EMPTY_GAME,
  TRAJ_LABEL,
  ZONES,
  swingOf,
  uid,
  type ContactQuality,
  type GameState,
  type Hand,
  type Outcome,
  type Pitch,
  type Pitcher,
  type Trajectory,
} from "@/lib/types";

const STORE_KEY = "fastpitch-caller-v1";
const GAME_ID_KEY = "fastpitch-caller-game-id";
const TS_KEY = "fastpitch-caller-ts";
const ck = (b: number, s: number) => `${b}-${s}`;

/**
 * Call targets: the four corners of the legacy 3×3 zone grid
 * (hi-in, hi-away, lo-in, lo-away). Indexes are unchanged so
 * previously logged 9-zone pitches still resolve to the right labels.
 */
const QUADRANTS = [0, 2, 6, 8] as const;

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
  const [firstRun, setFirstRun] = useState(false);
  // active wristband card (codes for relay); falls back to the default
  const [cardBuckets, setCardBuckets] =
    useState<CallCardBuckets>(DEFAULT_CARD_BUCKETS);
  // post-IN-PLAY contact panel: which pitch is awaiting detail
  const [contactFor, setContactFor] = useState<string | null>(null);
  const [contactQuality, setContactQuality] = useState<ContactQuality | null>(
    null
  );
  const [contactTraj, setContactTraj] = useState<Trajectory | null>(null);
  // AI insight
  const [insightOpen, setInsightOpen] = useState(false);
  const [insightText, setInsightText] = useState<string | null>(null);
  const [insightError, setInsightError] = useState<string | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);

  // true after hydration; gates rendering so SSR and first client render match
  const hydrated = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
  // becomes true once we've reconciled with the server (or decided offline)
  const [resolved, setResolved] = useState(false);
  const loaded = hydrated && resolved;

  // ── game row tracking; Supabase is the cross-device source of truth ──
  const gameIdRef = useRef<string | null | undefined>(undefined);
  const idPromiseRef = useRef<Promise<string | null> | null>(null);
  const gameMetaRef = useRef<{ opponent: string | null; teamId: string | null }>(
    { opponent: null, teamId: null }
  );

  const writeCache = (id: string | null) => {
    try {
      window.localStorage.setItem(TS_KEY, String(Date.now()));
      if (id) window.localStorage.setItem(GAME_ID_KEY, id);
    } catch {
      /* ignore */
    }
  };

  const ensureGameId = () => {
    if (gameIdRef.current) return Promise.resolve(gameIdRef.current);
    if (!idPromiseRef.current) {
      const { opponent, teamId } = gameMetaRef.current;
      idPromiseRef.current = createGameRow(opponent, teamId).then((id) => {
        if (id) {
          gameIdRef.current = id;
          writeCache(id);
        }
        idPromiseRef.current = null;
        return id;
      });
    }
    return idPromiseRef.current;
  };

  // resume: reconcile the local cache with the server's active game
  useEffect(() => {
    if (!hydrated) return;
    let live = true;
    (async () => {
      const localId = (() => {
        try {
          return window.localStorage.getItem(GAME_ID_KEY);
        } catch {
          return null;
        }
      })();
      const localTs = (() => {
        try {
          return Number(window.localStorage.getItem(TS_KEY) || 0);
        } catch {
          return 0;
        }
      })();

      const { online, game: server } = await getActiveGame();
      if (!live) return;

      if (!online) {
        // offline — trust whatever's cached locally
        gameIdRef.current = localId;
        setResolved(true);
        return;
      }
      if (!server) {
        // no active game anywhere — clear stale local and start clean
        try {
          window.localStorage.removeItem(STORE_KEY);
          window.localStorage.removeItem(GAME_ID_KEY);
          window.localStorage.removeItem(TS_KEY);
        } catch {
          /* ignore */
        }
        gameIdRef.current = null;
        setGame(EMPTY_GAME);
        setResolved(true);
        return;
      }

      const serverTs = Date.parse(server.updatedAt);
      const localIsNewer = localId === server.id && localTs > serverTs;
      if (!localIsNewer && server.state) {
        // adopt the server's copy (newer, or a different device's game)
        setGame({ ...EMPTY_GAME, ...server.state, pending: {} });
        writeCache(server.id);
      }
      gameIdRef.current = server.id;
      gameMetaRef.current = {
        opponent: server.opponent,
        teamId: server.teamId,
      };
      setResolved(true);
    })();
    return () => {
      live = false;
    };
  }, [hydrated]);

  // persist: localStorage immediately; Supabase (game + roster) debounced
  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(game));
      window.localStorage.setItem(TS_KEY, String(Date.now()));
    } catch {
      /* storage unavailable */
    }
    if (gameMetaRef.current.opponent == null && game.opponentName) {
      gameMetaRef.current = {
        opponent: game.opponentName,
        teamId: game.teamId,
      };
    }
    const t = setTimeout(() => {
      void ensureGameId().then((id) => {
        if (id) void saveGameRow(id, game);
      });
      if (game.teamId && game.batters.length) {
        void syncTeamBatters(game.teamId, game.batters);
      }
    }, 1500);
    return () => clearTimeout(t);
    // ensureGameId is a stable closure over refs; game+loaded drive saves
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, loaded]);

  // load the active wristband card (codes for relay)
  useEffect(() => {
    if (!hydrated) return;
    let live = true;
    getActiveCard().then((c) => {
      if (live && c && Object.keys(c.buckets).length) setCardBuckets(c.buckets);
    });
    return () => {
      live = false;
    };
  }, [hydrated]);

  // first-login onboarding: no pitchers anywhere → prompt to create one
  const checkedFirstRunRef = useRef(false);
  useEffect(() => {
    if (!loaded || checkedFirstRunRef.current) return;
    checkedFirstRunRef.current = true;
    if (game.pitchers.length > 0 || game.pitches.length > 0) return;
    let live = true;
    listPitchers().then((ps) => {
      if (live && ps.length === 0) setFirstRun(true);
    });
    return () => {
      live = false;
    };
  }, [loaded, game.pitchers.length, game.pitches.length]);

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

  // live line for the current pitcher: workload + strike throwing
  const pitcherStats = useMemo(() => {
    const mine = game.pitches.filter(
      (p) => (p.pitcherId ?? null) === game.pitcherId
    );
    const isStrike = (p: Pitch) => p.outcome != null && p.outcome !== "ball";
    const total = mine.length;
    const strikes = mine.filter(isStrike).length;
    const first = mine.filter((p) => p.b === 0 && p.s === 0);
    const firstStrikes = first.filter(isStrike).length;
    return {
      total,
      strikePct: total ? Math.round((strikes / total) * 100) : null,
      fpsPct: first.length
        ? Math.round((firstStrikes / first.length) * 100)
        : null,
    };
  }, [game.pitches, game.pitcherId]);

  // batter intel, all night: contact (red) vs swing-and-miss (blue),
  // per zone for the heat overlay and per type+zone combo for advice
  const batterHeat = useMemo(() => {
    const zones: Record<number, { contact: number; miss: number }> = {};
    const combos: Record<
      string,
      { contact: number; miss: number; type: string; zone: number }
    > = {};
    if (!game.currentBatterId) return { zones, combos };
    for (const p of game.pitches) {
      if (p.batterId !== game.currentBatterId) continue;
      const sw = swingOf(p.outcome);
      if (sw !== "contact" && sw !== "miss") continue;
      // hard contact counts double — squared-up matters more than a dribbler
      const w = sw === "contact" && p.contact?.quality === "hard" ? 2 : 1;
      zones[p.zone] = zones[p.zone] ?? { contact: 0, miss: 0 };
      zones[p.zone][sw] += w;
      const k = `${p.type}|${p.zone}`;
      combos[k] = combos[k] ?? { contact: 0, miss: 0, type: p.type, zone: p.zone };
      combos[k][sw] += w;
    }
    return { zones, combos };
  }, [game.pitches, game.currentBatterId]);

  const advice = useMemo(() => {
    const list = Object.values(batterHeat.combos);
    let avoid: (typeof list)[number] | null = null;
    let throwRec: (typeof list)[number] | null = null;
    for (const c of list) {
      // she's hitting it there → stay away
      if (c.contact > 0 && (!avoid || c.contact > avoid.contact)) avoid = c;
      // she's swinging through it there → go back to it
      if (
        c.miss > c.contact &&
        (!throwRec || c.miss - c.contact > throwRec.miss - throwRec.contact)
      )
        throwRec = c;
    }
    return { avoid, throwRec };
  }, [batterHeat]);

  /** zone heat → background: red = contact, blue = whiffs, deeper = more */
  const zoneBg = (zone: number): string | undefined => {
    const h = batterHeat.zones[zone];
    if (!h) return undefined;
    const alpha = (n: number) => 0.18 + Math.min(n, 4) * 0.12;
    if (h.contact >= h.miss && h.contact > 0)
      return `rgba(239, 68, 68, ${alpha(h.contact)})`;
    if (h.miss > 0) return `rgba(59, 130, 246, ${alpha(h.miss)})`;
    return undefined;
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

  // the call stays selected (highlighted) until the result tags it;
  // pitch + outcome commit together on the result tap. When both type
  // and zone are set, a random wristband code is drawn to relay.
  const pickType = (t: string) => {
    if (!game.currentBatterId) {
      flash("Pick a batter first");
      return;
    }
    setGame((g) => {
      const type = g.pending.type === t ? undefined : t;
      const call =
        type != null && g.pending.zone != null
          ? randomCall(cardBuckets, type, g.pending.zone) ?? undefined
          : undefined;
      return { ...g, pending: { ...g.pending, type, call } };
    });
  };

  const pickZone = (z: number) => {
    if (!game.currentBatterId) {
      flash("Pick a batter first");
      return;
    }
    setGame((g) => {
      const zone = g.pending.zone === z ? undefined : z;
      const call =
        zone != null && g.pending.type != null
          ? randomCall(cardBuckets, g.pending.type, zone) ?? undefined
          : undefined;
      return { ...g, pending: { ...g.pending, zone, call } };
    });
  };

  const rerollCall = () =>
    setGame((g) => {
      if (g.pending.type == null || g.pending.zone == null) return g;
      return {
        ...g,
        pending: {
          ...g.pending,
          call:
            randomCall(cardBuckets, g.pending.type, g.pending.zone) ??
            undefined,
        },
      };
    });

  const outcome = (o: Outcome) => {
    if (game.pending.type == null || game.pending.zone == null) {
      flash("Select pitch + location first");
      return;
    }
    // auto-advance: once the order has been around (2nd+ AB for this
    // batter), the lineup is known — next hitter comes up automatically
    const willEnd: "BB" | "K" | "IP" | null =
      o === "inplay"
        ? "IP"
        : o === "ball" && game.count.b >= 3
          ? "BB"
          : (o === "called" || o === "miss" || o === "strike") &&
              game.count.s >= 2
            ? "K"
            : null;
    const priorAbs = game.abResults.filter(
      (r) => r.batterId === game.currentBatterId
    ).length;
    const curIdx = game.batters.findIndex(
      (b) => b.id === game.currentBatterId
    );
    const nextBatter =
      game.batters.length > 1 && curIdx >= 0
        ? game.batters[(curIdx + 1) % game.batters.length]
        : null;
    const autoAdvance = willEnd != null && priorAbs >= 1 && nextBatter != null;
    setGame((g) => {
      if (!g.currentBatterId || g.pending.type == null || g.pending.zone == null)
        return g;
      const pitch: Pitch = {
        id: uid(),
        batterId: g.currentBatterId,
        pitcherId: g.pitcherId,
        ab: g.currentAb,
        type: g.pending.type,
        zone: g.pending.zone,
        b: g.count.b,
        s: g.count.s,
        outcome: o,
        call: g.pending.call,
        ts: Date.now(),
      };
      const pitches = [...g.pitches, pitch];
      let { b, s } = g.count;
      let ended: "BB" | "K" | "IP" | null = null;
      if (o === "ball") {
        b++;
        if (b >= 4) ended = "BB";
      } else if (o === "called" || o === "miss" || o === "strike") {
        s++;
        if (s >= 3) ended = "K";
      } else if (o === "foul") {
        if (s < 2) s++;
      } else if (o === "inplay") {
        ended = "IP";
      }
      if (ended) {
        const base = {
          ...g,
          pitches,
          pending: {},
          lastLogged: pitch.id,
          abResults: [
            ...g.abResults,
            { ab: g.currentAb, batterId: g.currentBatterId, result: ended },
          ],
          count: { b: 0, s: 0 },
        };
        if (autoAdvance && nextBatter) {
          return {
            ...base,
            abOver: false,
            currentBatterId: nextBatter.id,
            currentAb: g.abCounter + 1,
            abCounter: g.abCounter + 1,
          };
        }
        return { ...base, abOver: true };
      }
      return {
        ...g,
        pitches,
        pending: {},
        lastLogged: pitch.id,
        count: { b, s },
        abOver: false,
      };
    });
    if (autoAdvance && nextBatter) {
      flash(`${willEnd} · UP: #${nextBatter.jersey}`);
    }
    if (o === "inplay") {
      // AB is over — dead time. Ask hard/weak, trajectory, and where.
      setContactQuality(null);
      setContactTraj(null);
      setContactFor("last");
    }
  };

  const tagContact = (
    quality: ContactQuality,
    trajectory: Trajectory,
    x: number,
    y: number
  ) => {
    setGame((g) => {
      const pitches = [...g.pitches];
      for (let i = pitches.length - 1; i >= 0; i--) {
        if (pitches[i].outcome === "inplay") {
          pitches[i] = {
            ...pitches[i],
            contact: { quality, trajectory, x, y },
          };
          break;
        }
      }
      return { ...g, pitches };
    });
    setContactFor(null);
    setContactQuality(null);
    setContactTraj(null);
    flash(`${quality.toUpperCase()} ${TRAJ_LABEL[trajectory]}`);
  };

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
      window.localStorage.removeItem(TS_KEY);
    } catch {
      /* ignore */
    }
    void ensureGameId();
  };

  const endCurrentGame = async () => {
    if (
      !window.confirm(
        "End this game? It moves to history and can be reviewed anytime."
      )
    )
      return;
    const id = gameIdRef.current;
    if (id) {
      // flush any unsaved state first, then close
      await saveGameRow(id, game);
      await endGame(id);
    }
    gameIdRef.current = null;
    idPromiseRef.current = null;
    try {
      window.localStorage.removeItem(STORE_KEY);
      window.localStorage.removeItem(GAME_ID_KEY);
      window.localStorage.removeItem(TS_KEY);
    } catch {
      /* ignore */
    }
    setGame(EMPTY_GAME);
    flash("Game ended — saved to history");
  };

  /** Reverse the last pitch entirely: record, count, and AB end if it caused one. */
  const undoLast = () => {
    setGame((g) => {
      const pitches = [...g.pitches];
      const last = pitches.pop();
      if (!last) return g;
      return {
        ...g,
        pitches,
        abResults: g.abResults.filter((r) => r.ab !== last.ab),
        count: { b: last.b, s: last.s },
        currentBatterId: last.batterId,
        currentAb: last.ab,
        abOver: false,
        pending: {},
      };
    });
    flash("Last pitch undone");
  };

  const fetchInsight = async () => {
    setInsightOpen(true);
    setInsightError(null);
    setInsightText(null);
    const summary = buildInsightSummary(game);
    if (!summary.trim()) {
      setInsightError("Log some pitches first — nothing to analyze yet.");
      return;
    }
    setInsightLoading(true);
    try {
      const res = await fetch("/api/insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInsightError(data?.error ?? "Insight request failed.");
      } else {
        setInsightText(data.insight ?? "");
      }
    } catch {
      setInsightError("Network error — check your connection.");
    } finally {
      setInsightLoading(false);
    }
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

  // first login: create a pitcher before anything else
  if (firstRun) {
    return (
      <div className="mx-auto w-full max-w-[480px] px-4 pb-24 font-sans">
        <div className="flex items-center justify-between py-4">
          <div className="text-lg font-bold tracking-wide">
            PITCH
            <span className="text-amber-600 dark:text-amber-400">CALL</span>
          </div>
          <ThemeToggle />
        </div>
        <div className="mb-4 rounded-xl border bg-card p-4">
          <div className="mb-1 text-lg font-bold">Welcome, Coach.</div>
          <p className="text-sm text-muted-foreground">
            Start by setting up your first pitcher — her repertoire becomes
            the pitch buttons you&apos;ll tap during games. You can add more
            pitchers later on the coach screen.
          </p>
        </div>
        <PitcherEditor
          initial={null}
          title="YOUR FIRST PITCHER"
          onSaved={() => {
            setFirstRun(false);
            setShowSetup(true);
          }}
        />
      </div>
    );
  }

  return (
    <div className="relative mx-auto w-full max-w-[480px] pb-24 font-sans md:max-w-[1100px] xl:max-w-[1440px]">
      {/* header */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-3.5 py-3">
        <div className="text-lg font-bold tracking-wide">
          PITCH
          <span className="text-amber-600 dark:text-amber-400">CALL</span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/history"
            aria-label="History & scouting"
            className="rounded-lg border p-1.5 text-muted-foreground hover:bg-accent"
          >
            <History className="size-4" />
          </Link>
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
        <div className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          {game.opponentName ? (
            <>
              vs <span className="font-bold text-foreground">{game.opponentName}</span>
            </>
          ) : (
            "no opponent set"
          )}
        </div>
        {(game.pitches.length > 0 ||
          game.pitcherId != null ||
          game.opponentName != null) && (
          <button
            onClick={endCurrentGame}
            aria-label="End game"
            className="flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-bold tracking-wide text-muted-foreground hover:bg-accent"
          >
            <StopCircle className="size-3.5" />
            END
          </button>
        )}
        <button
          onClick={fetchInsight}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-500 bg-amber-500/10 px-2.5 py-1.5 text-sm font-bold text-amber-600 hover:bg-amber-500/20 dark:text-amber-400"
        >
          <Sparkles className="size-3.5" />
          INSIGHT
        </button>
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

      {/* tabs — phone only; iPad+ shows all panels at once */}
      <div className="flex gap-1.5 px-3.5 pb-1 pt-2.5 md:hidden">
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

      {/* data-rich layout: phone = tabbed, md+ = call | batter | tendencies */}
      <div className="md:grid md:grid-cols-[minmax(400px,480px)_minmax(0,1fr)] md:items-start md:gap-5 md:px-4 md:pt-3">
        <section
          className={cn(
            tab !== "call" && "hidden",
            "md:block md:rounded-xl md:border md:bg-card/30 md:py-1"
          )}
        >
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
                    "shrink-0 rounded-lg border px-3.5 py-2.5 text-[15px] font-bold",
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

          {/* batter + relay + count: fixed slots, nothing shifts mid-pitch */}
          <div className="mb-2.5 flex items-center justify-between gap-2 rounded-xl border bg-card px-4 py-2.5">
            <div className="min-w-[72px]">
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
            <button
              onClick={rerollCall}
              disabled={
                game.pending.type == null || game.pending.zone == null
              }
              className="min-w-[110px] rounded-lg px-2 py-0.5 text-center hover:bg-accent disabled:hover:bg-transparent"
            >
              <div className="text-[11px] tracking-widest text-muted-foreground">
                RELAY
              </div>
              {game.pending.type != null && game.pending.zone != null ? (
                game.pending.call ? (
                  <div className="animate-pop font-mono text-[34px] font-bold leading-none tracking-[0.2em] text-amber-600 dark:text-amber-400">
                    {game.pending.call}
                  </div>
                ) : (
                  <div className="py-1.5 text-xs font-bold leading-none text-red-600 dark:text-red-400">
                    NOT ON CARD
                  </div>
                )
              ) : (
                <div className="font-mono text-[34px] font-bold leading-none tracking-[0.2em] text-muted-foreground/25">
                  ···
                </div>
              )}
            </button>
            <div className="min-w-[72px] text-right">
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

          {/* live pitcher line: workload + strike throwing */}
          <div className="mb-2.5 grid grid-cols-3 gap-1.5">
            {(
              [
                ["PITCHES", pitcherStats.total],
                [
                  "STRIKE %",
                  pitcherStats.strikePct != null
                    ? `${pitcherStats.strikePct}`
                    : "—",
                ],
                [
                  "1ST-PITCH K %",
                  pitcherStats.fpsPct != null ? `${pitcherStats.fpsPct}` : "—",
                ],
              ] as const
            ).map(([label, value]) => (
              <div
                key={label}
                className="rounded-xl border bg-card px-2 py-1.5 text-center"
              >
                <div className="text-[10px] tracking-widest text-muted-foreground">
                  {label}
                </div>
                <div className="font-mono text-xl font-bold leading-tight text-foreground">
                  {value}
                </div>
              </div>
            ))}
          </div>

          {game.abOver && (
            <div className="mb-2.5 flex items-center gap-2 rounded-xl border border-amber-500 bg-card px-3 py-2">
              <div className="flex-1 text-sm font-bold tracking-wide text-amber-600 dark:text-amber-400">
                AT-BAT ENDED
              </div>
              <button
                onClick={undoLast}
                className="rounded-lg border px-2.5 py-1.5 text-xs font-bold tracking-wide text-muted-foreground hover:bg-accent"
              >
                UNDO
              </button>
              {(() => {
                if (game.batters.length < 2) return null;
                const idx = game.batters.findIndex(
                  (b) => b.id === game.currentBatterId
                );
                const next = game.batters[(idx + 1) % game.batters.length];
                return (
                  <button
                    onClick={() => bringUp(next.id)}
                    className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-bold text-black"
                  >
                    NEXT: #{next.jersey}
                  </button>
                );
              })()}
            </div>
          )}

          {/* predictive read: one fixed-height line, never shifts the layout */}
          {curBatter && (
            <div className="mb-2.5 flex h-9 items-center gap-3 overflow-x-auto whitespace-nowrap rounded-xl border bg-card px-3 font-mono text-xs">
              {advice.throwRec && (
                <span className="font-bold text-blue-600 dark:text-blue-400">
                  THROW {advice.throwRec.type}·
                  {ZONES[advice.throwRec.zone].toUpperCase()} ×
                  {advice.throwRec.miss}
                </span>
              )}
              {advice.avoid && (
                <span className="font-bold text-red-600 dark:text-red-400">
                  AVOID {advice.avoid.type}·
                  {ZONES[advice.avoid.zone].toUpperCase()} ×
                  {advice.avoid.contact}
                </span>
              )}
              {!advice.throwRec && !advice.avoid && (
                <span className="text-muted-foreground/50">
                  no read on her yet
                </span>
              )}
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

          {/* location — four quadrants, no middle: you don't call meatballs */}
          <div className="mx-0.5 mb-1.5 mt-0.5 flex justify-between text-xs tracking-widest text-muted-foreground">
            <span>② LOCATION</span>
            <span className="opacity-60">relative to batter</span>
          </div>
          <div className="mb-3.5 grid grid-cols-2 gap-1.5">
            {QUADRANTS.map((i) => {
              const on = game.pending.zone === i;
              const bg = on ? undefined : zoneBg(i);
              return (
                <button
                  key={i}
                  onClick={() => pickZone(i)}
                  className={cn(
                    "rounded-xl border-2 py-7 text-[14px] font-semibold uppercase tracking-wide",
                    on
                      ? "border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      : "border-border bg-card text-foreground/80 hover:brightness-110"
                  )}
                  style={bg ? { background: bg } : undefined}
                >
                  {ZONES[i]}
                </button>
              );
            })}
          </div>

          {/* outcome — grouped by what the bat did: no swing | swing */}
          <div className="mx-0.5 mb-1.5 mt-0.5 flex justify-between text-xs tracking-widest text-muted-foreground">
            <span>③ RESULT</span>
            <span className="opacity-60">no swing · swing</span>
          </div>
          <div className="flex gap-3">
            <div className="grid flex-[2] grid-cols-2 gap-1.5">
              {(
                [
                  ["ball", "BALL"],
                  ["called", "CALLED"],
                ] as const
              ).map(([o, l]) => (
                <ResultButton
                  key={o}
                  label={l}
                  armed={
                    game.pending.type != null && game.pending.zone != null
                  }
                  disabled={!curBatter}
                  onTap={() => outcome(o)}
                />
              ))}
            </div>
            <div className="grid flex-[3] grid-cols-3 gap-1.5">
              {(
                [
                  ["miss", "MISS"],
                  ["foul", "FOUL"],
                  ["inplay", "IN PLAY"],
                ] as const
              ).map(([o, l]) => (
                <ResultButton
                  key={o}
                  label={l}
                  armed={
                    game.pending.type != null && game.pending.zone != null
                  }
                  disabled={!curBatter}
                  onTap={() => outcome(o)}
                />
              ))}
            </div>
          </div>

          {/* live AB strip */}
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-xs tracking-widest text-muted-foreground">
              <span>THIS AT-BAT</span>
              <button
                onClick={undoLast}
                disabled={!game.pitches.length}
                className="rounded-lg border px-2 py-1 text-[11px] font-bold tracking-wide hover:bg-accent disabled:opacity-30"
              >
                ⌫ UNDO LAST
              </button>
            </div>
            <Strip pitches={curAbPitches} defs={defMap} />
          </div>
        </div>
        </section>

        <div className="md:flex md:flex-col md:gap-5 xl:grid xl:grid-cols-2 xl:items-start">
          <section
            className={cn(
              tab !== "batter" && "hidden",
              "md:block md:rounded-xl md:border md:bg-card/30"
            )}
          >
            <div className="hidden px-3.5 pt-3 text-xs font-bold tracking-widest text-muted-foreground md:block">
              BATTER
            </div>
            <BatterView
              game={game}
              viewBatter={viewBatter}
              setViewBatter={setViewBatter}
              defs={defMap}
            />
          </section>

          <section
            className={cn(
              tab !== "game" && "hidden",
              "md:block md:rounded-xl md:border md:bg-card/30"
            )}
          >
            <div className="hidden px-3.5 pt-3 text-xs font-bold tracking-widest text-muted-foreground md:block">
              GAME TENDENCIES
            </div>
            <GameView game={game} defs={defMap} />
          </section>
        </div>
      </div>

      {showSetup && (
        <NewGameSetup
          onStart={startGame}
          onCancel={() => setShowSetup(false)}
        />
      )}

      {/* AI insight panel */}
      {insightOpen && (
        <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-background/85 p-4 pt-10 backdrop-blur-sm">
          <div className="w-full max-w-[460px] rounded-xl border bg-card p-4">
            <div className="mb-2.5 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-sm font-bold tracking-widest text-amber-600 dark:text-amber-400">
                <Sparkles className="size-4" />
                INSIGHT · {curPitcher?.name ?? "pitcher"}
              </div>
              <button
                aria-label="Close"
                onClick={() => setInsightOpen(false)}
                className="rounded-lg border p-1 text-muted-foreground hover:bg-accent"
              >
                <X className="size-4" />
              </button>
            </div>

            {insightLoading && (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <RefreshCw className="size-4 animate-spin" />
                Reading the game…
              </div>
            )}

            {insightError && (
              <div className="rounded-lg border border-red-500/60 bg-red-500/10 px-3 py-2.5 text-sm text-red-600 dark:text-red-400">
                {insightError}
              </div>
            )}

            {insightText && (
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-card-foreground">
                {insightText}
              </div>
            )}

            {!insightLoading && (
              <button
                onClick={fetchInsight}
                className="mt-3 w-full rounded-lg border py-2 text-xs font-bold tracking-widest text-muted-foreground hover:bg-accent"
              >
                ↻ RE-ANALYZE
              </button>
            )}
            <div className="mt-2 text-center text-[10px] text-muted-foreground/60">
              AI-generated — your read overrules it.
            </div>
          </div>
        </div>
      )}

      {/* post-IN-PLAY contact detail: hard/weak + trajectory, then tap the field */}
      {contactFor && (
        <div className="fixed inset-0 z-30 flex items-end justify-center overflow-y-auto bg-background/80 p-4 pb-10 backdrop-blur-sm">
          <div className="w-full max-w-[440px] rounded-xl border bg-card p-4">
            <div className="mb-2.5 flex items-center justify-between">
              <div className="text-xs font-bold tracking-widest text-amber-600 dark:text-amber-400">
                BALL IN PLAY — HOW &amp; WHERE?
              </div>
              <button
                onClick={() => {
                  setContactFor(null);
                  setContactQuality(null);
                  setContactTraj(null);
                }}
                className="rounded-lg border px-2 py-1 text-[11px] tracking-widest text-muted-foreground hover:bg-accent"
              >
                SKIP
              </button>
            </div>

            <div className="mb-1.5 grid grid-cols-2 gap-1.5">
              {(["hard", "weak"] as const).map((q) => (
                <button
                  key={q}
                  onClick={() => setContactQuality(q)}
                  className={cn(
                    "rounded-xl border-2 py-3 text-base font-bold tracking-wide",
                    contactQuality === q
                      ? q === "hard"
                        ? "border-red-500 bg-red-500/20 text-red-600 dark:text-red-400"
                        : "border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      : "border-border text-muted-foreground hover:bg-accent"
                  )}
                >
                  {q.toUpperCase()}
                </button>
              ))}
            </div>

            <div className="mb-2.5 grid grid-cols-3 gap-1.5">
              {(["ground", "line", "fly"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setContactTraj(t)}
                  className={cn(
                    "rounded-xl border-2 py-3 text-sm font-bold tracking-wide",
                    contactTraj === t
                      ? "border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      : "border-border text-muted-foreground hover:bg-accent"
                  )}
                >
                  {TRAJ_LABEL[t]}
                </button>
              ))}
            </div>

            <div
              className={cn(
                "rounded-xl border",
                contactQuality && contactTraj
                  ? "border-amber-500"
                  : "pointer-events-none opacity-40"
              )}
            >
              <FieldChart
                className="w-full"
                onTap={(x, y) =>
                  contactQuality &&
                  contactTraj &&
                  tagContact(contactQuality, contactTraj, x, y)
                }
              />
            </div>
            <div className="mt-2 text-center text-xs text-muted-foreground">
              {contactQuality && contactTraj
                ? "tap the field where it went"
                : "pick quality + trajectory, then tap the field"}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="animate-pop fixed bottom-6 left-1/2 z-20 -translate-x-1/2 rounded-full bg-amber-500 px-4 py-2 text-[15px] font-bold tracking-wide text-black shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function ResultButton({
  label,
  armed,
  disabled,
  onTap,
}: {
  label: string;
  armed: boolean;
  disabled: boolean;
  onTap: () => void;
}) {
  return (
    <button
      onClick={onTap}
      disabled={disabled}
      className={cn(
        "rounded-xl border bg-card py-3.5 text-[12px] font-bold tracking-wide text-card-foreground hover:bg-accent disabled:opacity-40",
        armed && "animate-pulse-glow"
      )}
    >
      {label}
    </button>
  );
}

/* ───────── sequence strip: the calls, in order, with swing results ───────── */
const OUTCOME_LABEL: Record<string, string> = {
  ball: "B",
  strike: "S",
  called: "ꓘ",
  miss: "W",
  foul: "F",
  inplay: "IP",
};

function Strip({ pitches, defs }: { pitches: Pitch[]; defs: PitchDef[] }) {
  if (!pitches.length) {
    return (
      <div className="px-0.5 py-1.5 text-sm text-muted-foreground/60">
        no pitches yet
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {pitches.map((p) => {
        const c = pitchDef(defs, p.type).c;
        const sw = swingOf(p.outcome);
        return (
          <div
            key={p.id}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 font-mono text-xs"
          >
            <span className="text-muted-foreground">
              {p.b}-{p.s}
            </span>
            <span className="font-bold" style={{ color: c }}>
              {p.type}
            </span>
            <span className="text-card-foreground/80">{ZONES[p.zone]}</span>
            {p.outcome && (
              <span
                className={cn(
                  "text-[10px] font-bold",
                  sw === "contact" && "text-red-600 dark:text-red-400",
                  sw === "miss" && "text-blue-600 dark:text-blue-400",
                  sw === "none" && "text-muted-foreground/60"
                )}
              >
                {OUTCOME_LABEL[p.outcome] ?? p.outcome[0].toUpperCase()}
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

  // swing profile: what she's hit vs swung through, by call
  const combos: Record<string, { contact: number; miss: number; hard: number }> =
    {};
  const sprayMarkers: SprayMarker[] = [];
  mine.forEach((p) => {
    const sw = swingOf(p.outcome);
    if (sw !== "contact" && sw !== "miss") return;
    const k = `${p.type} ${ZONES[p.zone]}`;
    combos[k] = combos[k] ?? { contact: 0, miss: 0, hard: 0 };
    combos[k][sw]++;
    if (p.contact) {
      if (p.contact.quality === "hard") combos[k].hard++;
      if (p.contact.x != null && p.contact.y != null) {
        sprayMarkers.push({
          x: p.contact.x,
          y: p.contact.y,
          quality: p.contact.quality,
          trajectory: p.contact.trajectory,
        });
      }
    }
  });
  const hits = Object.entries(combos)
    .filter(([, v]) => v.contact > 0)
    .sort((a, b) => b[1].hard - a[1].hard || b[1].contact - a[1].contact);
  const whiffs = Object.entries(combos)
    .filter(([, v]) => v.miss > 0 && v.miss >= v.contact)
    .sort((a, b) => b[1].miss - a[1].miss);

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

          {(hits.length > 0 || whiffs.length > 0) && (
            <div className="mb-3.5 mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-red-500/60 bg-card px-3 py-2.5">
                <div className="mb-1.5 text-[11px] font-bold tracking-widest text-red-600 dark:text-red-400">
                  SHE&apos;S ON THESE
                </div>
                {hits.length ? (
                  hits.map(([k, v]) => (
                    <div key={k} className="py-0.5 font-mono text-xs">
                      <span className="text-red-600 dark:text-red-400">
                        {v.contact}×
                      </span>{" "}
                      {k}
                      {v.hard > 0 && (
                        <span className="ml-1 font-bold text-red-600 dark:text-red-400">
                          ({v.hard} hard)
                        </span>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="font-mono text-xs text-muted-foreground/60">
                    no contact yet
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-blue-500/60 bg-card px-3 py-2.5">
                <div className="mb-1.5 text-[11px] font-bold tracking-widest text-blue-600 dark:text-blue-400">
                  SHE&apos;S MISSING
                </div>
                {whiffs.length ? (
                  whiffs.map(([k, v]) => (
                    <div key={k} className="py-0.5 font-mono text-xs">
                      <span className="text-blue-600 dark:text-blue-400">
                        {v.miss}×
                      </span>{" "}
                      {k}
                    </div>
                  ))
                ) : (
                  <div className="font-mono text-xs text-muted-foreground/60">
                    no whiffs yet
                  </div>
                )}
              </div>
            </div>
          )}

          {sprayMarkers.length > 0 && (
            <div className="mb-3.5 rounded-xl border bg-card p-3">
              <div className="mb-1 flex items-center justify-between text-[11px] font-bold tracking-widest text-muted-foreground">
                <span>SPRAY CHART</span>
                <span className="font-mono font-normal normal-case">
                  <span className="text-red-600 dark:text-red-400">●</span> hard{" "}
                  <span className="ml-1.5 text-amber-600 dark:text-amber-400">
                    ○
                  </span>{" "}
                  weak · G/L/F
                </span>
              </div>
              <FieldChart className="w-full" markers={sprayMarkers} />
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
                <Strip pitches={ps} defs={defs} />
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

  // team spray: every ball in play (off the filtered pitcher), live
  const teamSpray = useMemo<SprayMarker[]>(
    () =>
      pitches
        .filter((p) => p.contact?.x != null && p.contact?.y != null)
        .map((p) => ({
          x: p.contact!.x!,
          y: p.contact!.y!,
          quality: p.contact!.quality,
          trajectory: p.contact!.trajectory,
        })),
    [pitches]
  );

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
          {teamSpray.length > 0 && (
            <div className="mb-3.5 rounded-xl border bg-card p-3">
              <div className="mb-1 flex items-center justify-between text-[11px] font-bold tracking-widest text-muted-foreground">
                <span>TEAM SPRAY · {teamSpray.length} IN PLAY</span>
                <span className="font-mono font-normal normal-case">
                  <span className="text-red-600 dark:text-red-400">●</span> hard{" "}
                  <span className="ml-1.5 text-amber-600 dark:text-amber-400">
                    ○
                  </span>{" "}
                  weak · G/L/F
                </span>
              </div>
              <FieldChart className="w-full" markers={teamSpray} />
            </div>
          )}

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

          <div className="mx-0.5 mb-2 mt-5 text-xs tracking-widest text-muted-foreground">
            SEQUENCING <span className="opacity-60">· what finishes hitters</span>
          </div>
          <SequencingView pitches={pitches} abResults={game.abResults} />
        </>
      )}
    </div>
  );
}
