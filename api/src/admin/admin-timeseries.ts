/**
 * Daily platform-wide activity for the admin console chart. Pure helpers so the
 * windowing and zero-filling can be unit-tested without a database; the
 * controller only supplies the raw per-day rows.
 *
 * Days are UTC calendar days: `AiTokenDailyUsage.day` is already UTC midnight,
 * and `Message.createdAt` is truncated in SQL the same way.
 */

export const DEFAULT_DAYS = 30;
export const MIN_DAYS = 7;
export const MAX_DAYS = 90;

const DAY_MS = 86_400_000;

export interface DailyMessageRow {
  day: string; // 'YYYY-MM-DD'
  total: number;
  inbound: number;
  outbound: number;
}

export interface DailyTokenRow {
  day: Date;
  tokens: number;
}

export interface TimeseriesPoint {
  day: string; // 'YYYY-MM-DD' (UTC)
  messages: number;
  inbound: number;
  outbound: number;
  tokens: number;
}

export interface AdminTimeseries {
  days: number;
  from: string; // ISO, UTC midnight of the first day
  to: string; // ISO, when the series was computed
  series: TimeseriesPoint[];
  totals: Omit<TimeseriesPoint, 'day'>;
}

/** `?days=` query → integer in [MIN_DAYS, MAX_DAYS]; anything unparsable → default. */
export function clampDays(raw: string | undefined): number {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DAYS;
  return Math.min(MAX_DAYS, Math.max(MIN_DAYS, n));
}

export function startOfDayUTC(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

/** UTC midnight of the first day in a `days`-long window ending today. */
export function windowStart(days: number, now: Date): Date {
  return new Date(startOfDayUTC(now).getTime() - (days - 1) * DAY_MS);
}

export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Zero-fill every day of the window and attach the rows that exist. The result
 * always has exactly `days` consecutive entries, the last one being today (UTC).
 */
export function buildTimeseries(input: {
  days: number;
  now: Date;
  messages: DailyMessageRow[];
  tokens: DailyTokenRow[];
}): AdminTimeseries {
  const { days, now } = input;
  const from = windowStart(days, now);

  const msgByDay = new Map(input.messages.map((r) => [r.day, r]));
  const tokByDay = new Map<string, number>();
  for (const r of input.tokens) {
    const k = dayKey(r.day);
    tokByDay.set(k, (tokByDay.get(k) ?? 0) + r.tokens);
  }

  const series: TimeseriesPoint[] = [];
  const totals = { messages: 0, inbound: 0, outbound: 0, tokens: 0 };
  for (let i = 0; i < days; i++) {
    const day = dayKey(new Date(from.getTime() + i * DAY_MS));
    const m = msgByDay.get(day);
    const point: TimeseriesPoint = {
      day,
      messages: m?.total ?? 0,
      inbound: m?.inbound ?? 0,
      outbound: m?.outbound ?? 0,
      tokens: tokByDay.get(day) ?? 0,
    };
    series.push(point);
    totals.messages += point.messages;
    totals.inbound += point.inbound;
    totals.outbound += point.outbound;
    totals.tokens += point.tokens;
  }

  return {
    days,
    from: from.toISOString(),
    to: now.toISOString(),
    series,
    totals,
  };
}
