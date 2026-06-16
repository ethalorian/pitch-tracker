"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Batter, Pitcher, Team } from "@/lib/types";
import { createTeam, listPitchers, listTeams } from "@/lib/supabase/sync";

export interface GameSetup {
  pitchers: Pitcher[];
  pitcherId: string;
  teamId: string | null;
  opponentName: string | null;
  batters: Batter[];
}

/**
 * Pre-game setup: pick the starting pitcher, pick the opponent
 * (a saved team loads its roster; a new name creates the team).
 */
export default function NewGameSetup({
  onStart,
  onCancel,
}: {
  onStart: (setup: GameSetup) => void;
  onCancel: () => void;
}) {
  const [pitchers, setPitchers] = useState<Pitcher[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [pitcherId, setPitcherId] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([listPitchers(), listTeams()]).then(([ps, ts]) => {
      if (!live) return;
      setPitchers(ps);
      setTeams(ts);
      if (ps.length === 1) setPitcherId(ps[0].id);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, []);

  const start = async () => {
    if (!pitcherId) {
      setError("Pick a starting pitcher.");
      return;
    }
    let team: Team | null = teams.find((t) => t.id === teamId) ?? null;
    const typed = newName.trim();
    if (!team && !typed) {
      setError("Pick a previous opponent or enter a new team name.");
      return;
    }
    setError(null);
    setBusy(true);

    let opponentName = team?.name ?? null;
    if (!team && typed) {
      // new opponent — create the team row (best effort; offline still plays)
      team = await createTeam(typed);
      opponentName = typed;
    }

    setBusy(false);
    onStart({
      pitchers,
      pitcherId,
      teamId: team?.id ?? null,
      opponentName,
      batters: team?.batters ?? [],
    });
  };

  return (
    <div className="animate-overlay-in fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-background/90 p-4 pt-12 backdrop-blur-sm">
      <div className="animate-sheet-in w-full max-w-[440px] rounded-2xl border bg-card p-4">
        <div className="mb-4 flex items-center justify-between">
          <div className="brand-glow text-sm font-bold tracking-widest text-primary">
            NEW GAME
          </div>
          <button
            aria-label="Cancel"
            onClick={onCancel}
            className="press rounded-2xl border p-1.5 text-muted-foreground hover:bg-accent"
          >
            <X className="size-4" />
          </button>
        </div>

        {loading ? (
          <div className="p-6 text-center text-muted-foreground">loading…</div>
        ) : (
          <>
            <div className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              STARTING PITCHER
            </div>
            {pitchers.length === 0 ? (
              <div className="mb-4 rounded-2xl border border-dashed p-3 text-sm text-muted-foreground">
                No pitchers set up yet.{" "}
                <Link
                  href="/team"
                  className="font-bold text-primary underline-offset-4 hover:underline"
                >
                  Add one on the coach screen
                </Link>{" "}
                first.
              </div>
            ) : (
              <div className="mb-4 flex flex-wrap gap-2">
                {pitchers.map((p) => {
                  const on = p.id === pitcherId;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setPitcherId(p.id)}
                      className={cn(
                        "press rounded-2xl border px-3 py-2 text-sm font-bold",
                        on
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border text-foreground hover:bg-accent"
                      )}
                    >
                      {p.name}
                      {p.number && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          #{p.number}
                        </span>
                      )}
                      <span className="ml-1.5 text-[10px] text-muted-foreground">
                        {p.pitches.length}p
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              OPPONENT
            </div>
            {teams.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {teams.map((t) => {
                  const on = t.id === teamId;
                  return (
                    <button
                      key={t.id}
                      onClick={() => {
                        setTeamId(on ? null : t.id);
                        setNewName("");
                      }}
                      className={cn(
                        "press rounded-2xl border px-3 py-2 text-sm font-bold",
                        on
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border text-foreground hover:bg-accent"
                      )}
                    >
                      {t.name}
                      <span className="ml-1.5 text-[10px] text-muted-foreground">
                        {t.batters.length} batters
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <input
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                if (e.target.value) setTeamId(null);
              }}
              placeholder={
                teams.length
                  ? "…or type a new opponent name"
                  : "Opponent team name (required)"
              }
              className="mb-4 w-full rounded-xl border bg-background px-3 py-2.5 text-[15px] outline-none focus:border-primary"
            />

            {error && (
              <div className="mb-2 text-sm text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            <button
              onClick={start}
              disabled={busy || pitchers.length === 0}
              className="press w-full rounded-2xl bg-primary py-3 font-bold tracking-wide text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? "Starting…" : "START GAME"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
