"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ChevronRight, Circle, Dot, Trash2 } from "lucide-react";
import AppHeader, { Skeleton } from "@/components/app-header";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  deleteGame,
  deleteGamesForTeam,
  deleteTeam,
  listGames,
  listTeams,
  type GameRow,
} from "@/lib/supabase/sync";
import type { Team } from "@/lib/types";

const emptySubscribe = () => () => {};

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export default function HistoryPage() {
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
  const [games, setGames] = useState<GameRow[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const { confirm, dialog } = useConfirm();

  const removeGame = async (g: GameRow) => {
    const ok = await confirm({
      title: "Delete this game?",
      body: `vs ${g.opponent ?? "Unknown"} — removes the full pitch log permanently.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setGames((gs) => gs.filter((x) => x.id !== g.id));
    await deleteGame(g.id);
  };

  const removeTeam = async (t: Team) => {
    const n = games.filter((g) => g.teamId === t.id).length;
    const ok = await confirm({
      title: `Delete ${t.name}?`,
      body: `Removes this opponent, ${t.batters.length} scouted batters${
        n ? `, and ${n} game${n === 1 ? "" : "s"} vs them` : ""
      }. Permanent.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setGames((gs) => gs.filter((g) => g.teamId !== t.id));
    setTeams((ts) => ts.filter((x) => x.id !== t.id));
    await deleteGamesForTeam(t.id);
    await deleteTeam(t.id);
  };

  useEffect(() => {
    let live = true;
    Promise.all([listGames(), listTeams()]).then(([gs, ts]) => {
      if (!live) return;
      setGames(gs);
      setTeams(ts);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!mounted) return null;

  const teamsWithGames = teams.filter((t) =>
    games.some((g) => g.teamId === t.id)
  );

  return (
    <div className="mx-auto w-full max-w-[640px] pb-24 font-sans">
      <AppHeader title="HISTORY" accent="+SCOUT" />

      <div className="px-3.5 py-3">
        {loading ? (
          <div role="status" aria-label="Loading games" className="flex flex-col gap-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : games.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No games yet. Start one from the game screen — it&apos;ll appear here
            once played.
          </div>
        ) : (
          <>
            {/* scouting: teams you've faced */}
            {teamsWithGames.length > 0 && (
              <>
                <div className="mb-2 text-xs font-bold tracking-widest text-muted-foreground">
                  SCOUT A TEAM
                </div>
                <div className="mb-5 flex flex-col gap-2">
                  {teamsWithGames.map((t) => {
                    const n = games.filter((g) => g.teamId === t.id).length;
                    return (
                      <div
                        key={t.id}
                        className="flex items-center gap-1 rounded-2xl border bg-card pr-1.5 hover:bg-accent"
                      >
                        <Link
                          href={`/scout/${t.id}`}
                          className="flex flex-1 items-center gap-2 px-3.5 py-3"
                        >
                          <div className="flex-1">
                            <div className="font-bold">{t.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {n} game{n === 1 ? "" : "s"} · {t.batters.length}{" "}
                              batters on file
                            </div>
                          </div>
                          <ChevronRight className="size-4 text-muted-foreground" />
                        </Link>
                        <button
                          onClick={() => removeTeam(t)}
                          aria-label={`Delete opponent ${t.name}`}
                          className="press rounded-xl p-2.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* all games */}
            <div className="mb-2 text-xs font-bold tracking-widest text-muted-foreground">
              ALL GAMES
            </div>
            <div className="flex flex-col gap-2">
              {games.map((g) => (
                <div
                  key={g.id}
                  className="flex items-center gap-1 rounded-2xl border bg-card pr-1.5 hover:bg-accent"
                >
                  <Link
                    href={`/history/${g.id}`}
                    className="flex flex-1 items-center gap-2.5 px-3.5 py-3"
                  >
                    {g.status === "active" ? (
                      <Circle className="size-3 shrink-0 animate-pulse fill-amber-500 text-amber-500" />
                    ) : (
                      <Dot className="size-3 shrink-0 text-muted-foreground" />
                    )}
                    <div className="flex-1">
                      <div className="font-bold">
                        vs {g.opponent ?? "Unknown"}
                        {g.status === "active" && (
                          <span className="ml-2 text-xs font-bold tracking-widest text-amber-600 dark:text-amber-400">
                            LIVE
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {fmtDate(g.startedAt)}
                      </div>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </Link>
                  <button
                    onClick={() => removeGame(g)}
                    aria-label="Delete game"
                    className="press rounded-xl p-2.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
        {dialog}
      </div>
    </div>
  );
}
