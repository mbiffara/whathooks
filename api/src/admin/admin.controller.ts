import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { readFileSync } from 'fs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PLANS, TRIAL_LIMITS, currentMonthStart } from '../billing/plans';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionManagerService } from '../whatsapp/connection-manager.service';

export class WelcomeEmailDto {
  // Override the recipient's stored language for this send.
  @IsOptional()
  @IsIn(['en', 'es'])
  locale?: string;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly manager: ConnectionManagerService,
    private readonly mail: MailService,
  ) {}

  /** Manual founder welcome email, triggered from the admin console. */
  @Post('users/:id/welcome-email')
  async sendWelcomeEmail(
    @Param('id') id: string,
    @Body() dto: WelcomeEmailDto,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    const sent = await this.mail.sendWelcome({
      to: user.email,
      name: user.name,
      locale: dto.locale ?? user.locale,
    });
    if (sent) {
      await this.prisma.user.update({
        where: { id },
        data: { welcomeEmailSentAt: new Date() },
      });
    }
    return { sent, to: user.email };
  }

  @Get('overview')
  async overview() {
    const [
      organizations,
      users,
      sessions,
      connected,
      conversations,
      messages,
      webhooks,
    ] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.user.count(),
      this.prisma.waSession.count(),
      this.prisma.waSession.count({ where: { status: 'CONNECTED' } }),
      this.prisma.conversation.count(),
      this.prisma.message.count(),
      this.prisma.webhook.count(),
    ]);
    const limitMB = readMemoryLimitMB();
    const usedMB = Math.round(process.memoryUsage().rss / 1048576);
    return {
      organizations,
      users,
      sessions,
      connected,
      conversations,
      messages,
      webhooks,
      // Live gauge from the running API process (single task today).
      system: {
        liveSessions: this.manager.getLiveSessionCount(),
        memoryUsedMB: usedMB,
        memoryLimitMB: limitMB,
        memoryPercent: limitMB ? Math.round((usedMB / limitMB) * 100) : null,
        uptimeSeconds: Math.round(process.uptime()),
      },
    };
  }

  @Get('organizations')
  async organizations() {
    const orgs = await this.prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        memberships: {
          where: { role: 'OWNER' },
          take: 1,
          include: { user: true },
        },
        _count: {
          select: {
            memberships: true,
            sessions: true,
            agents: true,
            webhooks: true,
            conversations: true,
            messages: true,
          },
        },
      },
    });
    return orgs.map((o) => ({
      id: o.id,
      name: o.name,
      createdAt: o.createdAt,
      plan: o.plan,
      subscriptionStatus: o.subscriptionStatus,
      currentPeriodEnd: o.currentPeriodEnd,
      owner: o.memberships[0]
        ? {
            id: o.memberships[0].user.id,
            email: o.memberships[0].user.email,
            locale: o.memberships[0].user.locale,
            welcomeEmailSentAt: o.memberships[0].user.welcomeEmailSentAt,
          }
        : null,
      users: o._count.memberships,
      sessions: o._count.sessions,
      agents: o._count.agents,
      webhooks: o._count.webhooks,
      conversations: o._count.conversations,
      messages: o._count.messages,
    }));
  }

  @Get('organizations/:id')
  async organization(@Param('id') id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        memberships: {
          include: { user: true },
          orderBy: { createdAt: 'asc' },
        },
        sessions: {
          select: {
            id: true,
            label: true,
            status: true,
            phoneNumber: true,
            lastConnectedAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        webhooks: {
          select: {
            id: true,
            url: true,
            events: true,
            active: true,
            sessionId: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        apiKeys: {
          select: {
            id: true,
            name: true,
            prefix: true,
            lastUsedAt: true,
            revokedAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: { conversations: true, messages: true },
        },
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    // This month's message usage against the effective cap (trial caps apply
    // while the subscription is trialing).
    const used = await this.prisma.message.count({
      where: {
        organizationId: id,
        createdAt: { gte: currentMonthStart(new Date()) },
        source: { not: 'NOTE' },
      },
    });
    const planLimit = PLANS[org.plan].messagesPerMonth;
    const trialing = org.subscriptionStatus === 'trialing';
    const limit =
      trialing && planLimit != null
        ? Math.min(planLimit, TRIAL_LIMITS.messagesPerMonth)
        : trialing
          ? TRIAL_LIMITS.messagesPerMonth
          : planLimit;
    return {
      id: org.id,
      name: org.name,
      createdAt: org.createdAt,
      billing: {
        plan: org.plan,
        planLabel: PLANS[org.plan].label,
        subscriptionStatus: org.subscriptionStatus,
        currentPeriodEnd: org.currentPeriodEnd,
        stripeCustomerId: org.stripeCustomerId,
        stripeSubscriptionId: org.stripeSubscriptionId,
        usage: { used, limit },
      },
      users: org.memberships.map((m) => ({
        id: m.user.id,
        email: m.user.email,
        name: m.user.name,
        role: m.user.role,
        locale: m.user.locale,
        orgRole: m.role,
        welcomeEmailSentAt: m.user.welcomeEmailSentAt,
        createdAt: m.user.createdAt,
      })),
      sessions: org.sessions,
      webhooks: org.webhooks,
      apiKeys: org.apiKeys,
      counts: {
        conversations: org._count.conversations,
        messages: org._count.messages,
      },
    };
  }
}

// Container memory limit from cgroup (v2 then v1), so the admin gauge can show a
// percentage. Returns null when unbounded / unavailable (e.g. local dev).
function readMemoryLimitMB(): number | null {
  const files = [
    '/sys/fs/cgroup/memory.max', // cgroup v2
    '/sys/fs/cgroup/memory/memory.limit_in_bytes', // cgroup v1
  ];
  for (const f of files) {
    try {
      const raw = readFileSync(f, 'utf8').trim();
      if (raw === 'max') continue;
      const bytes = Number(raw);
      // ignore the "unlimited" sentinel (a huge number) cgroup v1 reports
      if (Number.isFinite(bytes) && bytes > 0 && bytes < 1e12) {
        return Math.round(bytes / 1048576);
      }
    } catch {
      /* not available */
    }
  }
  return null;
}
