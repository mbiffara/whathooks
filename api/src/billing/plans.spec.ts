import { Plan } from '@prisma/client';
import {
  PAST_DUE_GRACE_DAYS,
  PLANS,
  currentMonthStart,
  currentPeriod,
  pastDueAccess,
} from './plans';

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

describe('pastDueAccess', () => {
  const now = new Date('2026-08-25T12:00:00Z');
  const day = 24 * 60 * 60 * 1000;

  it('does nothing unless the subscription is past due', () => {
    for (const status of ['active', 'trialing', 'canceled', null]) {
      expect(
        pastDueAccess(
          { subscriptionStatus: status, firstPaidAt: null, pastDueSince: now },
          now,
        ),
      ).toEqual({ trialCaps: false, blocked: false, graceEndsAt: null });
    }
  });

  it('keeps trial caps on a trial whose first charge bounced', () => {
    // The status is no longer `trialing`, but nobody has paid: without this
    // the declined card would unlock the full plan.
    const out = pastDueAccess(
      { subscriptionStatus: 'past_due', firstPaidAt: null, pastDueSince: now },
      now,
    );
    expect(out.trialCaps).toBe(true);
    expect(out.blocked).toBe(false);
  });

  it('lifts trial caps for a customer who has paid before', () => {
    const out = pastDueAccess(
      {
        subscriptionStatus: 'past_due',
        firstPaidAt: new Date('2026-05-01T00:00:00Z'),
        pastDueSince: now,
      },
      now,
    );
    expect(out.trialCaps).toBe(false);
  });

  it('blocks once the grace period is over, and not a moment before', () => {
    const since = new Date('2026-08-11T17:30:00Z');
    const graceEndsAt = new Date(since.getTime() + PAST_DUE_GRACE_DAYS * day);
    const org = {
      subscriptionStatus: 'past_due',
      firstPaidAt: since,
      pastDueSince: since,
    };
    expect(pastDueAccess(org, since).graceEndsAt).toEqual(graceEndsAt);
    expect(
      pastDueAccess(org, new Date(graceEndsAt.getTime() - 1)).blocked,
    ).toBe(false);
    expect(pastDueAccess(org, graceEndsAt).blocked).toBe(true);
  });

  it('never blocks when the transition was not recorded', () => {
    // Safety net for rows the migration did not reach: blocking on a guess
    // would cut off a customer with no date to point at.
    const out = pastDueAccess(
      { subscriptionStatus: 'past_due', firstPaidAt: now, pastDueSince: null },
      now,
    );
    expect(out.blocked).toBe(false);
    expect(out.graceEndsAt).toBeNull();
  });
});
