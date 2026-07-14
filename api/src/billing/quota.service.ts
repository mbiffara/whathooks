import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PLANS, currentMonthStart } from './plans';

/**
 * Enforces plan entitlements: monthly message cap (inbound + outbound),
 * connected-number cap, and the history-retention window. Read from the org's
 * current `plan`; limits live in plans.ts.
 */
@Injectable()
export class QuotaService {
  constructor(private readonly prisma: PrismaService) {}

  private async planLimits(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return PLANS[org.plan];
  }

  /** Messages counted against this month's cap (inbound + outbound). */
  async messageUsage(
    organizationId: string,
  ): Promise<{ used: number; limit: number }> {
    const limits = await this.planLimits(organizationId);
    const used = await this.prisma.message.count({
      where: {
        organizationId,
        createdAt: { gte: currentMonthStart(new Date()) },
      },
    });
    return { used, limit: limits.messagesPerMonth };
  }

  /** Throw if sending another message would exceed the monthly cap. */
  async assertCanSend(organizationId: string): Promise<void> {
    const { used, limit } = await this.messageUsage(organizationId);
    if (used >= limit) {
      throw new ForbiddenException(
        `Monthly message limit reached (${limit}). Upgrade your plan to send more.`,
      );
    }
  }

  /** Throw if connecting another WhatsApp number would exceed the cap. */
  async assertCanAddNumber(organizationId: string): Promise<void> {
    const limits = await this.planLimits(organizationId);
    const count = await this.prisma.waSession.count({
      where: { organizationId },
    });
    if (count >= limits.waNumbers) {
      throw new ForbiddenException(
        `Your plan allows ${limits.waNumbers} WhatsApp number(s). Upgrade to add more.`,
      );
    }
  }

  /**
   * Earliest timestamp visible under the plan's retention window, or null when
   * history is unlimited. Use as a `createdAt >= …` filter on message reads.
   */
  async historyWindowStart(organizationId: string): Promise<Date | null> {
    const limits = await this.planLimits(organizationId);
    if (limits.historyDays == null) return null;
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - limits.historyDays);
    return cutoff;
  }
}
