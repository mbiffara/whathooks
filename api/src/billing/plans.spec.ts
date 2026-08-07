import { Plan } from '@prisma/client';
import { PLANS, currentMonthStart, currentPeriod } from './plans';

describe('currentPeriod', () => {
  it('buckets by UTC calendar month, zero-padded', () => {
    expect(currentPeriod(new Date('2026-08-07T15:00:00Z'))).toBe('2026-08');
    expect(currentPeriod(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01');
    expect(currentPeriod(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12');
  });

  it('uses UTC, not the server timezone', () => {
    // 21:00 in UTC-3 on Aug 31 is already September in UTC: the meter must
    // roll over with the month the quota window uses, not with local time.
    const instant = new Date('2026-09-01T00:30:00Z');
    expect(currentPeriod(instant)).toBe('2026-09');
    expect(currentMonthStart(instant).toISOString()).toBe(
      '2026-09-01T00:00:00.000Z',
    );
  });

  it('agrees with the message-quota window it shares', () => {
    const now = new Date('2026-08-07T15:00:00Z');
    const start = currentMonthStart(now);
    expect(currentPeriod(start)).toBe(currentPeriod(now));
  });
});

describe('included AI allowances', () => {
  it('rises with the tier and is unlimited only for sponsored orgs', () => {
    expect(PLANS[Plan.STARTER].includedAiTokens).toBe(1_000_000);
    expect(PLANS[Plan.PRO].includedAiTokens).toBe(5_000_000);
    expect(PLANS[Plan.BUSINESS].includedAiTokens).toBe(10_000_000);
    expect(PLANS[Plan.SPONSORED].includedAiTokens).toBeNull();
  });

  it('defines an allowance for every plan', () => {
    for (const plan of Object.values(Plan)) {
      expect(PLANS[plan]).toHaveProperty('includedAiTokens');
    }
  });
});
