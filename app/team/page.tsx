"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import PitcherEditor from "@/components/pitcher-editor";
import CardEditor from "@/components/card-editor";
import { uid, type Batter, type Hand, type Pitcher, type Team } from "@/lib/types";
import {
  deletePitcher,
  deleteTeam,
  listPitchers,
  listTeams,
  updateTeam,
} from "@/lib/supabase/sync";

const emptySubscribe = () => () => {};

export default function TeamPage() {
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const [pitchers, setPitchers] = useState<Pitcher[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingPitcher, setEditingPitcher] = useState<Pitcher | "new" | null>(
    null
  );
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([listPitchers(), listTeams()]).then(([ps, ts]) => {
      if (!live) return;
      setPitchers(ps);
      setTeams(ts);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!mounted) return null;

  return (
    <div className="mx-auto w-full max-w-[480px] pb-24 font-sans">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-3.5 py-3">
        <div className="flex items-center gap-2">
          <Link
            href="/"
            aria-label="Back to game"
            className="rounded-lg border p-1.5 text-muted-foreground hover:bg-accent"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="text-lg font-bold tracking-wide">
            COACH<span className="text-amber-600 dark:text-amber-400">SETUP</span>
          </div>
        </div>
        <ThemeToggle />
      </div>

      <div className="px-3.5 py-3">
        {loading ? (
          <div className="p-6 text-center text-muted-foreground">loading…</div>
        ) : (
          <>
            {/* ── pitchers ── */}
            <SectionLabel>
              MY PITCHERS
              <button
                onClick={() => setEditingPitcher("new")}
                className="ml-auto flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-bold tracking-widest text-amber-600 hover:bg-accent dark:text-amber-400"
              >
                <Plus className="size-3" /> ADD
              </button>
            </SectionLabel>

            {pitchers.length === 0 && !editingPitcher && (
              <div className="mb-4 rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                No pitchers yet. Add one and pick her repertoire — the in-game
                pitch buttons adapt to it.
              </div>
            )}

            <div className="mb-5 flex flex-col gap-2">
              {pitchers.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-bold">
                      {p.name}
                      {p.number && (
                        <span className="ml-1.5 text-sm text-muted-foreground">
                          #{p.number}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {p.pitches.map((pd) => (
                        <span
                          key={pd.k}
                          className="rounded border px-1.5 py-0.5 font-mono text-[11px] font-bold"
                          style={{ color: pd.c, borderColor: pd.c }}
                        >
                          {pd.k}
                        </span>
                      ))}
                      {p.pitches.length === 0 && (
                        <span className="text-xs text-red-600 dark:text-red-400">
                          no pitches set
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    aria-label={`Edit ${p.name}`}
                    onClick={() => setEditingPitcher(p)}
                    className="rounded-lg border p-1.5 text-muted-foreground hover:bg-accent"
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    aria-label={`Delete ${p.name}`}
                    onClick={async () => {
                      if (!window.confirm(`Delete ${p.name}?`)) return;
                      await deletePitcher(p.id);
                      setPitchers((xs) => xs.filter((x) => x.id !== p.id));
                    }}
                    className="rounded-lg border p-1.5 text-muted-foreground hover:bg-accent hover:text-red-500"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>

            {editingPitcher && (
              <PitcherEditor
                initial={editingPitcher === "new" ? null : editingPitcher}
                onClose={() => setEditingPitcher(null)}
                onSaved={(saved, isNew) => {
                  setPitchers((xs) =>
                    isNew
                      ? [...xs, saved].sort((a, b) =>
                          a.name.localeCompare(b.name)
                        )
                      : xs.map((x) => (x.id === saved.id ? saved : x))
                  );
                  setEditingPitcher(null);
                }}
              />
            )}

            {/* ── opponent teams ── */}
            <SectionLabel>OPPONENT TEAMS</SectionLabel>

            {teams.length === 0 && (
              <div className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                Teams appear here automatically when you start a game against a
                new opponent. Rosters grow as you tag batters.
              </div>
            )}

            <div className="flex flex-col gap-2">
              {teams.map((t) => (
                <div key={t.id} className="rounded-xl border bg-card px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-bold">{t.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.batters.length} batter
                        {t.batters.length === 1 ? "" : "s"}
                      </div>
                    </div>
                    <button
                      aria-label={`Edit ${t.name}`}
                      onClick={() =>
                        setEditingTeam(editingTeam?.id === t.id ? null : t)
                      }
                      className="rounded-lg border p-1.5 text-muted-foreground hover:bg-accent"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      aria-label={`Delete ${t.name}`}
                      onClick={async () => {
                        if (
                          !window.confirm(
                            `Delete ${t.name} and its saved roster? Past game logs are kept.`
                          )
                        )
                          return;
                        await deleteTeam(t.id);
                        setTeams((xs) => xs.filter((x) => x.id !== t.id));
                        if (editingTeam?.id === t.id) setEditingTeam(null);
                      }}
                      className="rounded-lg border p-1.5 text-muted-foreground hover:bg-accent hover:text-red-500"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>

                  {editingTeam?.id === t.id && (
                    <TeamEditor
                      team={editingTeam}
                      onChange={(next) => {
                        setEditingTeam(next);
                        setTeams((xs) =>
                          xs.map((x) => (x.id === next.id ? next : x))
                        );
                        void updateTeam(next);
                      }}
                    />
                  )}
                </div>
              ))}
            </div>

            {/* ── wristband call card ── */}
            <div className="mt-6">
              <SectionLabel>WRISTBAND CARD</SectionLabel>
              <CardEditor />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 mt-1 flex items-center text-xs tracking-widest text-muted-foreground">
      {children}
    </div>
  );
}

/* ───────── team roster editor ───────── */
function TeamEditor({
  team,
  onChange,
}: {
  team: Team;
  onChange: (t: Team) => void;
}) {
  const [jersey, setJersey] = useState("");
  const [bname, setBname] = useState("");
  const [hand, setHand] = useState<Hand>("R");

  const addBatter = () => {
    const j = jersey.trim();
    if (!j) return;
    const batter: Batter = {
      id: uid(),
      jersey: j,
      hand,
      name: bname.trim() || undefined,
    };
    onChange({ ...team, batters: [...team.batters, batter] });
    setJersey("");
    setBname("");
  };

  return (
    <div className="mt-3 border-t pt-3">
      <div className="mb-2 flex gap-2">
        <input
          value={team.name}
          onChange={(e) => onChange({ ...team, name: e.target.value })}
          className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm font-bold outline-none focus:border-amber-500"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        {team.batters.map((b) => (
          <div
            key={b.id}
            className="flex items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-sm"
          >
            <span className="font-mono font-bold">#{b.jersey}</span>
            <button
              onClick={() =>
                onChange({
                  ...team,
                  batters: team.batters.map((x) =>
                    x.id === b.id
                      ? { ...x, hand: x.hand === "R" ? "L" : "R" }
                      : x
                  ),
                })
              }
              className="rounded border px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:bg-accent"
            >
              {b.hand}
            </button>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {b.name ?? ""}
            </span>
            <button
              aria-label={`Remove #${b.jersey}`}
              onClick={() =>
                onChange({
                  ...team,
                  batters: team.batters.filter((x) => x.id !== b.id),
                })
              }
              className="rounded border p-1 text-muted-foreground hover:text-red-500"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={jersey}
          onChange={(e) => setJersey(e.target.value)}
          placeholder="#"
          className="w-14 rounded-lg border bg-background px-2 py-1.5 font-mono text-sm outline-none focus:border-amber-500"
        />
        <button
          onClick={() => setHand(hand === "R" ? "L" : "R")}
          className="rounded-lg border px-2.5 py-1.5 font-mono text-sm font-bold"
        >
          {hand}
        </button>
        <input
          value={bname}
          onChange={(e) => setBname(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addBatter()}
          placeholder="Name (optional)"
          className="min-w-0 flex-1 rounded-lg border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-amber-500"
        />
        <button
          onClick={addBatter}
          className="rounded-lg border px-2.5 py-1.5 text-sm font-bold text-muted-foreground hover:bg-accent"
        >
          ADD
        </button>
      </div>
    </div>
  );
}
