"use client";

import { useState } from "react";
import { X } from "lucide-react";
import {
  STANDARD_PITCHES,
  nextCustomColor,
  type PitchDef,
} from "@/lib/catalog";
import type { Pitcher } from "@/lib/types";
import { createPitcher, updatePitcher } from "@/lib/supabase/sync";

/** Create/edit a pitcher: name, number, repertoire (standards + custom extras). */
export default function PitcherEditor({
  initial,
  onClose,
  onSaved,
  title,
}: {
  initial: Pitcher | null;
  onClose?: () => void;
  onSaved: (p: Pitcher, isNew: boolean) => void;
  title?: string;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [number, setNumber] = useState(initial?.number ?? "");
  const [pitches, setPitches] = useState<PitchDef[]>(initial?.pitches ?? []);
  const [customK, setCustomK] = useState("");
  const [customName, setCustomName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const has = (k: string) => pitches.some((p) => p.k === k);
  const toggleStandard = (pd: PitchDef) =>
    setPitches((xs) =>
      has(pd.k) ? xs.filter((x) => x.k !== pd.k) : [...xs, pd]
    );

  const addCustom = () => {
    const k = customK.trim().toUpperCase().slice(0, 3);
    const fullName = customName.trim() || k;
    if (!k) return;
    if (has(k) || STANDARD_PITCHES.some((p) => p.k === k)) {
      setError(`"${k}" is already taken — pick another short key.`);
      return;
    }
    setError(null);
    setPitches((xs) => [
      ...xs,
      { k, name: fullName, c: nextCustomColor(xs.map((x) => x.c)) },
    ]);
    setCustomK("");
    setCustomName("");
  };

  const save = async () => {
    if (!name.trim()) {
      setError("Pitcher needs a name.");
      return;
    }
    if (pitches.length === 0) {
      setError("Pick at least one pitch.");
      return;
    }
    setError(null);
    setBusy(true);
    if (initial) {
      const next: Pitcher = {
        ...initial,
        name: name.trim(),
        number: number.trim() || null,
        pitches,
      };
      const ok = await updatePitcher(next);
      setBusy(false);
      if (!ok) {
        setError("Save failed — check your connection.");
        return;
      }
      onSaved(next, false);
    } else {
      const created = await createPitcher(
        name.trim(),
        number.trim() || null,
        pitches
      );
      setBusy(false);
      if (!created) {
        setError("Save failed — check your connection.");
        return;
      }
      onSaved(created, true);
    }
  };

  return (
    <div className="mb-5 rounded-2xl border border-primary bg-card p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="brand-glow text-xs font-bold uppercase tracking-widest text-primary">
          {title ?? (initial ? "EDIT PITCHER" : "NEW PITCHER")}
        </div>
        {onClose && (
          <button
            aria-label="Close editor"
            onClick={onClose}
            className="press rounded-2xl border p-1.5 text-muted-foreground hover:bg-accent"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <div className="mb-4 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="min-w-0 flex-1 rounded-xl border bg-background px-3 py-2.5 text-[15px] outline-none focus:border-primary"
        />
        <input
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          placeholder="#"
          className="w-16 rounded-xl border bg-background px-3 py-2.5 font-mono text-[15px] outline-none focus:border-primary"
        />
      </div>

      <div className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
        REPERTOIRE
      </div>
      <div className="mb-2 flex flex-wrap gap-2">
        {STANDARD_PITCHES.map((pd) => {
          const on = has(pd.k);
          return (
            <button
              key={pd.k}
              onClick={() => toggleStandard(pd)}
              aria-pressed={on}
              className="press rounded-2xl border-2 px-3 py-1.5 font-mono text-sm font-bold transition-colors"
              style={
                on
                  ? { borderColor: pd.c, background: pd.c, color: "#0a0c10" }
                  : { borderColor: "var(--border)", color: pd.c }
              }
            >
              {pd.k}
              <span className="ml-1 text-[10px] font-normal opacity-80">
                {pd.name}
              </span>
            </button>
          );
        })}
        {pitches
          .filter((p) => !STANDARD_PITCHES.some((s) => s.k === p.k))
          .map((pd) => (
            <button
              key={pd.k}
              onClick={() =>
                setPitches((xs) => xs.filter((x) => x.k !== pd.k))
              }
              className="press rounded-2xl border-2 px-3 py-1.5 font-mono text-sm font-bold"
              style={{ borderColor: pd.c, background: pd.c, color: "#0a0c10" }}
            >
              {pd.k}
              <span className="ml-1 text-[10px] font-normal opacity-80">
                {pd.name} ✕
              </span>
            </button>
          ))}
      </div>

      <div className="mb-4 flex gap-2">
        <input
          value={customK}
          onChange={(e) => setCustomK(e.target.value)}
          placeholder="Key (e.g. KN)"
          maxLength={3}
          className="w-28 rounded-xl border bg-background px-3 py-2.5 font-mono text-sm uppercase outline-none focus:border-primary"
        />
        <input
          value={customName}
          onChange={(e) => setCustomName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addCustom()}
          placeholder="Custom pitch name"
          className="min-w-0 flex-1 rounded-xl border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
        />
        <button
          onClick={addCustom}
          className="press rounded-2xl border px-3 py-2.5 text-sm font-bold text-muted-foreground hover:bg-accent"
        >
          ADD
        </button>
      </div>

      {error && (
        <div className="mb-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      <button
        onClick={save}
        disabled={busy}
        className="press w-full rounded-2xl bg-primary py-2.5 font-bold tracking-wide text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {busy ? "Saving…" : "SAVE PITCHER"}
      </button>
    </div>
  );
}
