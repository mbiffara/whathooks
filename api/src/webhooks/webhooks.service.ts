import { Injectable, NotFoundException } from '@nestjs/common';
import { Webhook } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWebhookDto, UpdateWebhookDto } from './dto/webhook.dto';

@Injectable()
export class WebhooksService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string) {
    const hooks = await this.prisma.webhook.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return hooks.map((h) => this.toPublic(h));
  }

  async create(organizationId: string, dto: CreateWebhookDto) {
    if (dto.sessionId) {
      const session = await this.prisma.waSession.findFirst({
        where: { id: dto.sessionId, organizationId },
      });
      if (!session) throw new NotFoundException('Session not found');
    }
    const hook = await this.prisma.webhook.create({
      data: {
        organizationId,
        url: dto.url,
        events: dto.events,
        sessionId: dto.sessionId ?? null,
        secret: `whsec_${randomBytes(24).toString('hex')}`,
      },
    });
    // Return the secret in full on creation so the client can store it.
    return { ...this.toPublic(hook), secret: hook.secret };
  }

  async update(organizationId: string, id: string, dto: UpdateWebhookDto) {
    await this.require(organizationId, id);
    const hook = await this.prisma.webhook.update({
      where: { id },
      data: {
        url: dto.url,
        events: dto.events,
        active: dto.active,
      },
    });
    return this.toPublic(hook);
  }

  async remove(organizationId: string, id: string) {
    await this.require(organizationId, id);
    await this.prisma.webhook.delete({ where: { id } });
    return { ok: true };
  }

  async deliveries(organizationId: string, id: string) {
    await this.require(organizationId, id);
    return this.prisma.webhookDelivery.findMany({
      where: { webhookId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  private async require(organizationId: string, id: string): Promise<Webhook> {
    const hook = await this.prisma.webhook.findFirst({
      where: { id, organizationId },
    });
    if (!hook) throw new NotFoundException('Webhook not found');
    return hook;
  }

  private toPublic(h: Webhook) {
    return {
      id: h.id,
      url: h.url,
      events: h.events,
      sessionId: h.sessionId,
      active: h.active,
      // mask the secret outside of creation
      secretHint: `${h.secret.slice(0, 12)}…`,
      createdAt: h.createdAt,
    };
  }
}
