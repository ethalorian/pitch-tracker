"use client";

import { useRef } from "react";
import type { ContactQuality, Trajectory } from "@/lib/types";

export interface SprayMarker {
  x: number; // 0–1
  y: number; // 0–1
  quality?: ContactQuality;
  trajectory?: Trajectory;
}

const VB_W = 100;
const VB_H = 78;

/**
 * Softball field, drawn as a fan from home plate. Tap anywhere to
 * report a normalized (x, y) when `onTap` is given; pass `markers`
 * to render a spray chart. Foul territory taps are allowed — foul
 * outs are real plays.
 */
export default function FieldChart({
  onTap,
  markers = [],
  className,
  ghost = false,
  bases,
  onBase,
}: {
  onTap?: (x: number, y: number) => void;
  markers?: SprayMarker[];
  className?: string;
  /** dim the field + spray so overlaid controls read clearly */
  ghost?: boolean;
  /** runner state; when given with onBase, tappable bases render on the field */
  bases?: { on1: boolean; on2: boolean; on3: boolean };
  onBase?: (which: "on1" | "on2" | "on3") => void;
}) {
  const ref = useRef<SVGSVGElement>(null);

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onTap || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    onTap(Math.min(Math.max(x, 0), 1), Math.min(Math.max(y, 0), 1));
  };

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className={className}
      onClick={handleClick}
      style={onTap ? { cursor: "crosshair", touchAction: "manipulation" } : undefined}
      role={onTap ? "button" : "img"}
      aria-label={onTap ? "Tap where the ball went" : "Spray chart"}
    >
      <g opacity={ghost ? 0.32 : 1}>
      {/* outfield fan */}
      <path
        d="M 50 72 L 6.2 28.2 A 62 62 0 0 1 93.8 28.2 Z"
        fill="rgba(38, 197, 142, 0.13)"
        stroke="var(--border)"
        strokeWidth="0.8"
      />
      {/* infield dirt — radius 36 so the full diamond (2B at r≈32) sits inside */}
      <path
        d="M 50 72 L 24.5 46.5 A 36 36 0 0 1 75.5 46.5 Z"
        fill="rgba(245, 175, 70, 0.18)"
        stroke="var(--border)"
        strokeWidth="0.6"
      />
      {/* base paths */}
      <path
        d="M 50 72 L 66 56 L 50 40 L 34 56 Z"
        fill="none"
        stroke="var(--border)"
        strokeWidth="0.8"
      />
      {/* bases + pitcher's circle */}
      <circle cx="50" cy="57.5" r="2.6" fill="none" stroke="var(--border)" strokeWidth="0.6" />
      <rect x="64.9" y="54.9" width="2.2" height="2.2" fill="var(--muted-foreground)" transform="rotate(45 66 56)" />
      <rect x="48.9" y="38.9" width="2.2" height="2.2" fill="var(--muted-foreground)" transform="rotate(45 50 40)" />
      <rect x="32.9" y="54.9" width="2.2" height="2.2" fill="var(--muted-foreground)" transform="rotate(45 34 56)" />
      <rect x="48.9" y="70.9" width="2.2" height="2.2" fill="var(--muted-foreground)" transform="rotate(45 50 72)" />

      {/* spray markers — simple dots showing where balls were put in play */}
      {markers.map((m, i) => (
        <circle
          key={i}
          cx={m.x * VB_W}
          cy={m.y * VB_H}
          r="2.4"
          fill="rgb(245, 158, 11)"
          opacity="0.9"
        />
      ))}
      </g>

      {/* interactive bases at their true field positions (full opacity) */}
      {bases &&
        onBase &&
        (
          [
            ["on1", 66, 56, "First base"],
            ["on2", 50, 40, "Second base"],
            ["on3", 34, 56, "Third base"],
          ] as const
        ).map(([k, cx, cy, label]) => {
          const on = bases[k];
          return (
            <g
              key={k}
              onClick={(e) => {
                e.stopPropagation();
                onBase(k);
              }}
              role="button"
              aria-label={`${label} ${on ? "occupied, tap to clear" : "empty, tap to set"}`}
              style={{ cursor: "pointer" }}
            >
              <circle cx={cx} cy={cy} r="7" fill="transparent" />
              <circle
                cx={cx}
                cy={cy}
                r="3.8"
                fill={on ? "var(--primary)" : "var(--card)"}
                stroke={on ? "var(--primary)" : "var(--muted-foreground)"}
                strokeWidth="1.5"
              />
            </g>
          );
        })}
    </svg>
  );
}
