import { getSupabase } from "./client";
import type { Batter, Pitcher, Team } from "@/lib/types";
import type { PitchDef } from "@/lib/catalog";

/**
 * Best-effort persistence. Every function degrades silently:
 * localStorage is the live source of truth during a game; Supabase
 * is the durable record that catches up whenever there's signal.
 */

/* ── games ── */

export async function createGameRow(
  opponent?: string | null,
  teamId?: string | null
): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from("games")
      .insert({ opponent: opponent ?? null, team_id: teamId ?? null })
      .select("id")
      .single();
    if (error) return null;
    return data.id as string;
  } catch {
    return null;
  }
}

export async function saveGameRow(id: string, state: unknown): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { error } = await sb.from("games").update({ state }).eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

/* ── pitchers ── */

interface PitcherRow {
  id: string;
  name: string;
  number: string | null;
  pitches: PitchDef[];
}

export async function listPitchers(): Promise<Pitcher[]> {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from("pitchers")
      .select("id, name, number, pitches")
      .order("name");
    if (error || !data) return [];
    return (data as PitcherRow[]).map((r) => ({
      id: r.id,
      name: r.name,
      number: r.number,
      pitches: r.pitches ?? [],
    }));
  } catch {
    return [];
  }
}

export async function createPitcher(
  name: string,
  number: string | null,
  pitches: PitchDef[]
): Promise<Pitcher | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from("pitchers")
      .insert({ name, number, pitches })
      .select("id, name, number, pitches")
      .single();
    if (error || !data) return null;
    const r = data as PitcherRow;
    return { id: r.id, name: r.name, number: r.number, pitches: r.pitches };
  } catch {
    return null;
  }
}

export async function updatePitcher(p: Pitcher): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { error } = await sb
      .from("pitchers")
      .update({ name: p.name, number: p.number ?? null, pitches: p.pitches })
      .eq("id", p.id);
    return !error;
  } catch {
    return false;
  }
}

export async function deletePitcher(id: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { error } = await sb.from("pitchers").delete().eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

/* ── teams (opponents) ── */

interface TeamRow {
  id: string;
  name: string;
  batters: Batter[];
}

export async function listTeams(): Promise<Team[]> {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from("teams")
      .select("id, name, batters")
      .order("name");
    if (error || !data) return [];
    return (data as TeamRow[]).map((r) => ({
      id: r.id,
      name: r.name,
      batters: r.batters ?? [],
    }));
  } catch {
    return [];
  }
}

export async function createTeam(
  name: string,
  batters: Batter[] = []
): Promise<Team | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from("teams")
      .insert({ name, batters })
      .select("id, name, batters")
      .single();
    if (error || !data) return null;
    const r = data as TeamRow;
    return { id: r.id, name: r.name, batters: r.batters ?? [] };
  } catch {
    return null;
  }
}

export async function updateTeam(t: Team): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { error } = await sb
      .from("teams")
      .update({ name: t.name, batters: t.batters })
      .eq("id", t.id);
    return !error;
  } catch {
    return false;
  }
}

export async function deleteTeam(id: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { error } = await sb.from("teams").delete().eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

/** Roster sync-back: merge the game's batters into the saved team. */
export async function syncTeamBatters(
  teamId: string,
  batters: Batter[]
): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { error } = await sb
      .from("teams")
      .update({ batters })
      .eq("id", teamId);
    return !error;
  } catch {
    return false;
  }
}
