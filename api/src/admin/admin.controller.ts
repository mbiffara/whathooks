import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('overview')
  async overview() {
    const [organizations, users, sessions, connected, messages, webhooks] =
      await Promise.all([
        this.prisma.organization.count(),
        this.prisma.user.count(),
        this.prisma.waSession.count(),
        this.prisma.waSession.count({ where: { status: 'CONNECTED' } }),
        this.prisma.messageLog.count(),
        this.prisma.webhook.count(),
      ]);
    return { organizations, users, sessions, connected, messages, webhooks };
  }

  @Get('organizations')
  async organizations() {
    const orgs = await this.prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { users: true, sessions: true, webhooks: true, messages: true },
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
      messages: o._count.messages,
    }));
  }
}
