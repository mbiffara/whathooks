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
  /** Max human agents (WhatsApp-side reps); null = unlimited. */
  humanAgents: number | null;
  /** Max flows (drafts included); null = unlimited. */
  flows: number | null;
  /** Max webhook endpoints; null = unlimited. */
  webhooks: number | null;
  /**
   * Monthly tokens an agent may burn on the platform's OpenAI account
   * ("included AI"); null = unlimited. Agents on the org's own key are never
   * metered here. Tuned in code, so changing an allowance needs no migration.
   */
  includedAiTokens: number | null;
  /**
   * Env var holding the Stripe recurring Price id for this tier. Absent for
   * tiers that aren't purchasable (SPONSORED) — those also skip the
   * active-subscription requirement.
   */
  priceEnv?: string;
  /** Env var for the annual price (10 months for the price of 12). */
  annualPriceEnv?: string;
}

export const PLANS: Record<Plan, PlanLimits> = {
  STARTER: {
    label: 'Starter',
    messagesPerMonth: 5_000,
    historyDays: 30,
    waNumbers: 1,
    teamMembers: 2,
    humanAgents: 2,
    flows: 1,
    webhooks: 1,
    includedAiTokens: 1_000_000,
    priceEnv: 'STRIPE_PRICE_STARTER',
    annualPriceEnv: 'STRIPE_PRICE_STARTER_YEAR',
  },
  PRO: {
    label: 'Pro',
    messagesPerMonth: 10_000,
    historyDays: 90,
    waNumbers: 3,
    teamMembers: 10,
    humanAgents: 10,
    flows: 3,
    webhooks: null,
    includedAiTokens: 5_000_000,
    priceEnv: 'STRIPE_PRICE_PRO',
    annualPriceEnv: 'STRIPE_PRICE_PRO_YEAR',
  },
  BUSINESS: {
    label: 'Business',
    messagesPerMonth: 100_000,
    historyDays: null,
    waNumbers: 10,
    teamMembers: null,
    humanAgents: null,
    flows: null,
    webhooks: null,
    includedAiTokens: 10_000_000,
    priceEnv: 'STRIPE_PRICE_BUSINESS',
    annualPriceEnv: 'STRIPE_PRICE_BUSINESS_YEAR',
  },
  SPONSORED: {
    label: 'Sponsored',
    messagesPerMonth: null,
    historyDays: null,
    waNumbers: null,
    teamMembers: null,
    humanAgents: null,
    flows: null,
    webhooks: null,
    includedAiTokens: null,
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
  /** null = trials get their plan's number allowance (a Pro trial gets 3). */
  waNumbers: null as number | null,
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
    const { priceEnv, annualPriceEnv } = PLANS[plan];
    if (priceEnv && env[priceEnv] === priceId) return plan;
    if (annualPriceEnv && env[annualPriceEnv] === priceId) return plan;
  }
  return null;
}

/** Start of the current UTC calendar month — the message-quota window. */
export function currentMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * The AI-token meter's bucket key, "YYYY-MM" in UTC — same window as the
 * message quota, but stored rather than derived from row timestamps.
 */
export function currentPeriod(now: Date): string {
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${now.getUTCFullYear()}-${month}`;
}
