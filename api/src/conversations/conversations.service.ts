import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Conversation,
  MediaAsset,
  Message,
  MessageSource,
} from '@prisma/client';
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
const MIRROR_SELECT = {
  id: true,
  groupJid: true,
  sessionId: true,
  leadJid: true,
  humanAgent: { select: { id: true, name: true } },
} as const;
type MirrorInfo = {
  id: string;
  groupJid: string;
  sessionId: string;
  leadJid: string;
  humanAgent: { id: string; name: string } | null;
};
/** Subject prefix for mirror groups opened from the inbox. */
const INBOX_GROUP_PREFIX = '🔒 Lead';
import { QuotaService } from '../billing/quota.service';
import { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionManagerService } from '../whatsapp/connection-manager.service';
import { FlowEngineService } from '../whatsapp/flow-engine.service';

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly manager: ConnectionManagerService,
    private readonly quota: QuotaService,
    private readonly flowEngine: FlowEngineService,
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
      /** Blank the contact's number in the response (operators). */
      redactNumbers?: boolean;
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
        // Status/stories, broadcast lists and channels are not threads anyone
        // can be answered in. Ingestion drops them now, but rows created
        // before that filter existed would otherwise still show up.
        NOT: {
          OR: [
            { remoteJid: { endsWith: '@broadcast' } },
            { remoteJid: { endsWith: '@newsletter' } },
          ],
        },
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
                // Matching the jid would let a hidden number be confirmed
                // by typing it into search.
                ...(opts.redactNumbers ? [] : [{ remoteJid: { contains: q } }]),
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
    const mirrors = await this.mirrorsFor(rows);
    return rows.map((c) =>
      this.toConversationDto(
        c,
        mirrors.get(`${c.sessionId}|${c.remoteJid}`),
        opts.redactNumbers,
      ),
    );
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
    redactNumbers = false,
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
    return this.toConversationDto(
      conversation,
      await this.mirrorFor(conversation),
      redactNumbers,
    );
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
    redactNumbers = false,
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
    return this.toConversationDto(
      updated,
      await this.mirrorFor(updated),
      redactNumbers,
    );
  }

  async get(
    organizationId: string,
    id: string,
    allowed?: string[] | null,
    assignedTo?: string | null,
    redactNumbers = false,
  ) {
    const c = await this.requireConversation(
      organizationId,
      id,
      true,
      allowed,
      assignedTo,
    );
    return this.toConversationDto(c, await this.mirrorFor(c), redactNumbers);
  }

  /**
   * Open a mirror group for this conversation: a private WhatsApp group with
   * one human agent, whose replies relay back to the lead as the brand. The
   * inbox counterpart of the flow "assign to human agent" node — offered when
   * a conversation is assigned to a teammate who is also a human agent.
   */
  async createMirror(
    organizationId: string,
    id: string,
    opts: { humanAgentId: string; copyHistory?: boolean },
    allowed?: string[] | null,
    assignedTo?: string | null,
  ) {
    // Creating the group needs a live socket, same bar as sending.
    const c = await this.assertSendable(
      organizationId,
      id,
      allowed,
      assignedTo,
    );
    if (c.isGroup) {
      throw new BadRequestException(
        'Mirror groups only apply to direct conversations',
      );
    }
    if (await this.mirrorFor(c)) {
      throw new BadRequestException('This conversation is already mirrored');
    }
    const human = await this.prisma.humanAgent.findFirst({
      where: { id: opts.humanAgentId, organizationId },
    });
    if (!human) throw new BadRequestException('Unknown human agent');

    const thread = await this.manager.createMirrorThread(
      c.sessionId,
      c.remoteJid,
      [{ id: human.id, number: human.phoneNumber }],
      { prefix: INBOX_GROUP_PREFIX, showLeadName: true },
    );
    if (opts.copyHistory) {
      // Best-effort: the group works without the transcript. Nothing here is
      // a "triggering" message, so the newest inbound row is kept.
      const transcript = await this.flowEngine.historyTranscript(
        c.id,
        c.name,
        false,
      );
      if (transcript) {
        await this.manager
          .sendText(c.sessionId, thread.groupJid, transcript, {
            source: MessageSource.MIRROR,
          })
          .catch(() => undefined);
      }
    }
    return this.get(organizationId, id, allowed, assignedTo);
  }

  /**
   * Close the mirror: the session leaves the group (the "<brand> left" system
   * message tells the agent relaying stopped) and the thread is dropped, so
   * the session's own automation owns the conversation again.
   */
  async removeMirror(
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
    const thread = await this.mirrorFor(c);
    if (!thread) {
      throw new NotFoundException('This conversation is not mirrored');
    }
    await this.manager.closeMirrorThread(thread);
    return this.get(organizationId, id, allowed, assignedTo);
  }

  /**
   * Save this conversation's contact into the address book. The inbox offers
   * this when the session does not auto-save; the outcome distinguishes a new
   * contact from one that already existed so the UI can say which happened.
   */
  async saveContact(
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
    if (c.isGroup) {
      throw new BadRequestException('Groups are not saved as contacts');
    }
    const outcome = await this.flowEngine.saveContactFor(c.sessionId, {
      remoteJid: c.remoteJid,
      phoneNumber: c.phoneNumber,
      name: c.name,
    });
    if (outcome === 'error') {
      throw new BadRequestException('This conversation has no saveable number');
    }
    return { outcome };
  }

  /** The mirror thread owning this conversation, if any. */
  private mirrorFor(c: { sessionId: string; remoteJid: string }) {
    return this.prisma.mirrorThread.findUnique({
      where: {
        sessionId_leadJid: { sessionId: c.sessionId, leadJid: c.remoteJid },
      },
      select: MIRROR_SELECT,
    });
  }

  /** Same, batched for a list. Keyed by `${sessionId}|${remoteJid}`. */
  private async mirrorsFor(rows: { sessionId: string; remoteJid: string }[]) {
    const map = new Map<string, MirrorInfo>();
    if (rows.length === 0) return map;
    const threads = await this.prisma.mirrorThread.findMany({
      where: {
        OR: rows.map((r) => ({ sessionId: r.sessionId, leadJid: r.remoteJid })),
      },
      select: MIRROR_SELECT,
    });
    for (const t of threads) map.set(`${t.sessionId}|${t.leadJid}`, t);
    return map;
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

  /**
   * `redactNumbers` blanks every field that reveals the contact's number.
   * Operators answer threads without being able to read, or walk away with,
   * customer numbers — the same posture as a mirror link, where the human
   * agent never sees the lead. Names stay: they are how threads are told
   * apart, and they are not contact details.
   */
  private toConversationDto(
    c: ConversationWithAgent,
    mirror?: MirrorInfo | null,
    redactNumbers = false,
  ) {
    const agent = c.session?.agent ?? null;
    return {
      id: c.id,
      sessionId: c.sessionId,
      remoteJid: redactNumbers ? null : c.remoteJid,
      // The raw addressing identity: a phone number, or a LID when WhatsApp
      // hides it. `phoneNumber` carries the real number in the LID case.
      contact: redactNumbers ? null : c.remoteJid.split('@')[0],
      phoneNumber: redactNumbers ? null : c.phoneNumber,
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
      // Set while a human agent owns the thread over WhatsApp: the session's
      // own automation stays out of the way until the mirror is removed.
      mirror: mirror
        ? {
            id: mirror.id,
            groupJid: mirror.groupJid,
            agentName: mirror.humanAgent?.name ?? null,
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
