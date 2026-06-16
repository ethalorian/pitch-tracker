"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive actions get a red confirm button. */
  destructive?: boolean;
}

/**
 * Promise-based confirm dialog that replaces window.confirm with a
 * styled, accessible modal. Usage:
 *
 *   const { confirm, dialog } = useConfirm();
 *   ...
 *   if (!(await confirm({ title: "End this game?" }))) return;
 *   ...
 *   return <>{ui}{dialog}</>
 */
export function useConfirm() {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    setOpts(o);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const close = useCallback((v: boolean) => {
    resolverRef.current?.(v);
    resolverRef.current = null;
    setOpts(null);
  }, []);

  // Escape always cancels
  useEffect(() => {
    if (!opts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [opts, close]);

  const dialog = opts ? (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={opts.title}
      className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      onClick={() => close(false)}
    >
      <div
        className="animate-sheet-in w-full max-w-[360px] rounded-2xl border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-base font-bold">{opts.title}</div>
        {opts.body && (
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {opts.body}
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <button
            autoFocus
            onClick={() => close(false)}
            className="press flex-1 rounded-2xl border py-2.5 text-sm font-bold text-muted-foreground hover:bg-accent"
          >
            {opts.cancelLabel ?? "Cancel"}
          </button>
          <button
            onClick={() => close(true)}
            className={cn(
              "press flex-1 rounded-2xl py-2.5 text-sm font-bold",
              opts.destructive
                ? "bg-red-600 text-white hover:bg-red-500"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            )}
          >
            {opts.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, dialog };
}
