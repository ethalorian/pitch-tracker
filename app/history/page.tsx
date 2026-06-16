"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ChevronRight, Circle, Dot } from "lucide-react";
import AppHeader, { Skeleton } from "@/components/app-header";
import { listGames, listTeams, type GameRow } from "@/lib/supabase/sync";
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
                      <Link
                        key={t.id}
                        href={`/scout/${t.id}`}
                        className="flex items-center gap-2 rounded-2xl border bg-card px-3.5 py-3 hover:bg-accent"
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
                <Link
                  key={g.id}
                  href={`/history/${g.id}`}
                  className="flex items-center gap-2.5 rounded-2xl border bg-card px-3.5 py-3 hover:bg-accent"
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
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
