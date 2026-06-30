import {
  Controller,
  Get,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { readFileSync } from 'fs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionManagerService } from '../whatsapp/connection-manager.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly manager: ConnectionManagerService,
  ) {}

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
        _count: {
          select: {
            users: true,
            sessions: true,
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
      users: o._count.users,
      sessions: o._count.sessions,
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
        users: {
          select: { id: true, email: true, name: true, role: true, createdAt: true },
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
    return {
      id: org.id,
      name: org.name,
      createdAt: org.createdAt,
      users: org.users,
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
