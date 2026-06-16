"use client";

import { useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Batter, Hand } from "@/lib/types";

/**
 * The opposing lineup as an explicit batting order. The array order IS
 * the order. Shows who's up and on deck; expands to edit, reorder, sub,
 * and add. AUTO controls whether the next hitter comes up on its own.
 */
export default function LineupPanel({
  batters,
  currentId,
  autoAdvance,
  onSelect,
  onAdd,
  onRemove,
  onMove,
  onEdit,
  onToggleAuto,
}: {
  batters: Batter[];
  currentId: string | null;
  autoAdvance: boolean;
  onSelect: (id: string) => void;
  onAdd: (jersey: string, hand: Hand, name: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onEdit: (id: string, patch: Partial<Batter>) => void;
  onToggleAuto: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // add form
  const [jersey, setJersey] = useState("");
  const [name, setName] = useState("");
  const [hand, setHand] = useState<Hand>("R");

  const curIdx = batters.findIndex((b) => b.id === currentId);
  const current = curIdx >= 0 ? batters[curIdx] : null;
  const onDeck =
    batters.length > 1 && curIdx >= 0
      ? batters[(curIdx + 1) % batters.length]
      : batters.length && curIdx < 0
        ? batters[0]
        : null;

  const submitAdd = () => {
    if (!jersey.trim()) return;
    onAdd(jersey, hand, name);
    setJersey("");
    setName("");
  };

  return (
    <div className="mb-2.5 rounded-2xl border bg-card">
      {/* header: now / on-deck + controls */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {open ? (
            <ChevronUp className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate text-sm">
            <span className="text-[10px] font-bold tracking-widest text-muted-foreground">
              NOW{" "}
            </span>
            <span className="scoreboard font-mono font-extrabold text-primary tnum">
              {current ? `#${current.jersey}` : "—"}
            </span>
            {onDeck && (
              <span className="text-muted-foreground">
                {" "}
                · on deck #{onDeck.jersey}
              </span>
            )}
          </span>
        </button>
        <button
          onClick={onToggleAuto}
          aria-pressed={autoAdvance}
          className={cn(
            "press shrink-0 rounded-2xl border px-2.5 py-1.5 text-[11px] font-bold tracking-widest",
            autoAdvance
              ? "border-primary bg-primary/15 text-primary"
              : "border-border text-muted-foreground hover:bg-accent"
          )}
          title="Auto-advance to the next hitter"
        >
          AUTO {autoAdvance ? "ON" : "OFF"}
        </button>
        <button
          onClick={() => {
            setEditMode((v) => !v);
            setEditingId(null);
            if (!open) setOpen(true);
          }}
          className={cn(
            "shrink-0 rounded-2xl border p-1.5",
            editMode
              ? "border-primary text-primary"
              : "border-border text-muted-foreground hover:bg-accent"
          )}
          aria-label="Edit lineup"
        >
          <Pencil className="size-3.5" />
        </button>
      </div>

      {open && (
        <div className="border-t px-2 py-2">
          {batters.length === 0 && !editMode && (
            <div className="px-2 py-3 text-center text-sm text-muted-foreground">
              No lineup yet. Tap the pencil to add hitters in order.
            </div>
          )}

          <div className="flex flex-col gap-1">
            {batters.map((b, i) => {
              const on = b.id === currentId;
              const deck = onDeck?.id === b.id && !on;

              if (editMode && editingId === b.id) {
                return (
                  <InlineEdit
                    key={b.id}
                    batter={b}
                    onSave={(patch) => {
                      onEdit(b.id, patch);
                      setEditingId(null);
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                );
              }

              return (
                <div key={b.id} className="flex items-center gap-1.5">
                  <button
                    onClick={() => !editMode && onSelect(b.id)}
                    className={cn(
                      "press flex flex-1 items-center gap-2 rounded-2xl border px-2.5 py-2.5 text-left",
                      on
                        ? "border-primary bg-primary/15"
                        : deck
                          ? "border-primary/40 bg-card"
                          : "border-border bg-card hover:bg-accent"
                    )}
                  >
                    <span className="w-5 text-center font-mono text-xs text-muted-foreground tnum">
                      {i + 1}
                    </span>
                    <span
                      className={cn(
                        "scoreboard font-mono text-[15px] font-extrabold tnum",
                        on && "text-primary"
                      )}
                    >
                      #{b.jersey}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {b.hand}HH
                    </span>
                    {b.name && (
                      <span className="truncate text-sm text-muted-foreground">
                        {b.name}
                      </span>
                    )}
                    <span className="ml-auto text-[10px] font-bold tracking-widest">
                      {on ? (
                        <span className="text-primary">AT BAT</span>
                      ) : deck ? (
                        <span className="text-muted-foreground">ON DECK</span>
                      ) : null}
                    </span>
                  </button>

                  {editMode && (
                    <div className="flex shrink-0 items-center">
                      <button
                        onClick={() => onMove(b.id, -1)}
                        disabled={i === 0}
                        className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"
                        aria-label="Move up"
                      >
                        <ChevronUp className="size-4" />
                      </button>
                      <button
                        onClick={() => onMove(b.id, 1)}
                        disabled={i === batters.length - 1}
                        className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"
                        aria-label="Move down"
                      >
                        <ChevronDown className="size-4" />
                      </button>
                      <button
                        onClick={() => setEditingId(b.id)}
                        className="rounded p-1 text-muted-foreground hover:bg-accent"
                        aria-label="Edit / sub"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        onClick={() => onRemove(b.id)}
                        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-red-500"
                        aria-label="Remove"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* add row (edit mode) */}
          {editMode && (
            <div className="mt-2 flex items-center gap-1.5 border-t pt-2">
              <input
                value={jersey}
                onChange={(e) => setJersey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitAdd()}
                placeholder="#"
                className="w-12 rounded-2xl border bg-background px-2 py-1.5 font-mono text-[15px] outline-none focus:border-primary"
              />
              <button
                onClick={() => setHand(hand === "R" ? "L" : "R")}
                className="rounded-2xl border bg-background px-2.5 py-1.5 font-mono text-sm font-bold"
              >
                {hand}
              </button>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitAdd()}
                placeholder="Name (optional)"
                className="min-w-0 flex-1 rounded-2xl border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
              />
              <button
                onClick={submitAdd}
                className="press flex shrink-0 items-center gap-1 rounded-2xl bg-primary px-3 py-1.5 text-sm font-bold text-primary-foreground"
              >
                <Plus className="size-3.5" /> ADD
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InlineEdit({
  batter,
  onSave,
  onCancel,
}: {
  batter: Batter;
  onSave: (patch: Partial<Batter>) => void;
  onCancel: () => void;
}) {
  const [jersey, setJersey] = useState(batter.jersey);
  const [name, setName] = useState(batter.name ?? "");
  const [hand, setHand] = useState<Hand>(batter.hand);

  return (
    <div className="flex items-center gap-1.5 rounded-2xl border border-primary px-2 py-1.5">
      <input
        value={jersey}
        onChange={(e) => setJersey(e.target.value)}
        className="w-12 rounded-2xl border bg-background px-2 py-1.5 font-mono text-[15px] outline-none focus:border-primary"
      />
      <button
        onClick={() => setHand(hand === "R" ? "L" : "R")}
        className="rounded-2xl border bg-background px-2.5 py-1.5 font-mono text-sm font-bold"
      >
        {hand}
      </button>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name"
        className="min-w-0 flex-1 rounded-2xl border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
      />
      <button
        onClick={() =>
          onSave({
            jersey: jersey.trim() || batter.jersey,
            hand,
            name: name.trim() || undefined,
          })
        }
        className="press shrink-0 rounded-2xl bg-primary p-1.5 text-primary-foreground"
        aria-label="Save"
      >
        <Check className="size-4" />
      </button>
      <button
        onClick={onCancel}
        className="press shrink-0 rounded-2xl border p-1.5 text-muted-foreground hover:bg-accent"
        aria-label="Cancel"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
