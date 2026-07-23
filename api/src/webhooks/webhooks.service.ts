import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Webhook } from '@prisma/client';
import { randomBytes } from 'crypto';
import { QuotaService } from '../billing/quota.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateWebhookDto,
  MappingRuleDto,
  UpdateWebhookDto,
} from './dto/webhook.dto';
import { mappingRulesError } from './payload-mapping';

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
  ) {}

  async list(organizationId: string) {
    const hooks = await this.prisma.webhook.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return hooks.map((h) => this.toPublic(h));
  }

  async create(organizationId: string, dto: CreateWebhookDto) {
    await this.quota.assertCanAddWebhook(organizationId);
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
        payloadMapping: this.mappingInput(dto.payloadMapping),
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
        ...(dto.payloadMapping !== undefined
          ? { payloadMapping: this.mappingInput(dto.payloadMapping) }
          : {}),
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

  /** Validate + normalize mapping rules for the Json column. */
  private mappingInput(
    rules: MappingRuleDto[] | undefined,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (!rules || rules.length === 0) return Prisma.JsonNull;
    const error = mappingRulesError(rules);
    if (error) throw new BadRequestException(error);
    return rules as unknown as Prisma.InputJsonValue;
  }

  private toPublic(h: Webhook) {
    return {
      id: h.id,
      url: h.url,
      events: h.events,
      sessionId: h.sessionId,
      active: h.active,
      payloadMapping: h.payloadMapping ?? null,
      // mask the secret outside of creation
      secretHint: `${h.secret.slice(0, 12)}…`,
      createdAt: h.createdAt,
    };
  }
}
