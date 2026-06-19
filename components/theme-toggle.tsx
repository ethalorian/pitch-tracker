"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

const emptySubscribe = () => () => {};

/**
 * Big, labeled day/night switch. The label names the DESTINATION, so in
 * a dark dugout it reads "DAY" (tap to brighten for sunlight) and in sun
 * it reads "NIGHT". Made obvious on purpose — switching to the daylight
 * theme is the single biggest legibility win on a bright field.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // true after hydration, false during SSR/hydration render
  const mounted = React.useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const base =
    "press flex items-center gap-1.5 rounded-2xl border px-3 py-2 text-xs font-bold tracking-widest text-muted-foreground hover:bg-accent hover:text-foreground";

  // Avoid hydration mismatch: render a stable placeholder until mounted
  if (!mounted) {
    return (
      <button className={base} aria-label="Toggle daylight / night mode">
        <Sun className="size-4" />
        DAY
      </button>
    );
  }

  const dark = resolvedTheme === "dark";
  return (
    <button
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to daylight mode" : "Switch to night mode"}
      className={base}
    >
      {dark ? (
        <>
          <Sun className="size-4" />
          DAY
        </>
      ) : (
        <>
          <Moon className="size-4" />
          NIGHT
        </>
      )}
    </button>
  );
}
