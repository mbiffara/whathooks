"use client";

import type { AdminTimeseries, AdminTimeseriesPoint } from "@/lib/types";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Platform-wide daily activity for the admin console: messages (inbound and
 * outbound stacked) and AI tokens, one UTC day per column. The two measures
 * live on different scales, so they get two stacked panels that share the
 * x-axis and the hover column rather than a dual y-axis on one plot.
 */
export function AdminUsageChart({ data }: { data: AdminTimeseries }) {
  const { series, totals, days } = data;
  const empty = totals.messages === 0 && totals.tokens === 0;

  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  // Keep text at its true size at any container width: the viewBox tracks the
  // element instead of scaling a fixed drawing.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[var(--color-muted)]">
        <LegendItem swatch="var(--color-brand)">
          Inbound {compact(totals.inbound)}
        </LegendItem>
        <LegendItem swatch="var(--color-info)">
          Outbound {compact(totals.outbound)}
        </LegendItem>
        <LegendItem swatch="var(--color-warning)" line>
          Tokens {compact(totals.tokens)}
        </LegendItem>
        <span className="ml-auto">
          Messages {compact(totals.messages)} · last {days} days · UTC days
        </span>
      </div>

      {empty ? (
        <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-[var(--color-border)] text-sm text-[var(--color-muted)]">
          No activity in the last {days} days
        </div>
      ) : (
        <div
          ref={wrapRef}
          className="relative w-full"
          onMouseLeave={() => setHover(null)}
        >
          <Plot
            series={series}
            width={width}
            hover={hover}
            onHover={setHover}
          />
          {hover != null && (
            <Tooltip point={series[hover]} index={hover} n={series.length} />
          )}
        </div>
      )}
    </div>
  );
}

// ---- geometry ---------------------------------------------------------------

const H = 240;
const PAD = { left: 48, right: 12, top: 8, bottom: 22 };
const GAP = 22; // between the two panels
const MSG_H = 118;
const TOK_H = H - PAD.top - PAD.bottom - GAP - MSG_H;
const MSG_TOP = PAD.top;
const TOK_TOP = PAD.top + MSG_H + GAP;
const LABEL_EVERY = 5;

