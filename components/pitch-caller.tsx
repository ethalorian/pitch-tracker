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
  ChevronDown,
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
import { STANDARD_PITCHES, pitchDef, type PitchDef } from "@/lib/catalog";
import {
  DEFAULT_CARD_BUCKETS,
  randomCall,
  type CallCardBuckets,
} from "@/lib/callsheet";
import { buildInsightSummary, buildBatterRecSummary } from "@/lib/insight";
import FieldChart, { type SprayMarker } from "@/components/field-chart";
import SequencingView from "@/components/sequencing-view";
import LineupPanel from "@/components/lineup-panel";
import PitcherStatusPanel from "@/components/pitcher-status";
import { analyzePitcherStatus } from "@/lib/pitcher-status";
import SituationBar from "@/components/situation-bar";
import { basesMask, situationCue } from "@/lib/situation";
import {
  EMPTY_GAME,
  EMPTY_SITUATION,
  TRAJ_LABEL,
  ZONES,
  swingOf,
  uid,
  type Batter,
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

/** Swipe order for the three views (single-finger horizontal flick). */
const VIEW_ORDER = ["call", "batter", "game"] as const;

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
  const [tab, setTab] = useState<"call" | "batter" | "game">("call");
  const [viewBatter, setViewBatter] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [showLineup, setShowLineup] = useState(false); // heads-up: lineup tucked away
  const [online, setOnline] = useState(true); // trust indicator; data always saved locally
  const [roster, setRoster] = useState<Pitcher[]>([]); // live staff for mid-game changes
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
  const [contactResult, setContactResult] = useState<
    "out" | "hit" | "reach" | null
  >(null);
  const [contactErrorPos, setContactErrorPos] = useState<string | null>(null);
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
  const curBatter =
    game.batters.find((b) => b.id === game.currentBatterId) ?? null;
  const curIdxLive = game.batters.findIndex(
    (b) => b.id === game.currentBatterId
  );
  const onDeckBatter =
    game.batters.length > 1 && curIdxLive >= 0
      ? game.batters[(curIdxLive + 1) % game.batters.length]
      : null;
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

  // Decision SUPPORT, not prescription: surface where THIS hitter is cold
  // (swings through) and hot (squares up) — but stay quiet until the read is
  // real. We never tell the coach what to throw; we arm her own read.
  const READ_MIN_SWINGS = 3; // total swing events before we say anything
  const COMBO_MIN = 2; // a single combo needs this many to be "real"
  const advice = useMemo(() => {
    const list = Object.values(batterHeat.combos);
    const totalSwings = list.reduce((n, c) => n + c.contact + c.miss, 0);

    // per-pitch-type net signal vs this batter (summed across zones)
    const byType: Record<
      string,
      { type: string; miss: number; contact: number }
    > = {};
    for (const c of list) {
      const t = (byType[c.type] = byType[c.type] ?? {
        type: c.type,
        miss: 0,
        contact: 0,
      });
      t.miss += c.miss;
      t.contact += c.contact;
    }

    // cold = strongest swing-and-miss combo; hot = strongest hard-contact combo
    let cold: (typeof list)[number] | null = null;
    let hot: (typeof list)[number] | null = null;
    for (const c of list) {
      if (
        c.miss >= COMBO_MIN &&
        c.miss > c.contact &&
        (!cold || c.miss - c.contact > cold.miss - cold.contact)
      )
        cold = c;
      if (
        c.contact >= COMBO_MIN &&
        c.contact > c.miss &&
        (!hot || c.contact > hot.contact)
      )
        hot = c;
    }

    return { byType, cold, hot, totalSwings, hasRead: totalSwings >= READ_MIN_SWINGS };
  }, [batterHeat]);

  /** Per-pitch glance signal for the arsenal buttons, only when real. */
  const pitchSignal = (
    k: string
  ): { tone: "cold" | "hot"; n: number } | null => {
    const t = advice.byType[k];
    if (!t) return null;
    if (t.miss + t.contact < COMBO_MIN) return null;
    if (t.miss > t.contact) return { tone: "cold", n: t.miss };
    if (t.contact > t.miss) return { tone: "hot", n: t.contact };
    return null;
  };

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

  /** zone read for the corner glyph: hard contact (●) vs whiffs (○). */
  const zoneRead = (
    zone: number
  ): { tone: "cold" | "hot"; n: number } | null => {
    const h = batterHeat.zones[zone];
    if (!h) return null;
    if (h.contact >= h.miss && h.contact > 0) return { tone: "hot", n: h.contact };
    if (h.miss > 0) return { tone: "cold", n: h.miss };
    return null;
  };

  /* ── actions ── */
  // bring a hitter up: starts a fresh AB unless she's already up mid-count
  const bringUp = (batterId: string) =>
    setGame((g) => {
      if (batterId === g.currentBatterId && !g.abOver) return g;
      return {
        ...g,
        currentBatterId: batterId,
        currentAb: g.abCounter + 1,
        abCounter: g.abCounter + 1,
        count: { b: 0, s: 0 },
        pending: {},
        abOver: false,
      };
    });

  const addLineupBatter = (jersey: string, hand: Hand, name: string) => {
    const j = jersey.trim();
    if (!j) return;
    setGame((g) => {
      if (g.batters.some((b) => b.jersey === j)) return g; // no dup jersey
      const nb = { id: uid(), jersey: j, hand, name: name.trim() || undefined };
      const batters = [...g.batters, nb];
      // first hitter added becomes the one at bat
      if (!g.currentBatterId) {
        return {
          ...g,
          batters,
          currentBatterId: nb.id,
          currentAb: g.abCounter + 1,
          abCounter: g.abCounter + 1,
          count: { b: 0, s: 0 },
          abOver: false,
        };
      }
      return { ...g, batters };
    });
  };

  const removeBatter = (id: string) =>
    setGame((g) => ({
      ...g,
      batters: g.batters.filter((b) => b.id !== id),
      currentBatterId: g.currentBatterId === id ? null : g.currentBatterId,
    }));

  const moveBatter = (id: string, dir: -1 | 1) =>
    setGame((g) => {
      const i = g.batters.findIndex((b) => b.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= g.batters.length) return g;
      const batters = [...g.batters];
      [batters[i], batters[j]] = [batters[j], batters[i]];
      return { ...g, batters };
    });

  const editBatter = (id: string, patch: Partial<Batter>) =>
    setGame((g) => ({
      ...g,
      batters: g.batters.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }));

  const toggleAuto = () =>
    setGame((g) => ({ ...g, autoAdvance: !g.autoAdvance }));

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
    const curIdx = game.batters.findIndex(
      (b) => b.id === game.currentBatterId
    );
    const nextBatter =
      game.batters.length > 1 && curIdx >= 0
        ? game.batters[(curIdx + 1) % game.batters.length]
        : null;
    // follow the explicit batting order; the coach can switch AUTO off
    const autoAdvance = willEnd != null && game.autoAdvance && nextBatter != null;
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
        outs: (g.situation ?? EMPTY_SITUATION).outs,
        bases: basesMask(g.situation),
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
      // AB is over — dead time. Ask hard/weak, trajectory, out/hit, and where.
      setContactQuality(null);
      setContactTraj(null);
      setContactResult(null);
      setContactErrorPos(null);
      setContactFor("last");
    }
  };

  const tagContact = (
    quality: ContactQuality,
    trajectory: Trajectory,
    x: number,
    y: number
  ) => {
    const result = contactResult;
    setGame((g) => {
      const pitches = [...g.pitches];
      for (let i = pitches.length - 1; i >= 0; i--) {
        if (pitches[i].outcome === "inplay") {
          pitches[i] = {
            ...pitches[i],
            contact: {
              quality,
              trajectory,
              x,
              y,
              result: result ?? undefined,
              errorBy:
                result === "reach" && contactErrorPos
                  ? contactErrorPos
                  : undefined,
            },
          };
          break;
        }
      }
      // an out auto-advances the count of outs; the 3rd out flips the half
      let situation = g.situation ?? EMPTY_SITUATION;
      if (result === "out") {
        const nextOuts = situation.outs + 1;
        situation =
          nextOuts >= 3
            ? {
                ...situation,
                outs: 0,
                on1: false,
                on2: false,
                on3: false,
                half: situation.half === "top" ? "bottom" : "top",
                inning:
                  situation.half === "top"
                    ? situation.inning
                    : situation.inning + 1,
              }
            : { ...situation, outs: nextOuts };
      }
      return { ...g, pitches, situation };
    });
    setContactFor(null);
    setContactQuality(null);
    setContactTraj(null);
    setContactResult(null);
    setContactErrorPos(null);
    const resTag =
      result === "out"
        ? " · OUT"
        : result === "hit"
          ? " · HIT"
          : result === "reach"
            ? ` · E${contactErrorPos ? "-" + contactErrorPos : ""}`
            : "";
    flash(`${quality.toUpperCase()} ${TRAJ_LABEL[trajectory]}${resTag}`);
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

  const fetchBatterRec = () => {
    if (!curBatter) return;
    runInsight(
      buildBatterRecSummary(game, curBatter.id),
      "rec",
      `STRATEGY · #${curBatter.jersey}`,
      fetchBatterRec
    );
  };

  // ── game situation: outs / runners / score / inning (coach-set) ──
  const situation = game.situation ?? EMPTY_SITUATION;
  const cue = situationCue(situation);
  // the batter-up's balls in play → ghost spray on the situation field
  const liveSpray = useMemo<SprayMarker[]>(
    () =>
      game.pitches
        .filter(
          (p) =>
            p.batterId === game.currentBatterId &&
            p.contact?.x != null &&
            p.contact?.y != null
        )
        .map((p) => ({
          x: p.contact!.x!,
          y: p.contact!.y!,
          quality: p.contact!.quality,
          trajectory: p.contact!.trajectory,
        })),
    [game.pitches, game.currentBatterId]
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

  // current batter's line this game, for the situation-card summary
  const curBatterSummary = useMemo(() => {
    if (!curBatter) return null;
    const mine = game.pitches.filter((p) => p.batterId === curBatter.id);
    const logged = mine.filter((p) => p.outcome != null);
    const res = game.abResults.filter((r) => r.batterId === curBatter.id);
    let hits = 0;
    let hard = 0;
    let whiff = 0;
    for (const p of logged) {
      if (p.contact?.result === "hit") hits++;
      if (p.contact?.quality === "hard") hard++;
      if (swingOf(p.outcome) === "miss") whiff++;
    }
    return {
      label: `#${curBatter.jersey} ${curBatter.hand}HH`,
      pa: new Set(mine.map((p) => p.ab)).size,
      seen: logged.length,
      k: res.filter((r) => r.result === "K").length,
      bb: res.filter((r) => r.result === "BB").length,
      ip: res.filter((r) => r.result === "IP").length,
      hits,
      hard,
      whiff,
    };
  }, [game.pitches, game.abResults, curBatter]);
  const setSituation = (patch: Partial<typeof situation>) =>
    setGame((g) => ({
      ...g,
      situation: { ...(g.situation ?? EMPTY_SITUATION), ...patch },
    }));
  const newHalf = () =>
    setGame((g) => {
      const s = g.situation ?? EMPTY_SITUATION;
      const toBottom = s.half === "top";
      return {
        ...g,
        situation: {
          ...s,
          outs: 0,
          on1: false,
          on2: false,
          on3: false,
          half: toBottom ? "bottom" : "top",
          inning: toBottom ? s.inning : s.inning + 1,
        },
      };
    });

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
            if (next === "batter")
              setViewBatter((v) => v ?? game.currentBatterId);
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
          {/* ── HEADS-UP: who's up + the count, oversized and unmissable.
              Lineup management and workload are demoted so the screen has
              one clear job per glance. ── */}
          {/* Row 1: at bat · count · relay */}
          <div className="mb-2.5 grid grid-cols-3 gap-2">
            <button
              onClick={() => setShowLineup((v) => !v)}
              aria-expanded={showLineup}
              aria-label="At bat — tap to open lineup"
              className="press flex flex-col justify-center rounded-2xl border bg-card px-3 py-2.5 text-left hover:bg-accent"
            >
              <div className="text-[10px] tracking-widest text-muted-foreground">
                AT BAT
              </div>
              <div className="flex items-baseline gap-1.5 leading-none">
                <span className="text-3xl font-extrabold leading-none">
                  {curBatter ? `#${curBatter.jersey}` : "—"}
                </span>
                {curBatter && (
                  <span className="text-sm font-bold text-muted-foreground">
                    {curBatter.hand}HH
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                <span>
                  {onDeckBatter ? `next #${onDeckBatter.jersey}` : "set lineup"}
                </span>
                <ChevronDown
                  className={cn(
                    "size-3 transition-transform",
                    showLineup && "rotate-180"
                  )}
                />
              </div>
            </button>

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

            {/* relay code you read aloud — tap to redraw */}
            <button
              onClick={rerollCall}
              disabled={game.pending.type == null || game.pending.zone == null}
              aria-label="Relay code — tap to redraw"
              title="Tap to redraw a code for the same call"
              className="press flex flex-col items-center justify-center rounded-2xl border bg-card px-2 py-2 hover:bg-accent disabled:hover:bg-card"
            >
              <div className="text-[10px] tracking-widest text-muted-foreground">
                RELAY
              </div>
              {game.pending.type != null && game.pending.zone != null ? (
                game.pending.call ? (
                  <span className="animate-pop font-mono text-4xl font-extrabold leading-none tracking-[0.1em] text-amber-600 dark:text-amber-400">
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

          {/* lineup management: tucked away, one tap from the hero */}
          {showLineup && (
            <div className="animate-sheet-in mb-2.5 rounded-xl border bg-card/60 p-2">
              <LineupPanel
                batters={game.batters}
                currentId={game.currentBatterId}
                autoAdvance={game.autoAdvance}
                onSelect={(id) => {
                  bringUp(id);
                  setShowLineup(false);
                }}
                onAdd={addLineupBatter}
                onRemove={removeBatter}
                onMove={moveBatter}
                onEdit={editBatter}
                onToggleAuto={toggleAuto}
              />
            </div>
          )}

          {/* THIS AT-BAT — color-coded squares (pitch type), count + spot inside */}
          <div className="mb-2.5">
            <div className="mb-1.5 flex items-center justify-between text-xs tracking-widest text-muted-foreground">
              <span>THIS AT-BAT</span>
              <button
                onClick={undoLast}
                disabled={!game.pitches.length}
                className="press rounded-lg border px-2.5 py-1.5 text-[11px] font-bold tracking-wide hover:bg-accent disabled:opacity-30"
              >
                ⌫ UNDO LAST
              </button>
            </div>
            <Strip pitches={curAbPitches} defs={defMap} />
          </div>

          {/* two columns: situation + intel (left) · the call input (right) */}
          <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
            <div className="flex flex-col gap-2.5">
          {/* game situation — prominent: outs / runners / score / inning */}
          <SituationBar
            s={situation}
            set={setSituation}
            newHalf={newHalf}
            spray={liveSpray}
            batter={curBatterSummary}
            onRecommend={curBatter ? fetchBatterRec : undefined}
          />

          {/* situational cue — flags the spot, never names the pitch */}
          {cue && (
            <div
              className={cn(
                "animate-pop mb-2.5 flex items-center gap-2 rounded-2xl border-2 px-3.5 py-2.5 text-sm font-bold leading-snug",
                cue.tone === "warn"
                  ? "border-red-500/60 bg-red-500/10 text-red-600 dark:text-red-400"
                  : cue.tone === "go"
                    ? "border-green-500/60 bg-green-500/10 text-green-600 dark:text-green-400"
                    : "border-primary/50 bg-primary/10 text-foreground"
              )}
            >
              {cue.text}
            </div>
          )}

          {/* workload: one quiet line, not three competing tiles */}
          <div className="mb-2.5 flex items-center justify-center gap-3 text-[11px] font-medium tracking-wide text-muted-foreground">
            <span className="tnum">
              <span className="font-bold text-foreground">
                {pitcherStats.total}
              </span>{" "}
              P
            </span>
            <span aria-hidden className="opacity-30">
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
            <span aria-hidden className="opacity-30">
              ·
            </span>
            <span className="tnum">
              <span className="font-bold text-foreground">
                {pitcherStats.fpsPct != null ? `${pitcherStats.fpsPct}%` : "—"}
              </span>{" "}
              1ST-K
            </span>
          </div>

          {game.abOver && (
            <div className="mb-2.5 flex items-center gap-2 rounded-xl border border-amber-500 bg-card px-3 py-2">
              <div className="flex-1 text-sm font-bold tracking-wide text-amber-600 dark:text-amber-400">
                AT-BAT ENDED
              </div>
              <button
                onClick={undoLast}
                className="press rounded-lg border px-2.5 py-2 text-xs font-bold tracking-wide text-muted-foreground hover:bg-accent"
              >
                UNDO
              </button>
              {onDeckBatter && (
                <button
                  onClick={() => bringUp(onDeckBatter.id)}
                  className="press rounded-lg bg-amber-500 px-4 py-2.5 text-base font-bold text-black hover:bg-amber-400"
                >
                  NEXT: #{onDeckBatter.jersey}
                </button>
              )}
            </div>
          )}

          {/* her read: factual signal, not a command — and silent until real.
              COLD = she swings through it (○ whiffs); HOT = she squares it
              up (● hard contact). You make the call. */}
          {curBatter && advice.hasRead && (advice.cold || advice.hot) && (
            <div className="animate-pop mb-2.5 flex h-9 items-center gap-3 overflow-x-auto whitespace-nowrap rounded-xl border bg-card px-3 font-mono text-xs">
              <span className="shrink-0 text-[10px] tracking-widest text-muted-foreground">
                READ
              </span>
              {advice.cold && (
                <span className="font-bold text-blue-600 dark:text-blue-400">
                  COLD {advice.cold.type}·
                  {ZONES[advice.cold.zone].toUpperCase()} ○{advice.cold.miss}
                </span>
              )}
              {advice.hot && (
                <span className="font-bold text-red-600 dark:text-red-400">
                  HOT {advice.hot.type}·
                  {ZONES[advice.hot.zone].toUpperCase()} ●{advice.hot.contact}
                </span>
              )}
            </div>
          )}
            </div>

            <div className="flex flex-col">
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
              const sig = on ? null : pitchSignal(p.k);
              return (
                <button
                  key={p.k}
                  onClick={() => pickType(p.k)}
                  aria-pressed={on}
                  aria-label={
                    sig
                      ? `${p.name}, batter ${
                          sig.tone === "cold" ? "whiffs" : "hits hard"
                        } ${sig.n}`
                      : p.name
                  }
                  className="press relative rounded-2xl border-2 py-5 text-2xl font-extrabold transition-all"
                  style={
                    on
                      ? { borderColor: p.c, background: p.c, color: "#0a0c10" }
                      : { borderColor: "var(--border)", color: p.c }
                  }
                >
                  {p.k}
                  {sig && (
                    <span
                      className={cn(
                        "tnum absolute right-1 top-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none",
                        sig.tone === "cold"
                          ? "bg-blue-500/20 text-blue-600 dark:text-blue-300"
                          : "bg-red-500/20 text-red-600 dark:text-red-300"
                      )}
                    >
                      {sig.tone === "cold" ? "○" : "●"}
                      {sig.n}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* location — four quadrants, no middle: you don't call meatballs */}
          <div className="mx-0.5 mb-1.5 mt-0.5 flex justify-between text-xs tracking-widest text-muted-foreground">
            <span>② LOCATION</span>
            {curBatter && advice.hasRead ? (
              <span className="flex items-center gap-2 opacity-80">
                <span className="text-blue-600 dark:text-blue-400">○ whiff</span>
                <span className="text-red-600 dark:text-red-400">● hard</span>
              </span>
            ) : (
              <span className="opacity-60">relative to batter</span>
            )}
          </div>
          <div className="mb-3.5 grid grid-cols-2 gap-1.5">
            {QUADRANTS.map((i) => {
              const on = game.pending.zone === i;
              const bg = on ? undefined : zoneBg(i);
              const zr = on ? null : zoneRead(i);
              return (
                <button
                  key={i}
                  onClick={() => pickZone(i)}
                  aria-pressed={on}
                  aria-label={
                    zr
                      ? `${ZONES[i]}, batter ${
                          zr.tone === "cold" ? "whiffs" : "hits hard"
                        } ${zr.n}`
                      : ZONES[i]
                  }
                  className={cn(
                    "press relative rounded-2xl border-2 py-9 text-base font-bold uppercase tracking-wide",
                    on
                      ? "border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      : "border-border bg-card text-foreground/80 hover:brightness-110"
                  )}
                  style={bg ? { background: bg } : undefined}
                >
                  {ZONES[i]}
                  {zr && (
                    <span
                      className={cn(
                        "tnum absolute right-1.5 top-1.5 text-[11px] font-bold leading-none",
                        zr.tone === "cold"
                          ? "text-blue-600 dark:text-blue-300"
                          : "text-red-600 dark:text-red-300"
                      )}
                    >
                      {zr.tone === "cold" ? "○" : "●"}
                      {zr.n}
                    </span>
                  )}
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
                  tone={o}
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
                  tone={o}
                  armed={
                    game.pending.type != null && game.pending.zone != null
                  }
                  disabled={!curBatter}
                  onTap={() => outcome(o)}
                />
              ))}
            </div>
          </div>
            </div>
          </div>

          {/* command trend — strike% by 15-pitch block, hard-contact under */}
          {callTrend.blocks.length > 1 && (
            <div className="mt-4">
              <div className="mb-1.5 text-xs tracking-widest text-muted-foreground">
                COMMAND TREND · strike% by block
              </div>
              <div className="flex items-end gap-1.5" style={{ height: 60 }}>
                {callTrend.blocks.map((b, i) => (
                  <div
                    key={i}
                    className="flex flex-1 flex-col items-center gap-1"
                    title={`pitches ${b.label}: ${b.strikePct}% strikes, ${b.hard} hard`}
                  >
                    <div className="flex w-full flex-1 items-end">
                      <div
                        className="w-full rounded-t-md"
                        style={{
                          height: `${Math.max(b.strikePct, 3)}%`,
                          background:
                            b.strikePct >= 60
                              ? "#36d67a"
                              : b.strikePct >= 45
                                ? "var(--primary)"
                                : "#ff5a3c",
                        }}
                      />
                    </div>
                    <div className="tnum scoreboard font-mono text-[11px] text-muted-foreground">
                      {b.strikePct}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-1 flex gap-1.5">
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

        <div>
          <section className={cn(tab !== "batter" && "hidden")}>
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

          <section className={cn(tab !== "game" && "hidden")}>
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

      {/* post-IN-PLAY contact detail: hard/weak + trajectory, then tap the field */}
      {contactFor && (
        <div className="animate-overlay-in fixed inset-0 z-30 flex items-center justify-center overflow-y-auto bg-background/80 p-4 backdrop-blur-sm">
          <div className="animate-sheet-in my-auto w-full max-w-[640px] rounded-2xl border bg-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-bold tracking-widest text-amber-600 dark:text-amber-400">
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

            <div className="mb-2 grid grid-cols-2 gap-2">
              {(["hard", "weak"] as const).map((q) => (
                <button
                  key={q}
                  onClick={() => setContactQuality(q)}
                  aria-pressed={contactQuality === q}
                  className={cn(
                    "press rounded-2xl border-2 py-4 text-lg font-extrabold tracking-wide",
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

            <div className="mb-3 grid grid-cols-3 gap-2">
              {(["ground", "line", "fly"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setContactTraj(t)}
                  aria-pressed={contactTraj === t}
                  className={cn(
                    "press rounded-2xl border-2 py-4 text-base font-bold tracking-wide",
                    contactTraj === t
                      ? "border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      : "border-border text-muted-foreground hover:bg-accent"
                  )}
                >
                  {TRAJ_LABEL[t]}
                </button>
              ))}
            </div>

            {/* out / hit / reached — an OUT auto-advances the outs count */}
            <div className="mb-3 grid grid-cols-3 gap-2">
              {(
                [
                  ["out", "OUT", "green"],
                  ["hit", "HIT", "red"],
                  ["reach", "REACH", "amber"],
                ] as const
              ).map(([r, label, tone]) => (
                <button
                  key={r}
                  onClick={() => setContactResult(r)}
                  aria-pressed={contactResult === r}
                  className={cn(
                    "press rounded-2xl border-2 py-4 text-base font-extrabold tracking-wide",
                    contactResult === r
                      ? tone === "green"
                        ? "border-green-500 bg-green-500/15 text-green-600 dark:text-green-400"
                        : tone === "red"
                          ? "border-red-500 bg-red-500/15 text-red-600 dark:text-red-400"
                          : "border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      : "border-border text-muted-foreground hover:bg-accent"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* on a reach, which fielder booted it */}
            {contactResult === "reach" && (
              <div className="mb-3">
                <div className="mb-1.5 text-[11px] font-bold tracking-widest text-muted-foreground">
                  ERROR BY
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"] as const
                  ).map((pos) => (
                    <button
                      key={pos}
                      onClick={() => setContactErrorPos(pos)}
                      aria-pressed={contactErrorPos === pos}
                      className={cn(
                        "press rounded-2xl border-2 py-3 text-base font-extrabold tracking-wide",
                        contactErrorPos === pos
                          ? "border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                          : "border-border text-muted-foreground hover:bg-accent"
                      )}
                    >
                      {pos}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div
              className={cn(
                "mx-auto max-w-[520px] rounded-2xl border-2",
                contactQuality && contactTraj && contactResult
                  ? "border-amber-500"
                  : "pointer-events-none opacity-40"
              )}
            >
              <FieldChart
                className="w-full"
                onTap={(x, y) =>
                  contactQuality &&
                  contactTraj &&
                  contactResult &&
                  tagContact(contactQuality, contactTraj, x, y)
                }
              />
            </div>
            <div className="mt-3 text-center text-sm text-muted-foreground">
              {contactQuality && contactTraj && contactResult
                ? "tap the field where it went"
                : "pick quality, type, and out/hit — then tap the field"}
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
        "press rounded-2xl border bg-card py-6 text-sm font-extrabold tracking-wide hover:bg-accent disabled:opacity-40",
        RESULT_TONE[tone] ?? "text-card-foreground",
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
      <div className="px-0.5 py-1.5 text-sm text-muted-foreground/75">
        no pitches yet
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {pitches.map((p) => {
        const d = pitchDef(defs, p.type);
        const sw = swingOf(p.outcome);
        return (
          <div
            key={p.id}
            title={`${d.name} · ${ZONES[p.zone]} · ${p.b}-${p.s} · ${p.outcome ?? ""}`}
            className="relative flex size-16 flex-col items-center justify-center rounded-lg"
            style={{ background: d.c, color: "#0a0c10" }}
          >
            {/* count + location inside; square color = pitch type */}
            <span className="tnum font-mono text-lg font-extrabold leading-none">
              {p.b}-{p.s}
            </span>
            <span className="mt-1 text-[10px] font-bold uppercase leading-none">
              {ZONES[p.zone]}
            </span>
            <span className="absolute bottom-1 left-1 text-[9px] font-extrabold leading-none opacity-70">
              {p.type}
            </span>
            {p.outcome && (
              <span
                className="absolute right-1 top-1 rounded px-1 text-[9px] font-extrabold leading-none"
                style={{
                  background: "rgba(10,12,16,0.82)",
                  color:
                    sw === "contact"
                      ? "#ff9a9a"
                      : sw === "miss"
                        ? "#a9cdff"
                        : "#e9e9e9",
                }}
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
                "press shrink-0 rounded-2xl border px-3.5 py-2 text-[15px] font-bold",
                on
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border bg-card text-card-foreground hover:bg-accent"
              )}
            >
              #{b.jersey}
            </button>
          );
        })}
      </div>

      {!batter ? (
        <div className="p-2.5 text-muted-foreground/75">
          No batter selected.
        </div>
      ) : (
        <>
          <div className="mb-1 flex items-baseline gap-2">
            <span className="scoreboard font-mono text-3xl font-extrabold leading-none">
              #{batter.jersey}
            </span>
            {batter.name && (
              <span className="text-lg font-bold leading-none">{batter.name}</span>
            )}
            <span className="text-sm text-muted-foreground">
              {batter.hand}HH · {mine.length} pitches · {abs.length} AB
            </span>
          </div>

          {(hits.length > 0 || whiffs.length > 0) && (
            <div className="mb-3.5 mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-red-500/60 bg-card px-3 py-2.5">
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
                  <div className="font-mono text-xs text-muted-foreground/75">
                    no contact yet
                  </div>
                )}
              </div>
              <div className="rounded-2xl border border-blue-500/60 bg-card px-3 py-2.5">
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
                  <div className="font-mono text-xs text-muted-foreground/75">
                    no whiffs yet
                  </div>
                )}
              </div>
            </div>
          )}

          {sprayMarkers.length > 0 && (
            <div className="mb-3.5 rounded-2xl border bg-card p-3">
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
