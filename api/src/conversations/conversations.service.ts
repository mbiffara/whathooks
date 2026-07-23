import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Conversation, MediaAsset, Message } from '@prisma/client';
type MessageWithRelations = Message & {
  media: MediaAsset | null;
  agent: { name: string } | null;
  sentBy?: { name: string | null; email: string } | null;
};
type ConversationWithAgent = Conversation & {
  session?: {
    agent: { id: string; name: string; enabled: boolean } | null;
  } | null;
  assignedTo?: { id: string; name: string | null; email: string } | null;
};
const AGENT_INCLUDE = {
  session: {
    select: {
      agent: { select: { id: true, name: true, enabled: true } },
    },
  },
  assignedTo: { select: { id: true, name: true, email: true } },
} as const;
import { QuotaService } from '../billing/quota.service';
import { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionManagerService } from '../whatsapp/connection-manager.service';

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly manager: ConnectionManagerService,
    private readonly quota: QuotaService,
  ) {}

  async list(
    organizationId: string,
    opts: {
      sessionId?: string;
      limit?: number;
      /** Free-text search: contact name, number, or message text. */
      q?: string;
      status?: 'OPEN' | 'RESOLVED' | 'ALL';
      assigned?: 'me' | 'unassigned' | 'all';
      userId?: string;
    },
  ) {
    const q = opts.q?.trim();
    const rows = await this.prisma.conversation.findMany({
      where: {
        organizationId,
        sessionId: opts.sessionId,
        lastMessageAt: { not: null },
        ...(opts.status && opts.status !== 'ALL'
          ? { status: opts.status }
          : {}),
        ...(opts.assigned === 'me' && opts.userId
          ? { assignedToUserId: opts.userId }
          : opts.assigned === 'unassigned'
            ? { assignedToUserId: null }
            : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { remoteJid: { contains: q } },
                {
                  messages: {
                    some: { text: { contains: q, mode: 'insensitive' } },
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: { lastMessageAt: 'desc' },
      take: Math.min(opts.limit ?? 100, 200),
      include: AGENT_INCLUDE,
    });
    return rows.map((c) => this.toConversationDto(c));
  }

  /** Assign to a teammate (null unassigns) and/or set open/resolved. */
  async update(
    organizationId: string,
    id: string,
    patch: {
      assignedToUserId?: string | null;
      status?: 'OPEN' | 'RESOLVED';
    },
  ) {
    await this.requireConversation(organizationId, id);
    if (patch.assignedToUserId) {
      const member = await this.prisma.membership.findUnique({
        where: {
          userId_organizationId: {
            userId: patch.assignedToUserId,
            organizationId,
          },
        },
      });
      if (!member) {
        throw new BadRequestException(
          'Assignee is not a member of this organization',
        );
      }
    }
    const updated = await this.prisma.conversation.update({
      where: { id },
      data: {
        ...(patch.assignedToUserId !== undefined
          ? { assignedToUserId: patch.assignedToUserId }
          : {}),
        ...(patch.status ? { status: patch.status } : {}),
      },
      include: AGENT_INCLUDE,
    });
    return this.toConversationDto(updated);
  }

  async get(organizationId: string, id: string) {
    const c = await this.requireConversation(organizationId, id, true);
    return this.toConversationDto(c);
  }

  /** Pause or resume the assigned agent's auto-replies for one conversation. */
  async setAgentPaused(organizationId: string, id: string, paused: boolean) {
    await this.requireConversation(organizationId, id);
    // A manual toggle has no handoff reason — clear any the agent left behind.
    await this.prisma.conversation.update({
      where: { id },
      data: { agentPaused: paused, agentPausedReason: null },
    });
    return { ok: true, agentPaused: paused };
  }

  async messages(
    organizationId: string,
    id: string,
    opts: { before?: string; limit?: number },
  ) {
    await this.requireConversation(organizationId, id);
    // Same retention window the flat message log applies (quota.service).
    const since = await this.quota.historyWindowStart(organizationId);
    const limit = Math.min(opts.limit ?? 40, 100);
    const rows = await this.prisma.message.findMany({
      where: {
        conversationId: id,
        organizationId,
        ...(since ? { createdAt: { gte: since } } : {}),
        ...(opts.before ? { timestamp: { lt: new Date(opts.before) } } : {}),
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
      include: {
        media: true,
        agent: { select: { name: true } },
        sentBy: { select: { name: true, email: true } },
      },
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

  async sendText(
    organizationId: string,
    id: string,
    text: string,
    sentByUserId?: string,
  ) {
    await this.quota.assertCanSend(organizationId);
    const c = await this.assertSendable(organizationId, id);
    const r = await this.manager.sendText(c.sessionId, c.remoteJid, text, {
      sentByUserId,
    });
    return { id: r.messageId, waMessageId: r.waMessageId };
  }

  async sendMedia(
    organizationId: string,
    id: string,
    file: { buffer: Buffer; mimeType: string; fileName?: string | null },
    caption?: string,
    sentByUserId?: string,
  ) {
    await this.quota.assertCanSend(organizationId);
    const c = await this.assertSendable(organizationId, id);
    const r = await this.manager.sendMedia(
      c.sessionId,
      c.remoteJid,
      file,
      caption,
      { sentByUserId },
    );
    return {
      id: r.messageId,
      waMessageId: r.waMessageId,
      mediaUrl: r.mediaUrl,
    };
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

  private async requireConversation(
    organizationId: string,
    id: string,
    withAgent = false,
  ) {
    const c = await this.prisma.conversation.findFirst({
      where: { id, organizationId },
      ...(withAgent ? { include: AGENT_INCLUDE } : {}),
    });
    if (!c) throw new NotFoundException('Conversation not found');
    return c;
  }

  private toConversationDto(c: ConversationWithAgent) {
    const agent = c.session?.agent ?? null;
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
      // The agent assigned to this conversation's session. In groups it only
      // replies when @mentioned; the frontend distinguishes via isGroup.
      agent,
      agentPaused: c.agentPaused,
      agentPausedReason: c.agentPausedReason,
      status: c.status,
      assignedTo: c.assignedTo
        ? {
            id: c.assignedTo.id,
            name: c.assignedTo.name ?? c.assignedTo.email,
          }
        : null,
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
      sentByName: m.sentBy ? (m.sentBy.name ?? m.sentBy.email) : null,
      type: m.type,
      text: m.text,
      status: m.status,
      timestamp: m.timestamp,
      media,
    };
  }
}
