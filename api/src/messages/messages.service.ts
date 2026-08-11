import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { QuotaService } from '../billing/quota.service';
import { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelRouterService } from '../channels/channel-router.service';
import { SendMessageDto } from './dto/send-message.dto';

const MAX_MEDIA_BYTES = 64 * 1024 * 1024; // 64 MB

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelRouterService,
    private readonly quota: QuotaService,
    private readonly media: MediaService,
  ) {}

  async send(organizationId: string, dto: SendMessageDto) {
    await this.quota.assertCanSend(organizationId);
    const session = await this.prisma.waSession.findFirst({
      where: { id: dto.sessionId, organizationId },
    });
    if (!session) throw new NotFoundException('Session not found');
    const driver = this.channels.driverFor(session.channel);
    if (session.status !== 'CONNECTED' || !driver.isLive(session.id)) {
      throw new BadRequestException('Session is not connected');
    }
    if (!dto.text && !dto.mediaUrl) {
      throw new BadRequestException('Provide text or mediaUrl');
    }

    if (dto.mediaUrl) {
      const file = await fetchRemoteMedia(dto.mediaUrl, dto.fileName);
      const result = await driver.sendMedia(
        session.id,
        dto.to,
        file,
        dto.text,
        { source: 'API' },
      );
      return {
        id: result.messageId,
        waMessageId: result.waMessageId,
        sessionId: session.id,
        to: dto.to,
        type: 'media',
        mediaUrl: result.mediaUrl,
        status: 'SENT',
      };
    }

    const result = await driver.sendText(session.id, dto.to, dto.text!, {
      source: 'API',
    });
    return {
      id: result.messageId,
      waMessageId: result.waMessageId,
      sessionId: session.id,
      to: dto.to,
      type: 'text',
      status: 'SENT',
    };
  }

  /** Flat recent message list (for the dashboard message log). */
  async list(
    organizationId: string,
    opts: { sessionId?: string; limit?: number; allowed?: string[] | null },
  ) {
    const since = await this.quota.historyWindowStart(organizationId);
    const rows = await this.prisma.message.findMany({
      where: {
        organizationId,
        sessionId: opts.allowed
          ? opts.sessionId && opts.allowed.includes(opts.sessionId)
            ? opts.sessionId
            : { in: opts.allowed }
          : opts.sessionId,
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      orderBy: { timestamp: 'desc' },
      take: Math.min(opts.limit ?? 50, 200),
      include: {
        conversation: { select: { remoteJid: true, name: true } },
        media: true,
      },
    });
    return Promise.all(
      rows.map(async (m) => ({
        id: m.id,
        sessionId: m.sessionId,
        direction: m.direction,
        remoteJid: m.conversation.remoteJid,
        contactName: m.conversation.name,
        type: m.type,
        text: m.text,
        status: m.status,
        createdAt: m.createdAt,
        media: m.media
          ? {
              url: await this.media.viewUrl(
                m.media.storageKey,
                m.media.mimeType,
                m.media.fileName ?? undefined,
              ),
              mimeType: m.media.mimeType,
              fileName: m.media.fileName,
              size: m.media.size,
            }
          : null,
      })),
    );
  }
}

async function fetchRemoteMedia(
  url: string,
  fileName?: string,
): Promise<{ buffer: Buffer; mimeType: string; fileName?: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new BadRequestException(
        `Could not fetch media (HTTP ${res.status})`,
      );
    }
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_MEDIA_BYTES) {
      throw new BadRequestException('Media exceeds 64MB limit');
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_MEDIA_BYTES) {
      throw new BadRequestException('Media exceeds 64MB limit');
    }
    const mimeType =
      res.headers.get('content-type')?.split(';')[0] ||
      'application/octet-stream';
    return {
      buffer,
      mimeType,
      fileName: fileName ?? url.split('/').pop()?.split('?')[0] ?? null,
    };
  } catch (e) {
    if (e instanceof BadRequestException) throw e;
    throw new BadRequestException('Could not fetch media URL');
  } finally {
    clearTimeout(timer);
  }
}
