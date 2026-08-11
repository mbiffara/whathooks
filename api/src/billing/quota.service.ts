import {
  ForbiddenException,
  Logger,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Plan } from '@prisma/client';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ACTIVE_SUBSCRIPTION_STATUSES,
  PLANS,
  TRIAL_LIMITS,
  currentMonthStart,
  currentPeriod,
  LOW_TOKENS_THRESHOLD,
  startOfUtcDay,
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
  private readonly log = new Logger(QuotaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  private async orgBilling(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        plan: true,
        subscriptionStatus: true,
        messageLimitOverride: true,
        instagramSeats: true,
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    const trialing = org.subscriptionStatus === 'trialing';
    const plan = PLANS[org.plan];
    // Trialing orgs get trial caps regardless of tier; history follows the
    // plan so nothing disappears when the trial converts.
    const limits: (typeof PLANS)[keyof typeof PLANS] = trialing
      ? {
          ...plan,
          messagesPerMonth: min(
            plan.messagesPerMonth,
            TRIAL_LIMITS.messagesPerMonth,
          ),
          waNumbers:
            TRIAL_LIMITS.waNumbers == null
              ? plan.waNumbers
              : min(plan.waNumbers, TRIAL_LIMITS.waNumbers),
        }
      : // Copy, never the shared PLANS entry: the override below writes into
        // this object, and mutating the singleton would leak one org's limit
        // onto every other org on the same tier for the life of the process.
        { ...plan };
    // A manual admin override beats both the plan and the trial cap.
    if (org.messageLimitOverride != null) {
      limits.messagesPerMonth = org.messageLimitOverride;
    }
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

  /**
   * Included-AI tokens burnt this month, against the plan's allowance.
   * Unlike messages this cannot be counted from existing rows, so runs
   * record it as they go (see recordAiTokens).
   */
  async aiTokenUsage(
    organizationId: string,
  ): Promise<{ used: number; limit: number | null }> {
    const { limits } = await this.orgBilling(organizationId);
    const row = await this.prisma.aiTokenUsage.findUnique({
      where: {
        organizationId_period: {
          organizationId,
          period: currentPeriod(new Date()),
        },
      },
      select: { tokens: true },
    });
    return { used: row?.tokens ?? 0, limit: limits.includedAiTokens };
  }

  /** Purchased tokens still unspent. These carry over between months. */
  async paidAiTokens(organizationId: string): Promise<number> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { paidAiTokens: true },
    });
    return org?.paidAiTokens ?? 0;
  }

  /** True while the org can still run an included-AI agent. */
  async hasIncludedAiBudget(organizationId: string): Promise<boolean> {
    const { used, limit } = await this.aiTokenUsage(organizationId);
    if (limit == null || used < limit) return true;
    return (await this.paidAiTokens(organizationId)) > 0;
  }

  /**
   * Book a run's tokens. The plan's monthly allowance is always spent first;
   * only the overflow draws down purchased tokens, which is what makes
   * "monthly tokens don't carry over, purchased ones do" true without a
   * separate expiry job.
   *
   * Best-effort by design: the reply has already been generated and paid for
   * by the time this runs, so a failure here must never surface to the
   * caller. Returns how the spend was split, for the low-balance check.
   */
  async recordAiTokens(
    organizationId: string,
    tokens: number,
    agentId?: string,
  ): Promise<void> {
    if (tokens <= 0) return;
    try {
      const now = new Date();
      const period = currentPeriod(now);
      const { used, limit } = await this.aiTokenUsage(organizationId);
      const freeLeft = limit == null ? tokens : Math.max(0, limit - used);
      const fromFree = Math.min(tokens, freeLeft);
      const fromPaid = tokens - fromFree;

      if (fromFree > 0) {
        await this.prisma.aiTokenUsage.upsert({
          where: { organizationId_period: { organizationId, period } },
          create: { organizationId, period, tokens: fromFree },
          update: { tokens: { increment: fromFree } },
        });
      }
      if (fromPaid > 0) {
        // Floor at zero: a run that overshoots the balance must not leave a
        // negative one that a later purchase would silently pay off.
        await this.prisma.organization.update({
          where: { id: organizationId },
          data: { paidAiTokens: { decrement: fromPaid } },
        });
        await this.prisma.organization.updateMany({
          where: { id: organizationId, paidAiTokens: { lt: 0 } },
          data: { paidAiTokens: 0 },
        });
      }
      // Reporting rows count every token, whichever bucket paid for it. The
      // compound unique includes a nullable agentId, which Prisma cannot use
      // in upsert, so this is a find-then-write.
      const day = startOfUtcDay(now);
      const existing = await this.prisma.aiTokenDailyUsage.findFirst({
        where: { organizationId, agentId: agentId ?? null, day },
        select: { id: true },
      });
      if (existing) {
        await this.prisma.aiTokenDailyUsage.update({
          where: { id: existing.id },
          data: { tokens: { increment: tokens } },
        });
      } else {
        await this.prisma.aiTokenDailyUsage.create({
          data: { organizationId, agentId: agentId ?? null, day, tokens },
        });
      }
      await this.maybeWarnLowTokens(organizationId, period);
    } catch (e) {
      this.log.warn(`AI token metering failed for ${organizationId}: ${e}`);
    }
  }

  /**
   * Email the owners once per month when the allowance drops to the warning
   * threshold. Skipped when purchased tokens are on hand, since those cover
   * the shortfall and nothing is about to stop working.
   */
  private async maybeWarnLowTokens(
    organizationId: string,
    period: string,
  ): Promise<void> {
    const { used, limit } = await this.aiTokenUsage(organizationId);
    if (limit == null) return;
    if (limit - used > Math.ceil(limit * LOW_TOKENS_THRESHOLD)) return;
    if ((await this.paidAiTokens(organizationId)) > 0) return;

    // Claim the slot first: two concurrent runs must not both send.
    const claimed = await this.prisma.aiTokenUsage.updateMany({
      where: { organizationId, period, lowAlertSentAt: null },
      data: { lowAlertSentAt: new Date() },
    });
    if (claimed.count === 0) return;

    const owners = await this.prisma.membership.findMany({
      where: { organizationId, role: 'OWNER' },
      select: { user: { select: { email: true, locale: true } } },
    });
    const billingUrl = `${process.env.WEB_ORIGIN ?? ''}/dashboard/billing`;
    for (const o of owners) {
      await this.mail
        .sendLowAiTokens({
          to: o.user.email,
          locale: o.user.locale,
          used,
          limit,
          billingUrl,
        })
        .catch((e) => this.log.warn(`Low-token email failed: ${e}`));
    }
  }

  /**
   * Credit a token-pack purchase. Idempotent on the Stripe session id, since
   * checkout.session.completed can be delivered more than once.
   */
  async creditAiTokens(
    organizationId: string,
    opts: {
      tokens: number;
      amountCents: number;
      currency: string;
      stripeSessionId: string;
    },
  ): Promise<boolean> {
    const existing = await this.prisma.aiTokenPurchase.findUnique({
      where: { stripeSessionId: opts.stripeSessionId },
      select: { id: true },
    });
    if (existing) return false;
    await this.prisma.$transaction([
      this.prisma.aiTokenPurchase.create({
        data: { organizationId, ...opts },
      }),
      this.prisma.organization.update({
        where: { id: organizationId },
        data: { paidAiTokens: { increment: opts.tokens } },
      }),
    ]);
    return true;
  }

  /**
   * The full AI-token picture for the dashboard: this month's allowance use,
   * the carried-over paid balance, and enough history for the usage table.
   */
  async aiTokenReport(organizationId: string, days = 30) {
    const [{ used, limit }, paid] = await Promise.all([
      this.aiTokenUsage(organizationId),
      this.paidAiTokens(organizationId),
    ]);
    const since = startOfUtcDay(new Date());
    since.setUTCDate(since.getUTCDate() - (days - 1));
    const rows = await this.prisma.aiTokenDailyUsage.findMany({
      where: { organizationId, day: { gte: since } },
      select: { day: true, tokens: true, agent: { select: { name: true } } },
      orderBy: { day: 'desc' },
    });

    const byDayMap = new Map<string, number>();
    const byAgentMap = new Map<string, number>();
    for (const r of rows) {
      const key = r.day.toISOString().slice(0, 10);
      byDayMap.set(key, (byDayMap.get(key) ?? 0) + r.tokens);
      const name = r.agent?.name ?? 'Deleted agent';
      byAgentMap.set(name, (byAgentMap.get(name) ?? 0) + r.tokens);
    }
    const remainingFree = limit == null ? null : Math.max(0, limit - used);
    return {
      included: { used, limit },
      paid,
      // Null limit means unlimited, which is never "low".
      low:
        limit != null &&
        paid === 0 &&
        remainingFree! <= Math.ceil(limit * LOW_TOKENS_THRESHOLD),
      byDay: [...byDayMap.entries()]
        .map(([day, tokens]) => ({ day, tokens }))
        .sort((a, b) => b.day.localeCompare(a.day)),
      byAgent: [...byAgentMap.entries()]
        .map(([name, tokens]) => ({ name, tokens }))
        .sort((a, b) => b.tokens - a.tokens),
    };
  }

  /** Token-pack purchases, newest first, for the billing history. */
  async aiTokenPurchases(organizationId: string) {
    return this.prisma.aiTokenPurchase.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        tokens: true,
        amountCents: true,
        currency: true,
        createdAt: true,
      },
    });
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
    // Scoped to WhatsApp: sessions on other channels are paid for separately
    // (Instagram by the seat add-on), so they must not eat a number allowance.
    const count = await this.prisma.waSession.count({
      where: { organizationId, channel: 'WHATSAPP' },
    });
    if (count >= limit) {
      throw new ForbiddenException(
        org.trialing
          ? `Trials include ${limit} WhatsApp number. Full plan limits unlock when your trial converts.`
          : `Your plan allows ${limit} WhatsApp number(s). Upgrade to add more.`,
      );
    }
  }

  /**
   * Throw unless the org has a paid, unused Instagram seat.
   *
   * Unlike every other gate here the ceiling is *purchased*, not a plan
   * constant: seats come from the Stripe subscription item quantity, written
   * only by the billing webhook. Comped orgs skip the check entirely, matching
   * how `assertSubscribed` treats them.
   */
  async assertCanAddInstagramAccount(organizationId: string): Promise<void> {
    const org = await this.orgBilling(organizationId);
    this.assertSubscribed(org);
    if (!planRequiresSubscription(org.plan)) return; // SPONSORED: unlimited
    const count = await this.prisma.waSession.count({
      where: { organizationId, channel: 'INSTAGRAM' },
    });
    if (count >= org.instagramSeats) {
      throw new ForbiddenException(
        org.instagramSeats === 0
          ? 'Add an Instagram account to your subscription to connect one.'
          : `You are paying for ${org.instagramSeats} Instagram account(s) and all are connected. Add another to connect more.`,
      );
    }
  }

  /** Throw if the org may not create another flow (drafts included). */
  async assertCanAddFlow(organizationId: string): Promise<void> {
    const org = await this.orgBilling(organizationId);
    this.assertSubscribed(org);
    const limit = org.limits.flows;
    if (limit == null) return;
    const count = await this.prisma.flow.count({ where: { organizationId } });
    if (count >= limit) {
      throw new ForbiddenException(
        `Your plan allows ${limit} flow(s). Upgrade to add more.`,
      );
    }
  }

  /** Throw if the org may not add another human agent. */
  async assertCanAddHumanAgent(organizationId: string): Promise<void> {
    const org = await this.orgBilling(organizationId);
    this.assertSubscribed(org);
    const limit = org.limits.humanAgents;
    if (limit == null) return;
    const count = await this.prisma.humanAgent.count({
      where: { organizationId },
    });
    if (count >= limit) {
      throw new ForbiddenException(
        `Your plan allows ${limit} human agent(s). Upgrade to add more.`,
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
