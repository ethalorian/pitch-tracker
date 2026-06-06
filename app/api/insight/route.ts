import { NextResponse, type NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { INSIGHT_SYSTEM } from "@/lib/insight";

export const runtime = "nodejs";

/**
 * Server-only relay to the Anthropic API. The key lives in
 * ANTHROPIC_API_KEY and never reaches the browser. Auth-gated so a
 * leaked URL can't burn your API quota.
 */
export async function POST(request: NextRequest) {
  // require a signed-in user
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json({ error: "Auth unavailable." }, { status: 500 });
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server." },
      { status: 500 }
    );
  }

  let summary = "";
  try {
    const body = await request.json();
    summary = typeof body?.summary === "string" ? body.summary : "";
  } catch {
    /* fall through to empty check */
  }
  if (!summary.trim()) {
    return NextResponse.json(
      { error: "No pitch data yet — log some pitches first." },
      { status: 400 }
    );
  }

  try {
    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 700,
      system: INSIGHT_SYSTEM,
      messages: [{ role: "user", content: summary }],
    });
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("\n")
      .trim();
    return NextResponse.json({ insight: text });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Anthropic request failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
