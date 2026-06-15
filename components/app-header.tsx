import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Shared sticky page header: back chevron, brand-style two-tone title,
 * optional action slot, theme toggle. Keeps every secondary screen's
 * chrome identical so coaches always know where "back" lives.
 */
export default function AppHeader({
  backHref = "/",
  backLabel = "Back to game",
  title,
  accent,
  children,
}: {
  backHref?: string;
  backLabel?: string;
  title: string;
  accent?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/70 bg-background/80 px-3.5 py-2.5 backdrop-blur-md">
      <div className="flex min-w-0 items-center gap-2.5">
        <Link
          href={backHref}
          aria-label={backLabel}
          className="press rounded-lg border border-border/70 p-2 text-muted-foreground hover:border-primary/60 hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden className="h-5 w-1 shrink-0 rounded-full bg-primary" />
          <div className="brand-glow truncate text-lg font-extrabold uppercase tracking-[0.14em]">
            {title}
            {accent && <span className="text-primary">{accent}</span>}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {children}
        <ThemeToggle />
      </div>
    </div>
  );
}

/** Pulsing placeholder block for loading states. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-xl bg-muted ${className}`}
    />
  );
}
