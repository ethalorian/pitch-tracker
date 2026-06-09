"use client";

import { use, useEffect, useState, useSyncExternalStore } from "react";
import AppHeader, { Skeleton } from "@/components/app-header";
import GameReview from "@/components/game-review";
import { getGame, type GameRow } from "@/lib/supabase/sync";

const emptySubscribe = () => () => {};

export default function GameDetailPage({
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
  const [row, setRow] = useState<GameRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    getGame(id).then((g) => {
      if (!live) return;
      setRow(g);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [id]);

  if (!mounted) return null;
  const s = row?.state;

  return (
    <div className="mx-auto w-full max-w-[680px] pb-24 font-sans">
      <AppHeader
        backHref="/history"
        backLabel="Back to history"
        title={`vs ${row?.opponent ?? "Game"}`}
      />

      <div className="px-3.5 py-3">
        {loading ? (
          <div role="status" aria-label="Loading game" className="flex flex-col gap-2">
            <div className="grid grid-cols-3 gap-1.5">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
            <Skeleton className="h-44" />
            <Skeleton className="h-28" />
          </div>
        ) : !row || !s ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            This game has no logged data.
          </div>
        ) : (
          <>
            <div className="mb-3 text-xs tracking-widest text-muted-foreground">
              {row.status === "active" ? "LIVE — read-only snapshot" : "FINAL"}
            </div>
            <GameReview
              pitchers={s.pitchers ?? []}
              batters={s.batters ?? []}
              pitches={s.pitches ?? []}
              abResults={s.abResults ?? []}
            />
          </>
        )}
      </div>
    </div>
  );
}
