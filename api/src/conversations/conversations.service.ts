import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Conversation, MediaAsset, Message } from '@prisma/client';
type MessageWithRelations = Message & {
  media: MediaAsset | null;
  agent: { name: string } | null;
};
import { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionManagerService } from '../whatsapp/connection-manager.service';

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly manager: ConnectionManagerService,
  ) {}

  async list(
    organizationId: string,
    opts: { sessionId?: string; limit?: number },
  ) {
    const rows = await this.prisma.conversation.findMany({
      where: {
        organizationId,
        sessionId: opts.sessionId,
        lastMessageAt: { not: null },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: Math.min(opts.limit ?? 100, 200),
    });
    return rows.map((c) => this.toConversationDto(c));
  }

  async get(organizationId: string, id: string) {
    const c = await this.requireConversation(organizationId, id);
    return this.toConversationDto(c);
  }

  async messages(
    organizationId: string,
    id: string,
    opts: { before?: string; limit?: number },
  ) {
    await this.requireConversation(organizationId, id);
    const limit = Math.min(opts.limit ?? 40, 100);
    const rows = await this.prisma.message.findMany({
      where: {
        conversationId: id,
        organizationId,
        ...(opts.before ? { timestamp: { lt: new Date(opts.before) } } : {}),
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
      include: { media: true, agent: { select: { name: true } } },
    });
    const items = await Promise.all(
      rows.reverse().map((m) => this.toMessageDto(m)),
    );
    return {
      items,
      hasMore: rows.length === limit,
      before: rows.length ? rows[0].timestamp.toISOString() : null,
    };
  }

  async markRead(organizationId: string, id: string) {
    await this.requireConversation(organizationId, id);
    await this.prisma.conversation.update({
      where: { id },
      data: { unreadCount: 0 },
    });
    return { ok: true };
  }

  async sendText(organizationId: string, id: string, text: string) {
    const c = await this.assertSendable(organizationId, id);
    const r = await this.manager.sendText(c.sessionId, c.remoteJid, text);
    return { id: r.messageId, waMessageId: r.waMessageId };
  }

  async sendMedia(
    organizationId: string,
    id: string,
    file: { buffer: Buffer; mimeType: string; fileName?: string | null },
    caption?: string,
  ) {
    const c = await this.assertSendable(organizationId, id);
    const r = await this.manager.sendMedia(
      c.sessionId,
      c.remoteJid,
      file,
      caption,
    );
    return { id: r.messageId, waMessageId: r.waMessageId, mediaUrl: r.mediaUrl };
  }

  private async assertSendable(organizationId: string, id: string) {
    const c = await this.requireConversation(organizationId, id);
    const session = await this.prisma.waSession.findUnique({
      where: { id: c.sessionId },
    });
    if (
      !session ||
      session.status !== 'CONNECTED' ||
      !this.manager.isLive(c.sessionId)
    ) {
      throw new BadRequestException('Session is not connected');
    }
    return c;
  }

  private async requireConversation(organizationId: string, id: string) {
    const c = await this.prisma.conversation.findFirst({
      where: { id, organizationId },
    });
    if (!c) throw new NotFoundException('Conversation not found');
    return c;
  }

  private toConversationDto(c: Conversation) {
    return {
      id: c.id,
      sessionId: c.sessionId,
      remoteJid: c.remoteJid,
      contact: c.remoteJid.split('@')[0],
      name: c.name,
      isGroup: c.isGroup,
      unreadCount: c.unreadCount,
      lastMessageAt: c.lastMessageAt,
      lastMessageText: c.lastMessageText,
      lastMessageType: c.lastMessageType,
    };
  }

  private async toMessageDto(m: MessageWithRelations) {
    let media: Record<string, unknown> | null = null;
    if (m.media) {
      media = {
        url: await this.media.viewUrl(
          m.media.storageKey,
          m.media.mimeType,
          m.media.fileName ?? undefined,
        ),
        mimeType: m.media.mimeType,
        fileName: m.media.fileName,
        width: m.media.width,
        height: m.media.height,
        durationSeconds: m.media.durationSeconds,
        size: m.media.size,
      };
    }
    return {
      id: m.id,
      direction: m.direction,
      fromMe: m.fromMe,
      source: m.source,
      agentName: m.agent?.name ?? null,
      type: m.type,
      text: m.text,
      status: m.status,
      timestamp: m.timestamp,
      media,
    };
  }
}
