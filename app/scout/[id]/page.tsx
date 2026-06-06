"use client";

import { use, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import GameReview from "@/components/game-review";
import { listTeamGames, listTeams } from "@/lib/supabase/sync";
import type { AbResult, Batter, Pitch, Pitcher } from "@/lib/types";

const emptySubscribe = () => () => {};

export default function ScoutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
  const [teamName, setTeamName] = useState<string | null>(null);
  const [gameCount, setGameCount] = useState(0);
  const [pitchers, setPitchers] = useState<Pitcher[]>([]);
  const [batters, setBatters] = useState<Batter[]>([]);
  const [pitches, setPitches] = useState<Pitch[]>([]);
  const [abResults, setAbResults] = useState<AbResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    Promise.all([listTeamGames(id), listTeams()]).then(([games, teams]) => {
      if (!live) return;
      setTeamName(teams.find((t) => t.id === id)?.name ?? "Team");
      setGameCount(games.length);

      // pool everything across all games; namespace each game's at-bat
      // numbers so put-away matching (ab → result) stays game-aligned
      const pMap = new Map<string, Pitcher>();
      const allBatters: Batter[] = [];
      const allPitches: Pitch[] = [];
      const allResults: AbResult[] = [];
      games.forEach((g, gi) => {
        const s = g.state;
        if (!s) return;
        const base = gi * 100000;
        (s.pitchers ?? []).forEach((p) => pMap.set(p.id, p));
        (s.batters ?? []).forEach((b) => allBatters.push(b));
        (s.pitches ?? []).forEach((p) =>
          allPitches.push({ ...p, ab: p.ab + base })
        );
        (s.abResults ?? []).forEach((r) =>
          allResults.push({ ...r, ab: r.ab + base })
        );
      });
      setPitchers([...pMap.values()]);
      setBatters(allBatters);
      setPitches(allPitches);
      setAbResults(allResults);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [id]);

  if (!mounted) return null;

  return (
    <div className="mx-auto w-full max-w-[680px] pb-24 font-sans">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-3.5 py-3">
        <div className="flex items-center gap-2">
          <Link
            href="/history"
            aria-label="Back to history"
            className="rounded-lg border p-1.5 text-muted-foreground hover:bg-accent"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="text-lg font-bold tracking-wide">
            SCOUT · {teamName ?? "…"}
          </div>
        </div>
        <ThemeToggle />
      </div>

      <div className="px-3.5 py-3">
        {loading ? (
          <div className="p-6 text-center text-muted-foreground">loading…</div>
        ) : pitches.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No pitch data on file for this team yet.
          </div>
        ) : (
          <>
            <div className="mb-3 text-xs tracking-widest text-muted-foreground">
              POOLED ACROSS {gameCount} GAME{gameCount === 1 ? "" : "S"} · every
              batter&apos;s tendencies vs your staff
            </div>
            <GameReview
              pitchers={pitchers}
              batters={batters}
              pitches={pitches}
              abResults={abResults}
            />
          </>
        )}
      </div>
    </div>
  );
}
