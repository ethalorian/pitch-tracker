import { getSupabase } from "./client";

/**
 * Best-effort game persistence. Every function degrades silently:
 * localStorage is the live source of truth during a game; Supabase
 * is the durable record that catches up whenever there's signal.
 */

export async function createGameRow(
  opponent?: string | null
): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from("games")
      .insert({ opponent: opponent ?? null })
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
