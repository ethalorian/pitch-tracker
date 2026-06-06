import { getSupabase } from "./client";
import type { Batter, GameState, Pitcher, Team } from "@/lib/types";
import type { PitchDef } from "@/lib/catalog";
import type { CallCardBuckets } from "@/lib/callsheet";

/**
 * Persistence. Game state lives in Supabase as the cross-device source
 * of truth; the client keeps a localStorage cache for offline play and
 * reconciles on load. Pitcher/team helpers degrade silently to empty.
 */

/* ── games ── */

export interface GameRow {
  id: string;
  opponent: string | null;
  teamId: string | null;
  status: "active" | "ended";
  startedAt: string;
  endedAt: string | null;
  updatedAt: string;
  state: GameState | null;
}

interface RawGameRow {
  id: string;
  opponent: string | null;
  team_id: string | null;
  status: "active" | "ended";
  started_at: string;
  ended_at: string | null;
  updated_at: string;
  state: GameState | null;
}

const mapGame = (r: RawGameRow): GameRow => ({
  id: r.id,
  opponent: r.opponent,
  teamId: r.team_id,
  status: r.status,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  updatedAt: r.updated_at,
  state: r.state,
});

const GAME_COLS =
  "id, opponent, team_id, status, started_at, ended_at, updated_at, state";

/** End any open game, then start a fresh active one. */
export async function createGameRow(
  opponent?: string | null,
  teamId?: string | null
): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    // only one active game allowed (unique index) — close the prior one
    await sb
      .from("games")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("status", "active");
    const { data, error } = await sb
      .from("games")
      .insert({
        opponent: opponent ?? null,
        team_id: teamId ?? null,
        status: "active",
      })
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

/**
 * The single active game to resume. `online` distinguishes "reached the
 * server, no active game" (clear local) from "couldn't reach server"
 * (keep local cache).
 */
export async function getActiveGame(): Promise<{
  online: boolean;
  game: GameRow | null;
}> {
  const sb = getSupabase();
  if (!sb) return { online: false, game: null };
  try {
    const { data, error } = await sb
      .from("games")
      .select(GAME_COLS)
      .eq("status", "active")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return { online: false, game: null };
    return { online: true, game: data ? mapGame(data as RawGameRow) : null };
  } catch {
    return { online: false, game: null };
  }
}

export async function endGame(id: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { error } = await sb
      .from("games")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

/** History list (metadata only — no state payload). */
export async function listGames(): Promise<GameRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from("games")
      .select("id, opponent, team_id, status, started_at, ended_at, updated_at")
      .order("started_at", { ascending: false });
    if (error || !data) return [];
    return (data as Omit<RawGameRow, "state">[]).map((r) =>
      mapGame({ ...r, state: null })
    );
  } catch {
    return [];
  }
}

export async function getGame(id: string): Promise<GameRow | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from("games")
      .select(GAME_COLS)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    return mapGame(data as RawGameRow);
  } catch {
    return null;
  }
}

/** All ended games for a team, newest first — the scouting corpus. */
export async function listTeamGames(teamId: string): Promise<GameRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from("games")
      .select(GAME_COLS)
      .eq("team_id", teamId)
      .order("started_at", { ascending: false });
    if (error || !data) return [];
    return (data as RawGameRow[]).map(mapGame);
  } catch {
    return [];
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

/* ── wristband call cards ── */

export interface CallCard {
  id: string;
  name: string;
  buckets: CallCardBuckets;
  isActive: boolean;
}

interface CardRow {
  id: string;
  name: string;
  buckets: CallCardBuckets;
  is_active: boolean;
}

const mapCard = (r: CardRow): CallCard => ({
  id: r.id,
  name: r.name,
  buckets: r.buckets ?? {},
  isActive: r.is_active,
});

export async function listCards(): Promise<CallCard[]> {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from("call_cards")
      .select("id, name, buckets, is_active")
      .order("created_at");
    if (error || !data) return [];
    return (data as CardRow[]).map(mapCard);
  } catch {
    return [];
  }
}

export async function getActiveCard(): Promise<CallCard | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from("call_cards")
      .select("id, name, buckets, is_active")
      .eq("is_active", true)
      .maybeSingle();
    if (error || !data) return null;
    return mapCard(data as CardRow);
  } catch {
    return null;
  }
}

export async function createCard(
  name: string,
  buckets: CallCardBuckets
): Promise<CallCard | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from("call_cards")
      .insert({ name, buckets, is_active: false })
      .select("id, name, buckets, is_active")
      .single();
    if (error || !data) return null;
    return mapCard(data as CardRow);
  } catch {
    return null;
  }
}

export async function updateCard(card: CallCard): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { error } = await sb
      .from("call_cards")
      .update({ name: card.name, buckets: card.buckets })
      .eq("id", card.id);
    return !error;
  } catch {
    return false;
  }
}

/** Make one card active (deactivate the rest first to satisfy the index). */
export async function setActiveCard(id: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    await sb.from("call_cards").update({ is_active: false }).eq("is_active", true);
    const { error } = await sb
      .from("call_cards")
      .update({ is_active: true })
      .eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

export async function deleteCard(id: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { error } = await sb.from("call_cards").delete().eq("id", id);
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
