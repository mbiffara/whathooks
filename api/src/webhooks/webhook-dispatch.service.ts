import { Injectable, Logger } from '@nestjs/common';
import { Webhook } from '@prisma/client';
import { createHmac } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { applyPayloadMapping, isMappingRules } from './payload-mapping';

interface DispatchParams {
  organizationId: string;
  sessionId?: string | null;
  event: string;
  payload: Record<string, unknown>;
  messageId?: string | null;
}

@Injectable()
export class WebhookDispatchService {
  private readonly logger = new Logger(WebhookDispatchService.name);
  private readonly timeoutMs = 10_000;

  constructor(private readonly prisma: PrismaService) {}

  /** Deliver an event to every active webhook of the org that subscribes to it. */
  async dispatch(params: DispatchParams): Promise<void> {
    const hooks = await this.prisma.webhook.findMany({
      where: {
        organizationId: params.organizationId,
        active: true,
        OR: [{ sessionId: null }, { sessionId: params.sessionId ?? undefined }],
      },
    });

    await Promise.all(
      hooks
        .filter((h) => h.events.includes(params.event))
        .map((h) => this.deliver(h, params)),
    );
  }

  private async deliver(hook: Webhook, params: DispatchParams): Promise<void> {
    const envelope = {
      event: params.event,
      sessionId: params.sessionId ?? null,
      data: params.payload,
      timestamp: new Date().toISOString(),
    };
    // Per-webhook projection: when mapping rules exist, `data` carries only
    // the fields the customer configured (renames, formatted dates, fixed
    // values). The envelope itself is stable so signatures/tooling keep
    // working.
    const data = isMappingRules(hook.payloadMapping)
      ? applyPayloadMapping(hook.payloadMapping, envelope)
      : params.payload;
    const body = JSON.stringify({ ...envelope, data });
    const signature =
      'sha256=' + createHmac('sha256', hook.secret).update(body).digest('hex');

    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        webhookId: hook.id,
        messageId: params.messageId ?? null,
        event: params.event,
        payload: JSON.parse(body),
        attempts: 1,
      },
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(hook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Whathooks-Event': params.event,
          'X-Whathooks-Signature': signature,
          'X-Whathooks-Delivery': delivery.id,
        },
        body,
        signal: controller.signal,
      });
      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          responseStatus: res.status,
          deliveredAt: res.ok ? new Date() : null,
          lastError: res.ok ? null : `HTTP ${res.status}`,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'delivery failed';
      this.logger.warn(`Webhook ${hook.id} delivery failed: ${message}`);
      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { lastError: message },
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
