import {
  Controller,
  Get,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
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
    return {
      organizations,
      users,
      sessions,
      connected,
      conversations,
      messages,
      webhooks,
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
