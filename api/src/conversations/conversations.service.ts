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
  tags?: { id: string; name: string; color: string }[];
};
const AGENT_INCLUDE = {
  session: {
    select: {
      agent: { select: { id: true, name: true, enabled: true } },
    },
  },
  assignedTo: { select: { id: true, name: true, email: true } },
  tags: { select: { id: true, name: true, color: true } },
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
      tagId?: string;
      /** Session allow-list for restricted members (null = unrestricted). */
      allowed?: string[] | null;
      /** Operators only see conversations assigned to this user id. */
      assignedTo?: string | null;
    },
  ) {
    const q = opts.q?.trim();
    const rows = await this.prisma.conversation.findMany({
      where: {
        organizationId,
        sessionId: opts.allowed
          ? opts.sessionId && opts.allowed.includes(opts.sessionId)
            ? opts.sessionId
            : { in: opts.allowed }
          : opts.sessionId,
        ...(opts.assignedTo ? { assignedToUserId: opts.assignedTo } : {}),
        lastMessageAt: { not: null },
        ...(opts.status && opts.status !== 'ALL'
          ? { status: opts.status }
          : {}),
        ...(opts.assigned === 'me' && opts.userId
          ? { assignedToUserId: opts.userId }
          : opts.assigned === 'unassigned'
            ? { assignedToUserId: null }
            : {}),
        ...(opts.tagId ? { tags: { some: { id: opts.tagId } } } : {}),
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

  /**
   * Start (or reopen) a conversation with a number from a session. The number
   * is validated on WhatsApp via the live socket, so the thread uses the
   * canonical JID. Existing threads are returned as-is.
   */
  async start(
    organizationId: string,
    dto: { sessionId: string; to: string },
    allowed?: string[] | null,
    assignedTo?: string | null,
  ) {
    // 404 (not 403) so restricted members can't probe session existence.
    if (allowed && !allowed.includes(dto.sessionId)) {
      throw new NotFoundException('Session not found');
    }
    const session = await this.prisma.waSession.findFirst({
      where: { id: dto.sessionId, organizationId },
    });
    if (!session) throw new NotFoundException('Session not found');

    const jid = await this.manager.resolveJid(dto.sessionId, dto.to);
    const conversation = await this.prisma.conversation.upsert({
      where: {
        sessionId_remoteJid: { sessionId: dto.sessionId, remoteJid: jid },
      },
      create: {
        organizationId,
        sessionId: dto.sessionId,
        remoteJid: jid,
        isGroup: jid.endsWith('@g.us'),
        // Operators can only see assigned conversations — claim it for them.
        ...(assignedTo ? { assignedToUserId: assignedTo } : {}),
        // The inbox lists only conversations with lastMessageAt set; stamp it
        // so the empty thread is visible until the first message replaces it.
        lastMessageAt: new Date(),
      },
      update: {},
      include: AGENT_INCLUDE,
    });
    // An operator reopening an existing unassigned thread must still pass
    // the assignment gate.
    if (assignedTo && conversation.assignedToUserId !== assignedTo) {
      throw new NotFoundException('Conversation not found');
    }
    return this.toConversationDto(conversation);
  }

  /** Assign to a teammate (null unassigns) and/or set open/resolved. */
  async update(
    organizationId: string,
    id: string,
    patch: {
      assignedToUserId?: string | null;
      status?: 'OPEN' | 'RESOLVED';
      /** Full replacement set of tag ids (org-scoped). */
      tagIds?: string[];
    },
    allowed?: string[] | null,
    assignedTo?: string | null,
  ) {
    await this.requireConversation(
      organizationId,
      id,
      false,
      allowed,
      assignedTo,
    );
    if (patch.tagIds) {
      const owned = await this.prisma.tag.count({
        where: { id: { in: patch.tagIds }, organizationId },
      });
      if (owned !== patch.tagIds.length) {
        throw new BadRequestException('Unknown tag');
      }
    }
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
        ...(patch.tagIds
          ? { tags: { set: patch.tagIds.map((id) => ({ id })) } }
          : {}),
      },
      include: AGENT_INCLUDE,
    });
    return this.toConversationDto(updated);
  }

  async get(
    organizationId: string,
    id: string,
    allowed?: string[] | null,
    assignedTo?: string | null,
  ) {
    const c = await this.requireConversation(
      organizationId,
      id,
      true,
      allowed,
      assignedTo,
    );
    return this.toConversationDto(c);
  }

  /** Pause or resume the assigned agent's auto-replies for one conversation. */
  async setAgentPaused(
    organizationId: string,
    id: string,
    paused: boolean,
    allowed?: string[] | null,
    assignedTo?: string | null,
  ) {
    await this.requireConversation(
      organizationId,
      id,
      false,
      allowed,
      assignedTo,
    );
    // A manual toggle has no handoff reason — clear any the agent left behind.
    await this.prisma.conversation.update({
      where: { id },
      data: { agentPaused: paused, agentPausedReason: null },
    });
    return { ok: true, agentPaused: paused };
  }

  /**
   * Platform-admin testing tool: drop the thread plus everything that gives
   * it routing memory (flow state, mirror relay), so the next inbound
   * message starts from scratch. FlowRun rows are kept as audit history;
   * the mirror WhatsApp group and the chat on the phone are untouched.
   */
  async remove(organizationId: string, id: string) {
    const c = await this.requireConversation(organizationId, id);
    // Storage objects don't cascade — collect keys first, delete after.
    const assets = await this.prisma.mediaAsset.findMany({
      where: { message: { conversationId: id } },
      select: { storageKey: true },
    });
    await this.prisma.$transaction([
      // Plain-string ref (no FK) — not covered by the cascade below.
      this.prisma.flowConversationState.deleteMany({
        where: { conversationId: id },
      }),
      // The relay owns a mirrored conversation before the flow even runs.
      this.prisma.mirrorThread.deleteMany({
        where: { sessionId: c.sessionId, leadJid: c.remoteJid },
      }),
      this.prisma.conversation.delete({ where: { id } }), // messages cascade
    ]);
    for (const a of assets) {
      await this.media.delete(a.storageKey).catch(() => undefined);
    }
    return { ok: true };
  }

  async messages(
    organizationId: string,
    id: string,
    opts: { before?: string; limit?: number },
    allowed?: string[] | null,
    assignedTo?: string | null,
  ) {
    await this.requireConversation(
      organizationId,
      id,
      false,
      allowed,
      assignedTo,
    );
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

  async markRead(
    organizationId: string,
    id: string,
    allowed?: string[] | null,
    assignedTo?: string | null,
  ) {
    await this.requireConversation(
      organizationId,
      id,
      false,
      allowed,
      assignedTo,
    );
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
    allowed?: string[] | null,
    assignedTo?: string | null,
  ) {
    await this.quota.assertCanSend(organizationId);
    const c = await this.assertSendable(
      organizationId,
      id,
      allowed,
      assignedTo,
    );
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
    allowed?: string[] | null,
    assignedTo?: string | null,
  ) {
    await this.quota.assertCanSend(organizationId);
    const c = await this.assertSendable(
      organizationId,
      id,
      allowed,
      assignedTo,
    );
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

  /** Internal team note: stored in the thread, never sent to WhatsApp. */
  async addNote(
    organizationId: string,
    id: string,
    text: string,
    sentByUserId: string,
    allowed?: string[] | null,
    assignedTo?: string | null,
  ) {
    const c = await this.requireConversation(
      organizationId,
      id,
      false,
      allowed,
      assignedTo,
    );
    const m = await this.prisma.message.create({
      data: {
        organizationId,
        conversationId: c.id,
        sessionId: c.sessionId,
        direction: 'OUTBOUND',
        fromMe: true,
        source: 'NOTE',
        sentByUserId,
        type: 'TEXT',
        text,
        status: 'SENT',
        timestamp: new Date(),
      },
      include: {
        media: true,
        agent: { select: { name: true } },
        sentBy: { select: { name: true, email: true } },
      },
    });
    return this.toMessageDto(m);
  }

  private async assertSendable(
    organizationId: string,
    id: string,
    allowed?: string[] | null,
    assignedTo?: string | null,
  ) {
    const c = await this.requireConversation(
      organizationId,
      id,
      false,
      allowed,
      assignedTo,
    );
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
    allowed?: string[] | null,
    assignedTo?: string | null,
  ) {
    const c = await this.prisma.conversation.findFirst({
      where: { id, organizationId },
      ...(withAgent ? { include: AGENT_INCLUDE } : {}),
    });
    if (!c) throw new NotFoundException('Conversation not found');
    // Operators: 404 on conversations not assigned to them (no probing).
    if (assignedTo && c.assignedToUserId !== assignedTo) {
      throw new NotFoundException('Conversation not found');
    }
    // Restricted members: 404 to avoid probing threads on hidden sessions.
    if (allowed && !allowed.includes(c.sessionId)) {
      throw new NotFoundException('Conversation not found');
    }
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
      avatarUrl: c.avatarUrl,
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
      tags: c.tags ?? [],
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
      // pushName of the WhatsApp sender (group inbound messages).
      senderName: m.senderName ?? null,
      reactions: Array.isArray(m.reactions) ? m.reactions : [],
      type: m.type,
      text: m.text,
      status: m.status,
      timestamp: m.timestamp,
      media,
    };
  }
}
