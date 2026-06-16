"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export default function SetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    const sb = getSupabase();
    if (!sb) {
      setError("Supabase is not configured.");
      return;
    }
    setBusy(true);
    const { error } = await sb.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/");
    router.refresh();
  };

  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="brand-glow mb-6 text-center text-2xl font-bold tracking-wide">
          PITCH
          <span className="text-primary">CALL</span>
        </div>
        <form
          onSubmit={submit}
          className="flex flex-col gap-3 rounded-2xl border bg-card p-5"
        >
          <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            WELCOME — SET YOUR PASSWORD
          </div>
          <input
            type="password"
            required
            autoComplete="new-password"
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-xl border bg-background px-3 py-2.5 text-[15px] text-foreground outline-none focus:border-primary"
          />
          <input
            type="password"
            required
            autoComplete="new-password"
            placeholder="Confirm password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="rounded-xl border bg-background px-3 py-2.5 text-[15px] text-foreground outline-none focus:border-primary"
          />
          {error && (
            <div className="text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
          <Button type="submit" disabled={busy} className="mt-1 font-bold">
            {busy ? "Saving…" : "SAVE & ENTER"}
          </Button>
        </form>
      </div>
    </main>
  );
}
