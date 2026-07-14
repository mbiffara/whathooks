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
  /** Monthly message cap (inbound + outbound). */
  messagesPerMonth: number;
  /** How far back message history is visible/retained; null = unlimited. */
  historyDays: number | null;
  /** Max connected WhatsApp numbers (sessions). */
  waNumbers: number;
  /** Env var holding the Stripe recurring Price id for this tier. */
  priceEnv: string;
}

export const PLANS: Record<Plan, PlanLimits> = {
  STARTER: {
    label: 'Starter',
    messagesPerMonth: 5_000,
    historyDays: 30,
    waNumbers: 1,
    priceEnv: 'STRIPE_PRICE_STARTER',
  },
  PRO: {
    label: 'Pro',
    messagesPerMonth: 10_000,
    historyDays: 90,
    waNumbers: 3,
    priceEnv: 'STRIPE_PRICE_PRO',
  },
  BUSINESS: {
    label: 'Business',
    messagesPerMonth: 100_000,
    historyDays: null,
    waNumbers: 10,
    priceEnv: 'STRIPE_PRICE_BUSINESS',
  },
};

/** Resolve a Stripe Price id back to its Plan (used by webhook handling). */
export function planForPriceId(
  priceId: string | null | undefined,
  env: Record<string, string | undefined>,
): Plan | null {
  if (!priceId) return null;
  for (const plan of Object.keys(PLANS) as Plan[]) {
    if (env[PLANS[plan].priceEnv] === priceId) return plan;
  }
  return null;
}

/** Start of the current UTC calendar month — the message-quota window. */
export function currentMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
