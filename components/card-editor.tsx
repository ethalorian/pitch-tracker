"use client";

import { useEffect, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  BUCKET_DEFS,
  DEFAULT_CARD_BUCKETS,
  type CallCardBuckets,
} from "@/lib/callsheet";
import {
  createCard,
  deleteCard,
  listCards,
  setActiveCard,
  updateCard,
  type CallCard,
} from "@/lib/supabase/sync";

const parseCodes = (s: string) => s.split(/[\s,]+/).filter(Boolean);

export default function CardEditor() {
  const [cards, setCards] = useState<CallCard[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [buckets, setBuckets] = useState<CallCardBuckets>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const loadInto = (c: CallCard) => {
    setSelId(c.id);
    setName(c.name);
    setBuckets(c.buckets);
  };

  useEffect(() => {
    let live = true;
    listCards().then((cs) => {
      if (!live) return;
      setCards(cs);
      const active = cs.find((c) => c.isActive) ?? cs[0];
      if (active) loadInto(active);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, []);

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 1500);
  };

  const save = async () => {
    if (!selId) return;
    setBusy(true);
    const next: CallCard = {
      id: selId,
      name: name.trim() || "Untitled card",
      buckets,
      isActive: cards.find((c) => c.id === selId)?.isActive ?? false,
    };
    const ok = await updateCard(next);
    setBusy(false);
    if (ok) {
      setCards((cs) => cs.map((c) => (c.id === selId ? { ...c, ...next } : c)));
      flash("Card saved");
    } else {
      flash("Save failed");
    }
  };

  const makeActive = async () => {
    if (!selId) return;
    setBusy(true);
    const ok = await setActiveCard(selId);
    setBusy(false);
    if (ok) {
      setCards((cs) => cs.map((c) => ({ ...c, isActive: c.id === selId })));
      flash("Now the active card");
    }
  };

  const addCard = async () => {
    setBusy(true);
    const created = await createCard("New card", DEFAULT_CARD_BUCKETS);
    setBusy(false);
    if (created) {
      setCards((cs) => [...cs, created]);
      loadInto(created);
    }
  };

  const removeCard = async (id: string) => {
    const ok = await confirm({
      title: "Delete this card?",
      body: "Its relay codes are gone for good.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    await deleteCard(id);
    const remaining = cards.filter((c) => c.id !== id);
    setCards(remaining);
    if (selId === id && remaining[0]) loadInto(remaining[0]);
  };

  if (loading) {
    return <div className="p-3 text-sm text-muted-foreground">loading…</div>;
  }

  const selected = cards.find((c) => c.id === selId);

  return (
    <div>
      {/* card switcher */}
      <div className="mb-4 flex flex-wrap gap-2">
        {cards.map((c) => (
          <button
            key={c.id}
            onClick={() => loadInto(c)}
            className={cn(
              "press flex items-center gap-1 rounded-2xl border px-3 py-1.5 text-sm font-bold",
              c.id === selId
                ? "border-primary bg-primary/15 text-primary"
                : "border-border text-foreground hover:bg-accent"
            )}
          >
            {c.isActive && <Check className="size-3.5" />}
            {c.name}
          </button>
        ))}
        <button
          onClick={addCard}
          disabled={busy}
          className="press flex items-center gap-1 rounded-2xl border border-dashed px-3 py-1.5 text-sm font-bold text-muted-foreground hover:bg-accent"
        >
          <Plus className="size-3.5" /> NEW
        </button>
      </div>

      {selected && (
        <>
          <div className="mb-4 flex items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Card name"
              className="min-w-0 flex-1 rounded-xl border bg-background px-3 py-2.5 text-[15px] font-bold outline-none focus:border-primary"
            />
            {!selected.isActive && (
              <button
                onClick={makeActive}
                disabled={busy}
                className="press shrink-0 rounded-2xl border px-3 py-2.5 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:bg-accent"
              >
                SET ACTIVE
              </button>
            )}
            {cards.length > 1 && (
              <button
                onClick={() => removeCard(selected.id)}
                aria-label="Delete card"
                className="press shrink-0 rounded-2xl border p-2.5 text-muted-foreground hover:bg-accent hover:text-red-500"
              >
                <Trash2 className="size-4" />
              </button>
            )}
          </div>

          <div className="mb-2 text-[11px] text-muted-foreground">
            Paste the codes for each bucket, separated by spaces. These are the
            numbers you relay; players decode them on the wristband.
          </div>

          <div className="flex flex-col gap-2">
            {BUCKET_DEFS.map((b) => (
              <div key={b.key} className="rounded-2xl border bg-card p-2.5">
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="font-mono text-sm font-bold">{b.key}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {b.label} · {(buckets[b.key] ?? []).length} codes
                  </span>
                </div>
                <textarea
                  value={(buckets[b.key] ?? []).join(" ")}
                  onChange={(e) =>
                    setBuckets((bk) => ({
                      ...bk,
                      [b.key]: parseCodes(e.target.value),
                    }))
                  }
                  rows={2}
                  className="w-full resize-none rounded-xl border bg-background px-2 py-1.5 font-mono text-sm outline-none focus:border-primary"
                />
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={save}
              disabled={busy}
              className="press flex-1 rounded-2xl bg-primary py-2.5 font-bold tracking-wide text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? "Saving…" : "SAVE CARD"}
            </button>
            {msg && (
              <span
                role="status"
                className="text-sm font-bold text-primary"
              >
                {msg}
              </span>
            )}
          </div>
        </>
      )}

      {confirmDialog}
    </div>
  );
}
