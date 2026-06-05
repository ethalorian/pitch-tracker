"use client";

import { useRef } from "react";
import type { ContactQuality, Trajectory } from "@/lib/types";

export interface SprayMarker {
  x: number; // 0–1
  y: number; // 0–1
  quality: ContactQuality;
  trajectory?: Trajectory;
}

const VB_W = 100;
const VB_H = 78;

const TRAJ_GLYPH: Record<string, string> = {
  ground: "G",
  line: "L",
  fly: "F",
};

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
}: {
  onTap?: (x: number, y: number) => void;
  markers?: SprayMarker[];
  className?: string;
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
      {/* outfield fan */}
      <path
        d="M 50 72 L 6.2 28.2 A 62 62 0 0 1 93.8 28.2 Z"
        fill="rgba(54, 214, 122, 0.10)"
        stroke="var(--border)"
        strokeWidth="0.8"
      />
      {/* infield dirt */}
      <path
        d="M 50 72 L 30 52 A 28.3 28.3 0 0 1 70 52 Z"
        fill="rgba(255, 178, 90, 0.14)"
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

      {/* spray markers */}
      {markers.map((m, i) => {
        const cx = m.x * VB_W;
        const cy = m.y * VB_H;
        const color =
          m.quality === "hard" ? "rgb(239, 68, 68)" : "rgb(245, 158, 11)";
        return (
          <g key={i}>
            <circle cx={cx} cy={cy} r="2.6" fill={color} opacity="0.9" />
            {m.trajectory && (
              <text
                x={cx}
                y={cy + 1.1}
                textAnchor="middle"
                fontSize="3"
                fontWeight="bold"
                fill="#fff"
              >
                {TRAJ_GLYPH[m.trajectory]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
