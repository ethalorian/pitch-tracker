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
  BarChart3,
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
import { Skeleton } from "@/components/app-header";
import { useConfirm } from "@/components/ui/confirm-dialog";
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
import { STANDARD_PITCHES, type PitchDef } from "@/lib/catalog";
import {
  DEFAULT_CARD_BUCKETS,
  randomCall,
  type CallCardBuckets,
} from "@/lib/callsheet";
import { buildInsightSummary } from "@/lib/insight";
import FieldChart, { type SprayMarker } from "@/components/field-chart";
import SequencingView from "@/components/sequencing-view";
import PitcherStatusPanel from "@/components/pitcher-status";
import { analyzePitcherStatus } from "@/lib/pitcher-status";
import {
  EMPTY_GAME,
  ZONES,
  uid,
  type GameState,
  type Outcome,
  type Pitch,
  type Pitcher,
} from "@/lib/types";

const STORE_KEY = "fastpitch-caller-v1";
const GAME_ID_KEY = "fastpitch-caller-game-id";
const TS_KEY = "fastpitch-caller-ts";
const ck = (b: number, s: number) => `${b}-${s}`;

/** Swipe order for the three views (single-finger horizontal flick). */
const VIEW_ORDER = ["call", "game"] as const;

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
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [game, setGame] = useState<GameState>(loadGame);
  const [tab, setTab] = useState<"call" | "game">("call");
  const [toast, setToast] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [online, setOnline] = useState(true); // trust indicator; data always saved locally
  const [roster, setRoster] = useState<Pitcher[]>([]); // live staff for mid-game changes
  const [pickingPitcher, setPickingPitcher] = useState(false);
  const [firstRun, setFirstRun] = useState(false);
  // active wristband card (codes for relay); falls back to the default
  const [cardBuckets, setCardBuckets] =
    useState<CallCardBuckets>(DEFAULT_CARD_BUCKETS);
  // post-IN-PLAY contact panel: which pitch is awaiting detail
  const [contactFor, setContactFor] = useState<string | null>(null);
  const [contactTraj, setContactTraj] = useState<"ground" | "fly" | null>(null);
  // AI insight
  const [insightOpen, setInsightOpen] = useState(false);
  const [insightText, setInsightText] = useState<string | null>(null);
  const [insightError, setInsightError] = useState<string | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightTitle, setInsightTitle] = useState("INSIGHT");
  const insightRunRef = useRef<() => void>(() => {});

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
    let live = true;
    listPitchers().then((ps) => {
      if (!live) return;
      setRoster(ps); // full staff, so you can bring in any pitcher mid-game
      if (ps.length === 0 && game.pitchers.length === 0 && game.pitches.length === 0)
        setFirstRun(true);
    });
    return () => {
      live = false;
    };
  }, [loaded, game.pitchers.length, game.pitches.length]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1400);
  };

  // keep the screen awake during a game — a phone sleeping mid-at-bat in
  // the dugout is maddening. Feature-detected; re-acquires when the tab
  // returns to the foreground (the OS drops the lock on blur).
  useEffect(() => {
    const nav = navigator as Navigator & {
      wakeLock?: { request: (t: "screen") => Promise<{ release: () => void }> };
    };
    if (!nav.wakeLock) return;
    let sentinel: { release: () => void } | null = null;
    const acquire = async () => {
      try {
        sentinel = await nav.wakeLock!.request("screen");
      } catch {
        /* denied (low battery, etc.) — harmless */
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      try {
        sentinel?.release();
      } catch {
        /* already released */
      }
    };
  }, []);

  // online/offline for the trust indicator (every pitch is saved on the
  // device regardless; this only tells you whether it's also syncing)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  /* ── derived ── */
  // every pitcher you could bring in: this game's snapshot + the live
  // staff (so pitchers added after the game started still show up).
  const availablePitchers = useMemo(() => {
    const byId = new Map<string, Pitcher>();
    for (const p of game.pitchers) byId.set(p.id, p);
    for (const p of roster) if (!byId.has(p.id)) byId.set(p.id, p);
    return [...byId.values()];
  }, [game.pitchers, roster]);

  const curPitcher =
    availablePitchers.find((p) => p.id === game.pitcherId) ?? null;
  const repertoire: PitchDef[] = curPitcher?.pitches.length
    ? curPitcher.pitches
    : STANDARD_PITCHES; // legacy games / no pitcher yet
  const defMap = useMemo(() => {
    const defs = buildDefMap(game.pitchers);
    return defs.length ? defs : STANDARD_PITCHES;
  }, [game.pitchers]);
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

  /* ── actions ── */
  // the call stays selected (highlighted) until the result tags it;
  // pitch + outcome commit together on the result tap. When both type
  // and zone are set, a random wristband code is drawn to relay.
  const pickType = (t: string) => {
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
    setGame((g) => {
      if (g.pending.type == null || g.pending.zone == null) return g;
      const pitch: Pitch = {
        id: uid(),
        batterId: g.currentBatterId ?? "anon",
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
      // a plate appearance ends → log the result, reset the count, and
      // roll to the next anonymous at-bat automatically
      if (ended) {
        return {
          ...g,
          pitches,
          pending: {},
          lastLogged: pitch.id,
          abResults: [
            ...g.abResults,
            { ab: g.currentAb, batterId: pitch.batterId, result: ended },
          ],
          count: { b: 0, s: 0 },
          currentAb: g.abCounter + 1,
          abCounter: g.abCounter + 1,
          abOver: false,
        };
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
    if (o === "inplay") {
      // ball in play — capture ground/fly + where it landed
      setContactTraj(null);
      setContactFor("last");
    }
  };

  // record a ball in play: ground/fly + where it landed (normalized coords)
  const tagContact = (x: number, y: number) => {
    const trajectory = contactTraj;
    setGame((g) => {
      const pitches = [...g.pitches];
      for (let i = pitches.length - 1; i >= 0; i--) {
        if (pitches[i].outcome === "inplay") {
          pitches[i] = {
            ...pitches[i],
            contact: { x, y, trajectory: trajectory ?? undefined },
          };
          break;
        }
      }
      return { ...g, pitches };
    });
    setContactFor(null);
    setContactTraj(null);
    flash(trajectory === "ground" ? "GROUND BALL" : "FLY BALL");
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
    const ok = await confirm({
      title: "End this game?",
      body: "It moves to history and can be reviewed anytime. You can't resume it.",
      confirmLabel: "End game",
      destructive: true,
    });
    if (!ok) return;
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

  // shared call to the relay API; mode "rec" = per-batter strategy
  const runInsight = async (
    summary: string,
    mode: "insight" | "rec",
    title: string,
    rerun: () => void
  ) => {
    insightRunRef.current = rerun;
    setInsightTitle(title);
    setInsightOpen(true);
    setInsightError(null);
    setInsightText(null);
    if (!summary.trim()) {
      setInsightError("Log some pitches first — nothing to analyze yet.");
      return;
    }
    setInsightLoading(true);
    try {
      const res = await fetch("/api/insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary, mode }),
      });
      const data = await res.json();
      if (!res.ok) setInsightError(data?.error ?? "Request failed.");
      else setInsightText(data.insight ?? "");
    } catch {
      setInsightError("Network error — check your connection.");
    } finally {
      setInsightLoading(false);
    }
  };

  const fetchInsight = () =>
    runInsight(
      buildInsightSummary(game),
      "insight",
      `INSIGHT · ${curPitcher?.name ?? "pitcher"}`,
      fetchInsight
    );

  // current pitcher's command trend (strike% by block) for the bottom graph
  const callTrend = useMemo(
    () =>
      analyzePitcherStatus(
        game.pitches.filter(
          (p) => (p.pitcherId ?? null) === game.pitcherId && p.outcome != null
        ),
        game.abResults
      ),
    [game.pitches, game.pitcherId, game.abResults]
  );

  // ── single-finger horizontal flick to move between views ──
  // One finger is far more reliable on iOS than multi-touch (which the OS
  // routes to its own zoom/scroll). We decide on touchend and never
  // preventDefault, so normal scrolling and pinch-zoom keep working.
  const swipeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = swipeRef.current;
    if (!el) return;
    let sx = 0;
    let sy = 0;
    let st = 0;
    let tracking = false;
    // don't hijack a flick that's really scrolling a horizontal strip/table
    const onHorizScroller = (node: EventTarget | null): boolean => {
      let n = node as HTMLElement | null;
      while (n && n !== el) {
        if (n.scrollWidth - n.clientWidth > 8) {
          const ox = getComputedStyle(n).overflowX;
          if (ox === "auto" || ox === "scroll") return true;
        }
        n = n.parentElement;
      }
      return false;
    };
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1 || onHorizScroller(e.target)) {
        tracking = false;
        return;
      }
      tracking = true;
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
      st = Date.now();
    };
    const end = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;
      const dt = Date.now() - st;
      // a real horizontal flick: far enough, mostly sideways, quick enough
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2 && dt < 700) {
        const dir = dx < 0 ? 1 : -1;
        setTab((cur) => {
          const i = VIEW_ORDER.indexOf(cur);
          const ni = (i + dir + VIEW_ORDER.length) % VIEW_ORDER.length;
          const next = VIEW_ORDER[ni];
          if (next !== cur) {
            setToast(next.toUpperCase());
            window.setTimeout(() => setToast(null), 1100);
          }
          return next;
        });
      }
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchend", end, { passive: true });
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchend", end);
    };
  }, [game.currentBatterId]);

  const changePitcher = (pitcherId: string) => {
    setPickingPitcher(false);
    if (pitcherId === game.pitcherId) return;
    const p = availablePitchers.find((x) => x.id === pitcherId);
    setGame((g) => {
      // fold a newly-brought-in pitcher into the game so her repertoire,
      // colors and stats resolve — batters and the pitch log are untouched.
      const inGame = g.pitchers.some((x) => x.id === pitcherId);
      const pitchers = inGame || !p ? g.pitchers : [...g.pitchers, p];
      return { ...g, pitchers, pitcherId, pending: {} };
    });
    if (p) flash(`Now pitching: ${p.name}${p.number ? ` #${p.number}` : ""}`);
  };

  if (!loaded) {
    return (
      <div className="mx-auto w-full max-w-[480px] px-4 pt-4">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-lg font-bold tracking-wide">
            PITCH
            <span className="text-amber-600 dark:text-amber-400">CALL</span>
          </div>
          <Skeleton className="size-9" />
        </div>
        <Skeleton className="mb-2.5 h-12" />
        <Skeleton className="mb-2.5 h-20" />
        <div className="mb-2.5 grid grid-cols-3 gap-1.5">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
        <Skeleton className="mb-3.5 h-16" />
        <Skeleton className="h-36" />
        <div className="sr-only" role="status">
          Loading game…
        </div>
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
    <div
      ref={swipeRef}
      className="relative mx-auto w-full max-w-[480px] pb-24 font-sans md:max-w-[900px]"
    >
      {/* header — top padding clears the iPad status bar in standalone PWA */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/90 px-3.5 pb-3 [padding-top:calc(env(safe-area-inset-top,0px)+0.75rem)] backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <div className="brand-glow text-lg font-extrabold uppercase tracking-[0.14em]">
            PITCH
            <span className="text-primary">CALL</span>
          </div>
          <span
            aria-label={online ? "Online — synced" : "Offline — saved on this device"}
            title={online ? "Synced" : "Offline — saved on this device"}
            className={cn(
              "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wider",
              online
                ? "border-green-500/40 text-green-600 dark:text-green-400"
                : "border-amber-500/50 text-amber-600 dark:text-amber-400"
            )}
          >
            <span
              aria-hidden
              className={cn(
                "size-1.5 rounded-full",
                online ? "bg-green-500" : "bg-amber-500"
              )}
            />
            {online ? "SAVED" : "OFFLINE"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard"
            aria-label="Pitcher dashboard"
            className="press rounded-lg border p-2 text-muted-foreground hover:bg-accent"
          >
            <BarChart3 className="size-4" />
          </Link>
          <Link
            href="/history"
            aria-label="History & scouting"
            className="press rounded-lg border p-2 text-muted-foreground hover:bg-accent"
          >
            <History className="size-4" />
          </Link>
          <Link
            href="/team"
            aria-label="Coach setup"
            className="press rounded-lg border p-2 text-muted-foreground hover:bg-accent"
          >
            <Users className="size-4" />
          </Link>
          <ThemeToggle />
          <button
            onClick={() => setShowSetup(true)}
            className="press rounded-lg border px-2.5 py-2 text-xs font-bold tracking-widest text-muted-foreground hover:bg-accent"
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
            className="press rounded-lg border p-2 text-muted-foreground hover:bg-accent"
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
            className="press flex shrink-0 items-center gap-1 rounded-lg border px-2 py-2 text-xs font-bold tracking-wide text-muted-foreground hover:border-red-500/60 hover:bg-accent hover:text-red-600 dark:hover:text-red-400"
          >
            <StopCircle className="size-3.5" />
            END
          </button>
        )}
        <button
          onClick={fetchInsight}
          className="press flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-500 bg-amber-500/10 px-2.5 py-2 text-sm font-bold text-amber-600 hover:bg-amber-500/20 dark:text-amber-400"
        >
          <Sparkles className="size-3.5" />
          INSIGHT
        </button>
        <button
          onClick={() =>
            availablePitchers.length > 1
              ? setPickingPitcher((v) => !v)
              : undefined
          }
          disabled={availablePitchers.length <= 1}
          aria-expanded={pickingPitcher}
          aria-label="Change pitcher"
          className={cn(
            "press flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-2 text-sm font-bold disabled:opacity-60",
            pickingPitcher
              ? "border-primary text-primary"
              : "border-border hover:bg-accent"
          )}
        >
          {availablePitchers.length > 1 && <RefreshCw className="size-3.5" />}
          P: {curPitcher ? curPitcher.name : "—"}
        </button>
      </div>

      {/* mid-game pitcher switch (current batter, count and log untouched) */}
      {pickingPitcher && (
        <div className="border-b px-3.5 py-2.5">
          <div className="mb-1.5 text-[11px] font-bold tracking-widest text-muted-foreground">
            BRING IN
          </div>
          <div className="flex flex-wrap gap-1.5">
            {availablePitchers.map((p) => {
              const on = p.id === game.pitcherId;
              return (
                <button
                  key={p.id}
                  onClick={() => changePitcher(p.id)}
                  aria-pressed={on}
                  className={cn(
                    "press rounded-2xl border px-3.5 py-2 text-sm font-bold",
                    on
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border hover:bg-accent"
                  )}
                >
                  {p.number && (
                    <span className="scoreboard mr-1 font-mono">#{p.number}</span>
                  )}
                  {p.name}
                  {on && (
                    <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                      in
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* view switcher — one big view at a time; 3-finger swipe also moves */}
      <div className="flex items-center gap-1.5 px-3.5 pb-1 pt-2.5">
        {(
          [
            ["call", "CALL"],
            ["game", "GAME"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            aria-pressed={tab === k}
            className={cn(
              "press flex-1 rounded-xl border py-2.5 text-sm font-bold tracking-widest transition-colors",
              tab === k
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:bg-accent"
            )}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="px-3.5 pb-1 text-center text-[10px] tracking-widest text-muted-foreground/70">
        swipe left or right to change view · or tap a label above
      </div>

      {/* one full-size view at a time */}
      <div className="px-1 pt-1 md:px-2">
        <section className={cn(tab !== "call" && "hidden")}>
        <div className="px-3.5 py-2">
          {/* Row 1: count · relay */}
          <div className="mb-2.5 grid grid-cols-2 gap-2">
            <div className="flex flex-col items-center justify-center rounded-2xl border bg-card px-2 py-2">
              <div className="text-[10px] tracking-widest text-muted-foreground">
                COUNT
              </div>
              {/* pressure cues: 3 balls = walk risk, 2 strikes = put-away time */}
              <div className="tnum scoreboard font-mono text-5xl font-extrabold leading-none">
                <span
                  className={cn(
                    game.count.b >= 3
                      ? "text-red-600 dark:text-red-400"
                      : "text-amber-600 dark:text-amber-400"
                  )}
                >
                  {game.count.b}
                </span>
                <span className="text-muted-foreground/70">-</span>
                <span
                  className={cn(
                    game.count.s >= 2
                      ? "text-green-600 dark:text-green-400"
                      : "text-amber-600 dark:text-amber-400"
                  )}
                >
                  {game.count.s}
                </span>
              </div>
            </div>

            {/* relay code — the tile lights up SOLID once pitch + location
                are both set, so a complete call is unmistakable */}
            <button
              onClick={rerollCall}
              disabled={game.pending.type == null || game.pending.zone == null}
              aria-label="Relay code — tap to redraw"
              title="Tap to redraw a code for the same call"
              className={cn(
                "press flex flex-col items-center justify-center rounded-2xl border-2 px-2 py-2 transition-colors",
                game.pending.type != null && game.pending.zone != null
                  ? game.pending.call
                    ? "border-amber-500 bg-amber-500 text-black"
                    : "border-red-500 bg-red-500/15"
                  : "border-border bg-card"
              )}
            >
              <div
                className={cn(
                  "text-[10px] tracking-widest",
                  game.pending.type != null &&
                    game.pending.zone != null &&
                    game.pending.call
                    ? "text-black/70"
                    : "text-muted-foreground"
                )}
              >
                RELAY
              </div>
              {game.pending.type != null && game.pending.zone != null ? (
                game.pending.call ? (
                  <span className="animate-pop font-mono text-4xl font-extrabold leading-none tracking-[0.1em] text-black">
                    {game.pending.call}
                  </span>
                ) : (
                  <span className="py-2 text-sm font-bold text-red-600 dark:text-red-400">
                    NOT ON CARD
                  </span>
                )
              ) : (
                <span className="py-1.5 font-mono text-3xl font-extrabold leading-none tracking-[0.2em] text-muted-foreground/25">
                  ···
                </span>
              )}
            </button>
          </div>

          {/* workload */}
          <div className="mb-3 flex items-center justify-center gap-3 text-[11px] font-medium tracking-wide text-muted-foreground">
            <span className="tnum">
              <span className="font-bold text-foreground">
                {pitcherStats.total}
              </span>{" "}
              P
            </span>
            <span aria-hidden className="opacity-40">
              ·
            </span>
            <span className="tnum">
              <span className="font-bold text-foreground">
                {pitcherStats.strikePct != null
                  ? `${pitcherStats.strikePct}%`
                  : "—"}
              </span>{" "}
              STR
            </span>
            <span aria-hidden className="opacity-40">
              ·
            </span>
            <span className="tnum">
              <span className="font-bold text-foreground">
                {pitcherStats.fpsPct != null ? `${pitcherStats.fpsPct}%` : "—"}
              </span>{" "}
              1ST-K
            </span>
          </div>

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
                  aria-pressed={on}
                  aria-label={p.name}
                  className="press rounded-2xl border-2 py-5 text-2xl font-extrabold transition-all"
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
              // when a pitch is also selected, the chosen location takes on
              // the pitch's color — a clear cue the two are locked together
              const pc = game.pending.type
                ? repertoire.find((p) => p.k === game.pending.type)?.c
                : undefined;
              return (
                <button
                  key={i}
                  onClick={() => pickZone(i)}
                  aria-pressed={on}
                  aria-label={ZONES[i]}
                  className={cn(
                    "press rounded-2xl border-2 py-9 text-base font-bold uppercase tracking-wide",
                    on
                      ? pc
                        ? ""
                        : "border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      : "border-border bg-card text-foreground/80 hover:brightness-110"
                  )}
                  style={
                    on && pc
                      ? { borderColor: pc, background: pc, color: "#0a0c10" }
                      : undefined
                  }
                >
                  {ZONES[i]}
                </button>
              );
            })}
          </div>

          {/* outcome — grouped by what the bat did: no swing | swing */}
          <div className="mx-0.5 mb-1.5 mt-0.5 flex items-center justify-between text-xs tracking-widest">
            <span
              className={cn(
                "font-bold",
                game.pending.type != null && game.pending.zone != null
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground"
              )}
            >
              ③ RESULT
            </span>
            {game.pending.type != null && game.pending.zone != null ? (
              <span className="animate-pulse font-extrabold text-amber-600 dark:text-amber-400">
                ↓ TAP THE RESULT
              </span>
            ) : (
              <span className="text-muted-foreground opacity-60">
                no swing · swing
              </span>
            )}
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
                  tone={o}
                  armed={
                    game.pending.type != null && game.pending.zone != null
                  }
                  disabled={false}
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
                  tone={o}
                  armed={
                    game.pending.type != null && game.pending.zone != null
                  }
                  disabled={false}
                  onTap={() => outcome(o)}
                />
              ))}
            </div>
          </div>

          {/* undo — recover a mis-tap fast */}
          <button
            onClick={undoLast}
            disabled={!game.pitches.length}
            className="press mt-3 w-full rounded-2xl border py-2.5 text-xs font-bold tracking-widest text-muted-foreground hover:bg-accent disabled:opacity-30"
          >
            ⌫ UNDO LAST PITCH
          </button>

          {/* command trend — strike% by block as a bar graph, hard-contact under */}
          {callTrend.blocks.length > 1 && (
            <div className="mt-4">
              <div className="mb-1.5 text-xs tracking-widest text-muted-foreground">
                COMMAND TREND · strike% by block
              </div>
              {/* bars: direct children of a fixed-height, bottom-aligned row */}
              <div className="flex h-32 items-end gap-1.5 rounded-xl border bg-card/40 px-2 pb-2 pt-5">
                {callTrend.blocks.map((b, i) => (
                  <div
                    key={i}
                    className="relative flex-1 rounded-t-md"
                    style={{
                      height: `${Math.max(b.strikePct, 2)}%`,
                      background:
                        b.strikePct >= 60
                          ? "#36d67a"
                          : b.strikePct >= 45
                            ? "var(--primary)"
                            : "#ff5a3c",
                    }}
                    title={`pitches ${b.label}: ${b.strikePct}% strikes, ${b.hard} hard`}
                  >
                    <span className="tnum absolute -top-4 left-1/2 -translate-x-1/2 font-mono text-[10px] font-bold text-muted-foreground">
                      {b.strikePct}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-1 flex gap-1.5 px-2">
                {callTrend.blocks.map((b, i) => (
                  <div
                    key={i}
                    className="flex-1 text-center font-mono text-[11px] text-red-600/80 dark:text-red-400/80"
                  >
                    {b.hard > 0 ? `●${b.hard}` : ""}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        </section>

        <section className={cn(tab !== "game" && "hidden")}>
          <div className="hidden px-3.5 pt-3 text-xs font-bold tracking-widest text-muted-foreground md:block">
            GAME TENDENCIES
          </div>
          <GameView game={game} defs={defMap} />
        </section>
      </div>

      {showSetup && (
        <NewGameSetup
          onStart={startGame}
          onCancel={() => setShowSetup(false)}
        />
      )}

      {/* AI insight panel */}
      {insightOpen && (
        <div className="animate-overlay-in fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-background/85 p-4 pt-10 backdrop-blur-sm">
          <div className="animate-sheet-in w-full max-w-[460px] rounded-xl border bg-card p-4">
            <div className="mb-2.5 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-sm font-bold tracking-widest text-amber-600 dark:text-amber-400">
                <Sparkles className="size-4" />
                {insightTitle}
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
                onClick={() => insightRunRef.current()}
                className="mt-3 w-full rounded-lg border py-2 text-xs font-bold tracking-widest text-muted-foreground hover:bg-accent"
              >
                ↻ RE-RUN
              </button>
            )}
            <div className="mt-2 text-center text-[10px] text-muted-foreground/75">
              AI-generated — your read overrules it.
            </div>
          </div>
        </div>
      )}

      {/* ball in play — ground/fly, then tap where it landed */}
      {contactFor && (
        <div className="animate-overlay-in fixed inset-0 z-30 flex items-center justify-center overflow-y-auto bg-background/80 p-4 backdrop-blur-sm">
          <div className="animate-sheet-in my-auto w-full max-w-[640px] rounded-2xl border bg-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-bold tracking-widest text-amber-600 dark:text-amber-400">
                BALL IN PLAY
              </div>
              <button
                onClick={() => setContactFor(null)}
                className="rounded-lg border px-2 py-1 text-[11px] tracking-widest text-muted-foreground hover:bg-accent"
              >
                SKIP
              </button>
            </div>

            {/* ground ball or fly ball */}
            <div className="mb-3 grid grid-cols-2 gap-2">
              {(
                [
                  ["ground", "GROUND BALL"],
                  ["fly", "FLY BALL"],
                ] as const
              ).map(([t, label]) => (
                <button
                  key={t}
                  onClick={() => setContactTraj(t)}
                  aria-pressed={contactTraj === t}
                  className={cn(
                    "press rounded-2xl border-2 py-5 text-base font-extrabold tracking-wide",
                    contactTraj === t
                      ? "border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      : "border-border text-muted-foreground hover:bg-accent"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div
              className={cn(
                "mx-auto max-w-[560px] rounded-2xl border-2",
                contactTraj
                  ? "border-amber-500"
                  : "pointer-events-none opacity-40"
              )}
            >
              <FieldChart className="w-full" onTap={(x, y) => tagContact(x, y)} />
            </div>
            <div className="mt-3 text-center text-sm text-muted-foreground">
              {contactTraj
                ? "tap the field where the ball was hit"
                : "pick ground or fly, then tap the field"}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="animate-pop fixed bottom-6 left-1/2 z-20 -translate-x-1/2 rounded-full bg-amber-500 px-4 py-2 text-[15px] font-bold tracking-wide text-black shadow-lg"
        >
          {toast}
        </div>
      )}

      {confirmDialog}
    </div>
  );
}

/**
 * Outcome colors mirror the app's semantics everywhere else:
 * red = contact/danger, blue = swing-and-miss, green = strike for us.
 */
const RESULT_TONE: Record<string, string> = {
  ball: "text-muted-foreground",
  called: "text-green-600 dark:text-green-400",
  miss: "text-blue-600 dark:text-blue-400",
  foul: "text-card-foreground/70",
  inplay: "text-red-600 dark:text-red-400",
};

function ResultButton({
  label,
  tone,
  armed,
  disabled,
  onTap,
}: {
  label: string;
  tone: string;
  armed: boolean;
  disabled: boolean;
  onTap: () => void;
}) {
  return (
    <button
      onClick={onTap}
      disabled={disabled}
      className={cn(
        "press rounded-2xl border-2 bg-card py-6 text-sm font-extrabold tracking-wide hover:bg-accent disabled:opacity-40",
        RESULT_TONE[tone] ?? "text-card-foreground",
        armed
          ? "border-amber-500 animate-pulse-glow"
          : "border-border opacity-70"
      )}
    >
      {label}
    </button>
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

  // per-pitcher status: tiring (command) + on her (contact), this game
  const statuses = useMemo(() => {
    const byP = new Map<string, Pitch[]>();
    for (const p of pitches) {
      if (p.outcome == null) continue;
      const k = p.pitcherId ?? "unknown";
      const arr = byP.get(k) ?? [];
      arr.push(p);
      byP.set(k, arr);
    }
    return [...byP.entries()]
      .map(([pid, ps]) => ({
        pid,
        name: game.pitchers.find((pp) => pp.id === pid)?.name ?? "Pitcher",
        status: analyzePitcherStatus(ps, game.abResults),
      }))
      .sort((a, b) => b.status.total - a.status.total);
  }, [pitches, game.pitchers, game.abResults]);

  return (
    <div className="px-3.5 py-2">
      {/* pitcher filter — tendencies are pitcher-specific */}
      {game.pitchers.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <button
            onClick={() => setFilter("all")}
            className={cn(
              "press rounded-2xl border px-3 py-1.5 text-xs font-bold tracking-widest",
              filter === "all"
                ? "border-primary bg-primary/15 text-primary"
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
                "press rounded-2xl border px-3 py-1.5 text-xs font-bold",
                filter === p.id
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:bg-accent"
              )}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {!total ? (
        <div className="p-5 text-muted-foreground/75">
          {filter === "all"
            ? "Log some pitches to see tendencies."
            : "No pitches from this pitcher yet."}
        </div>
      ) : (
        <>
          {statuses.length > 0 && (
            <div className="mb-4 flex flex-col gap-2.5">
              {statuses.map((s) => (
                <PitcherStatusPanel key={s.pid} name={s.name} status={s.status} />
              ))}
            </div>
          )}

          {teamSpray.length > 0 && (
            <div className="mb-3.5 rounded-2xl border bg-card p-3">
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
          <div className="mb-1.5 flex h-[30px] overflow-hidden rounded-2xl">
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
                  className="flex items-center gap-2.5 rounded-2xl border bg-card px-3 py-2.5"
                >
                  <div className="scoreboard w-[46px] font-mono text-xl font-extrabold text-primary">
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
          <div className="mt-3 font-mono text-[11px] leading-relaxed text-muted-foreground/75">
            Cells under 5 pitches are flagged red — they&apos;re too thin to
            read as a tendency. This view pools all batters; per-batter
            patterns live in the BATTER tab as sequence, not percentages.
          </div>

          <div className="mx-0.5 mb-2 mt-5 text-xs tracking-widest text-muted-foreground">
            SEQUENCING <span className="opacity-60">· what finishes hitters</span>
          </div>
          <SequencingView
            pitches={pitches}
            abResults={game.abResults}
            defs={defs}
          />
        </>
      )}
    </div>
  );
}
