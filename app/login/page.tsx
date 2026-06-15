"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const sb = getSupabase();
    if (!sb) {
      setError("Supabase is not configured.");
      return;
    }
    setBusy(true);
    const { error } = await sb.auth.signInWithPassword({ email, password });
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
        <div className="brand-glow mb-6 text-center text-3xl font-extrabold uppercase tracking-[0.16em]">
          PITCH
          <span className="text-primary">CALL</span>
        </div>
        <form
          onSubmit={signIn}
          className="flex flex-col gap-3 rounded-xl border bg-card p-5"
        >
          <div className="text-xs tracking-widest text-muted-foreground">
            COACHES ONLY — SIGN IN
          </div>
          <label className="sr-only" htmlFor="login-email">
            Email
          </label>
          <input
            id="login-email"
            type="email"
            required
            autoFocus
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border bg-background px-3 py-2.5 text-[15px] text-foreground outline-none focus:border-amber-500"
          />
          <label className="sr-only" htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border bg-background px-3 py-2.5 text-[15px] text-foreground outline-none focus:border-amber-500"
          />
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400"
            >
              {error}
            </div>
          )}
          <Button type="submit" disabled={busy} className="mt-1 font-bold">
            {busy ? "Signing in…" : "SIGN IN"}
          </Button>
          <div className="text-center text-xs text-muted-foreground">
            No account? Ask Craig for an invite.
          </div>
        </form>
      </div>
    </main>
  );
}
