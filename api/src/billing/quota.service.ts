import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Plan } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ACTIVE_SUBSCRIPTION_STATUSES,
  PLANS,
  TRIAL_LIMITS,
  currentMonthStart,
  planRequiresSubscription,
} from './plans';

/**
 * Enforces plan entitlements: monthly message cap (inbound + outbound),
 * connected-number cap, and the history-retention window. Read from the org's
 * current `plan`; limits live in plans.ts.
 *
 * Write actions (sending, connecting a number) additionally require an active
 * subscription unless the plan is comped (SPONSORED). Reads are never gated —
 * a lapsed org keeps its dashboard and history so it can resubscribe and pick
 * up where it left off.
 */
/** null-aware min: null means unlimited, so any number wins. */
function min(a: number | null, b: number): number {
  return a == null ? b : Math.min(a, b);
}

@Injectable()
export class QuotaService {
  constructor(private readonly prisma: PrismaService) {}

  private async orgBilling(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true, subscriptionStatus: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    const trialing = org.subscriptionStatus === 'trialing';
    const plan = PLANS[org.plan];
    // Trialing orgs get trial caps regardless of tier; history follows the
    // plan so nothing disappears when the trial converts.
    const limits = trialing
      ? {
          ...plan,
          messagesPerMonth: min(
            plan.messagesPerMonth,
            TRIAL_LIMITS.messagesPerMonth,
          ),
          waNumbers: min(plan.waNumbers, TRIAL_LIMITS.waNumbers),
        }
      : plan;
    return { ...org, trialing, limits };
  }

  /** Throw unless the org is comped or has a live subscription. */
  private assertSubscribed(org: {
    plan: Plan;
    subscriptionStatus: string | null;
  }): void {
    if (!planRequiresSubscription(org.plan)) return;
    if (
      org.subscriptionStatus &&
      ACTIVE_SUBSCRIPTION_STATUSES.includes(org.subscriptionStatus)
    ) {
      return;
    }
    throw new ForbiddenException(
      'An active subscription is required. Choose a plan in Billing to continue.',
    );
  }

  /** Messages counted against this month's cap (inbound + outbound). */
  async messageUsage(
    organizationId: string,
  ): Promise<{ used: number; limit: number | null }> {
    const { limits } = await this.orgBilling(organizationId);
    const used = await this.prisma.message.count({
      where: {
        organizationId,
        createdAt: { gte: currentMonthStart(new Date()) },
        // Internal team notes never touch WhatsApp — they're free.
        source: { not: 'NOTE' },
      },
    });
    return { used, limit: limits.messagesPerMonth };
  }

  /** Throw if the org may not send: no live subscription, or over the cap. */
  async assertCanSend(organizationId: string): Promise<void> {
    const org = await this.orgBilling(organizationId);
    this.assertSubscribed(org);
    const { used, limit } = await this.messageUsage(organizationId);
    if (limit != null && used >= limit) {
      throw new ForbiddenException(
        org.trialing
          ? `Trial message limit reached (${limit}). Full plan limits unlock when your trial converts.`
          : `Monthly message limit reached (${limit}). Upgrade your plan to send more.`,
      );
    }
  }

  /** Throw if the org may not connect another WhatsApp number. */
  async assertCanAddNumber(organizationId: string): Promise<void> {
    const org = await this.orgBilling(organizationId);
    this.assertSubscribed(org);
    const limit = org.limits.waNumbers;
    if (limit == null) return;
    const count = await this.prisma.waSession.count({
      where: { organizationId },
    });
    if (count >= limit) {
      throw new ForbiddenException(
        org.trialing
          ? `Trials include ${limit} WhatsApp number. Full plan limits unlock when your trial converts.`
          : `Your plan allows ${limit} WhatsApp number(s). Upgrade to add more.`,
      );
    }
  }

  /** Throw if the org may not register another webhook endpoint. */
  async assertCanAddWebhook(organizationId: string): Promise<void> {
    const org = await this.orgBilling(organizationId);
    this.assertSubscribed(org);
    const limit = org.limits.webhooks;
    if (limit == null) return;
    const count = await this.prisma.webhook.count({
      where: { organizationId },
    });
    if (count >= limit) {
      throw new ForbiddenException(
        `Your plan allows ${limit} webhook endpoint(s). Upgrade to add more.`,
      );
    }
  }

  /**
   * Earliest timestamp visible under the plan's retention window, or null when
   * history is unlimited. Use as a `createdAt >= …` filter on message reads.
   */
  async historyWindowStart(organizationId: string): Promise<Date | null> {
    const { limits } = await this.orgBilling(organizationId);
    if (limits.historyDays == null) return null;
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - limits.historyDays);
    return cutoff;
  }
}