function Plot({
  series,
  width,
  hover,
  onHover,
}: {
  series: AdminTimeseriesPoint[];
  width: number;
  hover: number | null;
  onHover: (i: number | null) => void;
}) {
  const n = series.length;
  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const slot = plotW / n;
  const barW = Math.max(1, Math.min(24, slot - 2));
  const xCenter = (i: number) => PAD.left + slot * (i + 0.5);

  const msgTicks = niceTicks(Math.max(...series.map((p) => p.messages)));
  const tokTicks = niceTicks(Math.max(...series.map((p) => p.tokens)));
  const msgMax = msgTicks[msgTicks.length - 1];
  const tokMax = tokTicks[tokTicks.length - 1];
  const msgY = (v: number) => MSG_TOP + MSG_H - (v / msgMax) * MSG_H;
  const tokY = (v: number) => TOK_TOP + TOK_H - (v / tokMax) * TOK_H;

  const linePts = series.map((p, i) => [xCenter(i), tokY(p.tokens)] as const);
  const linePath = linePts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L${linePts[n - 1][0].toFixed(1)} ${TOK_TOP + TOK_H} L${linePts[0][0].toFixed(1)} ${TOK_TOP + TOK_H} Z`;

  const gridStyle = { stroke: "var(--color-border)", strokeWidth: 1 };
  const textStyle = { fill: "var(--color-muted)", fontSize: 11 };

  return (
    <svg
      width="100%"
      height={H}
      viewBox={`0 0 ${width} ${H}`}
      role="img"
      aria-label="Daily messages and AI tokens"
      className="block select-none"
    >
      {/* gridlines + y ticks, both panels */}
      {msgTicks.map((t) => (
        <g key={`m${t}`}>
          <line
            x1={PAD.left}
            x2={width - PAD.right}
            y1={msgY(t)}
            y2={msgY(t)}
            style={gridStyle}
          />
          <text
            x={PAD.left - 6}
            y={msgY(t) + 3.5}
            textAnchor="end"
            style={textStyle}
          >
            {compact(t)}
          </text>
        </g>
      ))}
      {tokTicks.map((t) => (
        <g key={`t${t}`}>
          <line
            x1={PAD.left}
            x2={width - PAD.right}
            y1={tokY(t)}
            y2={tokY(t)}
            style={gridStyle}
          />
          <text
            x={PAD.left - 6}
            y={tokY(t) + 3.5}
            textAnchor="end"
            style={textStyle}
          >
            {compact(t)}
          </text>
        </g>
      ))}
      {/* panel captions, top-right so they never touch the top tick label */}
      <text
        x={width - PAD.right}
        y={MSG_TOP - 1}
        textAnchor="end"
        style={{ ...textStyle, fontSize: 10 }}
      >
        Messages
      </text>
      <text
        x={width - PAD.right}
        y={TOK_TOP - 5}
        textAnchor="end"
        style={{ ...textStyle, fontSize: 10 }}
      >
        Tokens
      </text>

      {/* messages: stacked bars, 2px surface gap between segments */}
      {series.map((p, i) => {
        const x = xCenter(i) - barW / 2;
        const base = MSG_TOP + MSG_H;
        const inH = (p.inbound / msgMax) * MSG_H;
        const outH = (p.outbound / msgMax) * MSG_H;
        const dim = hover != null && hover !== i ? 0.55 : 1;
        return (
          <g key={p.day} opacity={dim}>
            {inH > 0 && (
              <path
                d={barPath(x, base - inH, barW, inH, outH > 0 ? 0 : 4)}
                fill="var(--color-brand)"
              />
            )}
            {outH > 0 && (
              <path
                d={barPath(
                  x,
                  base - inH - outH,
                  barW,
                  Math.max(0.5, outH - (inH > 0 ? 2 : 0)),
                  4,
                )}
                fill="var(--color-info)"
              />
            )}
          </g>
        );
      })}

      {/* tokens: line + wash */}
      <path d={areaPath} fill="var(--color-warning)" opacity={0.1} />
      <path
        d={linePath}
        fill="none"
        stroke="var(--color-warning)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* baselines */}
      <line
        x1={PAD.left}
        x2={width - PAD.right}
        y1={MSG_TOP + MSG_H}
        y2={MSG_TOP + MSG_H}
        style={gridStyle}
      />
      <line
        x1={PAD.left}
        x2={width - PAD.right}
        y1={TOK_TOP + TOK_H}
        y2={TOK_TOP + TOK_H}
        style={gridStyle}
      />

      {/* x labels */}
      {series.map((p, i) =>
        (n - 1 - i) % LABEL_EVERY === 0 ? (
          <text
            key={p.day}
            x={xCenter(i)}
            y={H - 6}
            textAnchor="middle"
            style={textStyle}
          >
            {dayMonth(p.day)}
          </text>
        ) : null,
      )}

      {/* hover: crosshair + marker */}
      {hover != null && (
        <g pointerEvents="none">
          <line
            x1={xCenter(hover)}
            x2={xCenter(hover)}
            y1={MSG_TOP}
            y2={TOK_TOP + TOK_H}
            stroke="var(--color-muted)"
            strokeWidth={1}
            opacity={0.6}
          />
          <circle
            cx={linePts[hover][0]}
            cy={linePts[hover][1]}
            r={6}
            fill="var(--color-surface)"
          />
          <circle
            cx={linePts[hover][0]}
            cy={linePts[hover][1]}
            r={4}
            fill="var(--color-warning)"
          />
        </g>
      )}

      {/* hit targets: one full-height column per day */}
      {series.map((p, i) => (
        <rect
          key={p.day}
          x={PAD.left + slot * i}
          y={0}
          width={slot}
          height={H}
          fill="transparent"
          onMouseEnter={() => onHover(i)}
        />
      ))}
    </svg>
  );
}

function Tooltip({
  point,
  index,
  n,
}: {
  point: AdminTimeseriesPoint;
  index: number;
  n: number;
}) {
  // Anchor to the hovered column; flip to the left past the midpoint so it
  // never leaves the card.
  const pct = ((index + 0.5) / n) * 100;
  const flip = index > n / 2;
  return (
    <div
      className="pointer-events-none absolute top-2 z-10 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs shadow-lg"
      style={{
        left: `calc(${PAD.left}px + (100% - ${PAD.left + PAD.right}px) * ${pct / 100})`,
        transform: flip ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
      }}
    >
      <div className="mb-1 font-medium text-[var(--color-fg)]">
        {longDate(point.day)}
      </div>
      <div className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-[var(--color-muted)]">
        <span>Messages</span>
        <span className="text-right font-medium text-[var(--color-fg)]">
          {point.messages.toLocaleString("en-US")}
        </span>
        <span className="pl-3">Inbound</span>
        <span className="text-right">
          {point.inbound.toLocaleString("en-US")}
        </span>
        <span className="pl-3">Outbound</span>
        <span className="text-right">
          {point.outbound.toLocaleString("en-US")}
        </span>
        <span>Tokens</span>
        <span className="text-right font-medium text-[var(--color-fg)]">
          {point.tokens.toLocaleString("en-US")}
        </span>
      </div>
    </div>
  );
}

function LegendItem({
  swatch,
  line,
  children,
}: {
  swatch: string;
  line?: boolean;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className={line ? "h-0.5 w-3 rounded-full" : "h-2.5 w-2.5 rounded-sm"}
        style={{ background: swatch }}
      />
      {children}
    </span>
  );
}

// ---- helpers ----------------------------------------------------------------

/** Rect growing up from `y + h`, with only the top corners rounded. */
function barPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): string {
  const rr = Math.min(r, w / 2, h);
  if (rr <= 0) return `M${x} ${y}h${w}v${h}h${-w}Z`;
  return [
    `M${x} ${y + h}`,
    `v${-(h - rr)}`,
    `a${rr} ${rr} 0 0 1 ${rr} ${-rr}`,
    `h${w - 2 * rr}`,
    `a${rr} ${rr} 0 0 1 ${rr} ${rr}`,
    `v${h - rr}`,
    "Z",
  ].join(" ");
}

/** Four round tick values [0, s, 2s, 3s] with 3s >= max (max 0 → 0..3). */
function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1, 2, 3];
  const raw = max / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  return [0, step, step * 2, step * 3];
}

function compact(n: number): string {
  const fmt = (v: number, suffix: string) =>
    `${v >= 100 ? Math.round(v) : Number(v.toFixed(1))}${suffix}`;
  if (n >= 1_000_000) return fmt(n / 1_000_000, "M");
  if (n >= 1_000) return fmt(n / 1_000, "k");
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(1)));
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** 'YYYY-MM-DD' → '13 Sep' */
function dayMonth(day: string): string {
  const [, m, d] = day.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
}

/** 'YYYY-MM-DD' → 'Sat, 13 Sep 2026' (UTC) */
function longDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
