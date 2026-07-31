import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Patch,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';
import { readFileSync } from 'fs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PLANS, TRIAL_LIMITS, currentMonthStart } from '../billing/plans';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionManagerService } from '../whatsapp/connection-manager.service';

export class OrgLimitsDto {
  // null clears the override (back to plan/trial defaults)
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  messageLimitOverride?: number | null;
}

export class WelcomeEmailDto {
  // Override the recipient's stored language for this send.
  @IsOptional()
  @IsIn(['en', 'es'])
  locale?: string;
}

export class CreateMirrorLinkDto {
  @IsString()
  sessionId!: string;

  // Rep phone: digits with country code, no +.
  @Matches(/^\d{7,15}$/, {
    message: 'repNumber must be digits with country code, no +',
  })
  repNumber!: string;
}

export class UpdateMirrorLinkDto {
  @IsBoolean()
  enabled!: boolean;
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

  // ---- Mirror links (experimental lead-protection relay) ----

  @Get('mirror-links')
  async mirrorLinks() {
    const [links, sessions] = await Promise.all([
      this.prisma.mirrorLink.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          session: {
            select: {
              id: true,
              label: true,
              phoneNumber: true,
              status: true,
              organization: { select: { name: true } },
            },
          },
          _count: { select: { threads: true } },
        },
      }),
      this.prisma.waSession.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          label: true,
          phoneNumber: true,
          status: true,
          organization: { select: { name: true } },
        },
      }),
    ]);
    return {
      links: links.map((l) => ({
        id: l.id,
        enabled: l.enabled,
        repNumber: l.repNumber,
        createdAt: l.createdAt,
        threads: l._count.threads,
        session: {
          id: l.session.id,
          label: l.session.label,
          phoneNumber: l.session.phoneNumber,
          status: l.session.status,
        },
        organization: l.session.organization.name,
      })),
      sessions: sessions.map((s) => ({
        id: s.id,
        label: s.label,
        phoneNumber: s.phoneNumber,
        status: s.status,
        organization: s.organization.name,
      })),
    };
  }

  @Post('mirror-links')
  async createMirrorLink(@Body() dto: CreateMirrorLinkDto) {
    const session = await this.prisma.waSession.findUnique({
      where: { id: dto.sessionId },
    });
    if (!session) throw new NotFoundException('Session not found');
    const existing = await this.prisma.mirrorLink.findUnique({
      where: { sessionId: dto.sessionId },
    });
    if (existing) {
      throw new ConflictException('This session already has a mirror link');
    }
    if (session.phoneNumber === dto.repNumber) {
      throw new BadRequestException(
        'The rep number cannot be the session number itself',
      );
    }
    return this.prisma.mirrorLink.create({
      data: { sessionId: dto.sessionId, repNumber: dto.repNumber },
    });
  }

  @Patch('mirror-links/:id')
  async updateMirrorLink(
    @Param('id') id: string,
    @Body() dto: UpdateMirrorLinkDto,
  ) {
    const link = await this.prisma.mirrorLink.findUnique({ where: { id } });
    if (!link) throw new NotFoundException('Mirror link not found');
    return this.prisma.mirrorLink.update({
      where: { id },
      data: { enabled: dto.enabled },
    });
  }

  @Delete('mirror-links/:id')
  async deleteMirrorLink(@Param('id') id: string) {
    const { count } = await this.prisma.mirrorLink.deleteMany({
      where: { id },
    });
    if (!count) throw new NotFoundException('Mirror link not found');
    return { ok: true };
  }

  /** Set/clear a manual monthly message cap for one org. */
  @Patch('organizations/:id/limits')
  async setOrgLimits(@Param('id') id: string, @Body() dto: OrgLimitsDto) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found');
    const updated = await this.prisma.organization.update({
      where: { id },
      data: {
        ...(dto.messageLimitOverride !== undefined
          ? { messageLimitOverride: dto.messageLimitOverride }
          : {}),
      },
    });
    return { ok: true, messageLimitOverride: updated.messageLimitOverride };
  }

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
      org.messageLimitOverride ??
      (trialing && planLimit != null
        ? Math.min(planLimit, TRIAL_LIMITS.messagesPerMonth)
        : trialing
          ? TRIAL_LIMITS.messagesPerMonth
          : planLimit);
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
        messageLimitOverride: org.messageLimitOverride,
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
