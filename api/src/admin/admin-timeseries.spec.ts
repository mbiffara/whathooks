import {
  buildTimeseries,
  clampDays,
  DEFAULT_DAYS,
  MAX_DAYS,
  MIN_DAYS,
  windowStart,
} from './admin-timeseries';

const now = new Date('2026-09-13T15:42:10Z');

describe('clampDays', () => {
  it('defaults to 30 when missing or unparsable', () => {
    expect(clampDays(undefined)).toBe(DEFAULT_DAYS);
    expect(clampDays('abc')).toBe(DEFAULT_DAYS);
    expect(clampDays('')).toBe(DEFAULT_DAYS);
    expect(clampDays('0')).toBe(DEFAULT_DAYS);
    expect(clampDays('-4')).toBe(DEFAULT_DAYS);
  });

  it('clamps into [7, 90]', () => {
    expect(clampDays('7')).toBe(7);
    expect(clampDays('3')).toBe(MIN_DAYS);
    expect(clampDays('500')).toBe(MAX_DAYS);
    expect(clampDays('45')).toBe(45);
    expect(clampDays('12.9')).toBe(12);
  });
});

describe('windowStart', () => {
  it('is UTC midnight of (today - days + 1)', () => {
    expect(windowStart(30, now).toISOString()).toBe('2026-08-15T00:00:00.000Z');
    expect(windowStart(7, now).toISOString()).toBe('2026-09-07T00:00:00.000Z');
    expect(windowStart(1, now).toISOString()).toBe('2026-09-13T00:00:00.000Z');
  });
});

describe('buildTimeseries', () => {
  it('returns `days` consecutive UTC days ending today, zero-filled', () => {
    const ts = buildTimeseries({ days: 30, now, messages: [], tokens: [] });
    expect(ts.series).toHaveLength(30);
    expect(ts.series[0].day).toBe('2026-08-15');
    expect(ts.series[29].day).toBe('2026-09-13');
    expect(ts.from).toBe('2026-08-15T00:00:00.000Z');
    expect(ts.to).toBe(now.toISOString());
    // consecutive, crossing the month boundary
    for (let i = 1; i < ts.series.length; i++) {
      const prev = Date.parse(ts.series[i - 1].day);
      const cur = Date.parse(ts.series[i].day);
      expect(cur - prev).toBe(86_400_000);
    }
    expect(ts.series.every((p) => p.messages === 0 && p.tokens === 0)).toBe(
      true,
    );
    expect(ts.totals).toEqual({
      messages: 0,
      inbound: 0,
      outbound: 0,
      tokens: 0,
    });
  });

  it('attaches rows to their day and sums totals', () => {
    const ts = buildTimeseries({
      days: 7,
      now,
      messages: [
        { day: '2026-09-10', total: 5, inbound: 3, outbound: 2 },
        { day: '2026-09-13', total: 1, inbound: 0, outbound: 1 },
      ],
      tokens: [
        // two rows the same day (with and without agentId) add up
        { day: new Date('2026-09-10T00:00:00Z'), tokens: 1_000 },
        { day: new Date('2026-09-10T00:00:00Z'), tokens: 250 },
        { day: new Date('2026-09-12T00:00:00Z'), tokens: 40 },
      ],
    });
    expect(ts.series.map((p) => p.day)).toEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
    ]);
    expect(ts.series[3]).toEqual({
      day: '2026-09-10',
      messages: 5,
      inbound: 3,
      outbound: 2,
      tokens: 1_250,
    });
    expect(ts.series[4]).toEqual({
      day: '2026-09-11',
      messages: 0,
      inbound: 0,
      outbound: 0,
      tokens: 0,
    });
    expect(ts.series[5].tokens).toBe(40);
    expect(ts.series[6].messages).toBe(1);
    expect(ts.totals).toEqual({
      messages: 6,
      inbound: 3,
      outbound: 3,
      tokens: 1_290,
    });
    for (const p of ts.series) {
      expect(p.inbound + p.outbound).toBe(p.messages);
    }
  });

  it('ignores rows outside the window', () => {
    const ts = buildTimeseries({
      days: 7,
      now,
      messages: [{ day: '2026-09-01', total: 9, inbound: 9, outbound: 0 }],
      tokens: [{ day: new Date('2026-09-01T00:00:00Z'), tokens: 99 }],
    });
    expect(ts.totals.messages).toBe(0);
    expect(ts.totals.tokens).toBe(0);
  });
});
