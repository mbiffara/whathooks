import { Plan } from '@prisma/client';

/**
 * Entitlements per subscription tier. Kept in code (not the DB) so limits can
 * be tuned without a migration. `messagesPerMonth` counts both inbound and
 * outbound messages; `historyDays = null` means unlimited retention. The
 * Stripe price for each tier is resolved at runtime from an env var so test
 * and live keys can differ per deployment.
 */
export interface PlanLimits {
  /** Human label for UI. */
  label: string;
  /** Monthly message cap (inbound + outbound); null = unlimited. */
  messagesPerMonth: number | null;
  /** How far back message history is visible/retained; null = unlimited. */
  historyDays: number | null;
  /** Max connected WhatsApp numbers (sessions); null = unlimited. */
  waNumbers: number | null;
  /** Max users in the organization (members incl. owner); null = unlimited. */
  teamMembers: number | null;
  /** Max webhook endpoints; null = unlimited. */
  webhooks: number | null;
  /**
   * Env var holding the Stripe recurring Price id for this tier. Absent for
   * tiers that aren't purchasable (SPONSORED) — those also skip the
   * active-subscription requirement.
   */
  priceEnv?: string;
}

export const PLANS: Record<Plan, PlanLimits> = {
  STARTER: {
    label: 'Starter',
    messagesPerMonth: 5_000,
    historyDays: 30,
    waNumbers: 1,
    teamMembers: 2,
    webhooks: 1,
    priceEnv: 'STRIPE_PRICE_STARTER',
  },
  PRO: {
    label: 'Pro',
    messagesPerMonth: 10_000,
    historyDays: 90,
    waNumbers: 3,
    teamMembers: 10,
    webhooks: null,
    priceEnv: 'STRIPE_PRICE_PRO',
  },
  BUSINESS: {
    label: 'Business',
    messagesPerMonth: 100_000,
    historyDays: null,
    waNumbers: 10,
    teamMembers: null,
    webhooks: null,
    priceEnv: 'STRIPE_PRICE_BUSINESS',
  },
  SPONSORED: {
    label: 'Sponsored',
    messagesPerMonth: null,
    historyDays: null,
    waNumbers: null,
    teamMembers: null,
    webhooks: null,
  },
};

/** Subscription statuses that count as "paying" for quota purposes. `past_due`
 * is included so Stripe's dunning/retry cycle can run before access is cut. */
export const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due'];

/** Card-gated free trial on first subscription, any tier. */
export const TRIAL_DAYS = 7;

/**
 * Caps applied while a subscription is `trialing`, regardless of tier — enough
 * to feel the product, not enough to free-ride the infra. Plan limits take
 * over the moment the first invoice is paid.
 */
export const TRIAL_LIMITS = {
  messagesPerMonth: 300,
  waNumbers: 1,
} as const;

/** Whether this plan requires an active Stripe subscription to use the API. */
export function planRequiresSubscription(plan: Plan): boolean {
  return PLANS[plan].priceEnv !== undefined;
}

/** Resolve a Stripe Price id back to its Plan (used by webhook handling). */
export function planForPriceId(
  priceId: string | null | undefined,
  env: Record<string, string | undefined>,
): Plan | null {
  if (!priceId) return null;
  for (const plan of Object.keys(PLANS) as Plan[]) {
    const priceEnv = PLANS[plan].priceEnv;
    if (priceEnv && env[priceEnv] === priceId) return plan;
  }
  return null;
}

/** Start of the current UTC calendar month — the message-quota window. */
export function currentMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
