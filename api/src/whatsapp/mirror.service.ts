import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { QuotaService } from '../billing/quota.service';
import { PrismaService } from '../prisma/prisma.service';
import { addressIdentity } from '../common/address';
import { ConnectionManagerService } from './connection-manager.service';

/**
 * Org-scoped management for Mirror Links (lead-protection relay), the
 * human-agent directory they draw from, and the live mirrored conversations.
 * The relay itself runs in ConnectionManagerService (maybeMirror); this
 * service only manages config and inspects/closes threads.
 */
@Injectable()
export class MirrorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
    private readonly manager: ConnectionManagerService,
  ) {}

  // ---- human agents ----

  async listAgents(organizationId: string) {
    const reps = await this.prisma.humanAgent.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { mirrorLinks: true } },
        user: { select: { id: true, name: true, email: true } },
      },
    });
    return reps.map((r) => ({
      id: r.id,
      name: r.name,
      phoneNumber: r.phoneNumber,
      user: r.user,
      links: r._count.mirrorLinks,
      createdAt: r.createdAt,
    }));
  }

  async createAgent(
    organizationId: string,
    dto: { name: string; phoneNumber: string; userId?: string | null },
  ) {
    await this.quota.assertCanAddHumanAgent(organizationId);
    const existing = await this.prisma.humanAgent.findFirst({
      where: { organizationId, phoneNumber: dto.phoneNumber },
    });
    if (existing) {
      throw new ConflictException(
        `That number already belongs to "${existing.name}"`,
      );
    }
    if (dto.userId) await this.requireLinkable(organizationId, dto.userId);
    return this.prisma.humanAgent.create({
      data: {
        organizationId,
        name: dto.name.trim(),
        phoneNumber: dto.phoneNumber,
        userId: dto.userId ?? null,
      },
    });
  }

  async updateAgent(
    organizationId: string,
    id: string,
    dto: { name?: string; phoneNumber?: string; userId?: string | null },
  ) {
    const agent = await this.prisma.humanAgent.findFirst({
      where: { id, organizationId },
    });
    if (!agent) throw new NotFoundException('Human agent not found');
    if (dto.userId) {
      await this.requireLinkable(organizationId, dto.userId, id);
    }
    const updated = await this.prisma.humanAgent.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.phoneNumber !== undefined
          ? { phoneNumber: dto.phoneNumber }
          : {}),
        ...(dto.userId !== undefined ? { userId: dto.userId } : {}),
      },
    });
    // The relay reads the denormalized agentNumber — keep links in sync.
    if (dto.phoneNumber && dto.phoneNumber !== agent.phoneNumber) {
      await this.prisma.mirrorLink.updateMany({
        where: { humanAgentId: id },
        data: { agentNumber: dto.phoneNumber },
      });
    }
    return updated;
  }

  /** The link target must be an org member, not already linked elsewhere. */
  private async requireLinkable(
    organizationId: string,
    userId: string,
    exceptAgentId?: string,
  ) {
    const member = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
    });
    if (!member) {
      throw new NotFoundException('That user is not a member of this org');
    }
    const taken = await this.prisma.humanAgent.findFirst({
      where: {
        organizationId,
        userId,
        ...(exceptAgentId ? { id: { not: exceptAgentId } } : {}),
      },
      select: { name: true },
    });
    if (taken) {
      throw new ConflictException(
        `That member is already linked to "${taken.name}"`,
      );
    }
  }

  async deleteAgent(organizationId: string, id: string) {
    const agent = await this.prisma.humanAgent.findFirst({
      where: { id, organizationId },
    });
    if (!agent) throw new NotFoundException('Human agent not found');
    const links = await this.prisma.mirrorLink.count({
      where: { humanAgentId: id },
    });
    if (links > 0) {
      throw new ConflictException(
        'This human agent is used by a mirror link — delete the link first',
      );
    }
    await this.prisma.humanAgent.delete({ where: { id } });
    return { ok: true };
  }

  // ---- mirror links ----

  async listLinks(organizationId: string) {
    const links = await this.prisma.mirrorLink.findMany({
      where: { session: { organizationId } },
      orderBy: { createdAt: 'desc' },
      include: {
        session: {
          select: { id: true, label: true, phoneNumber: true, status: true },
        },
        humanAgent: { select: { id: true, name: true } },
        _count: { select: { threads: true } },
      },
    });
    return links.map((l) => ({
      id: l.id,
      enabled: l.enabled,
      agentNumber: l.agentNumber,
      humanAgentId: l.humanAgent?.id ?? null,
      humanAgentName: l.humanAgent?.name ?? null,
      groupPrefix: l.groupPrefix,
      showLeadName: l.showLeadName,
      threads: l._count.threads,
      session: l.session,
      createdAt: l.createdAt,
    }));
  }

  async createLink(
    organizationId: string,
    dto: {
      sessionId: string;
      humanAgentId: string;
      groupPrefix?: string;
      showLeadName?: boolean;
    },
  ) {
    const session = await this.prisma.waSession.findFirst({
      where: { id: dto.sessionId, organizationId },
    });
    if (!session) throw new NotFoundException('Session not found');
    const agent = await this.prisma.humanAgent.findFirst({
      where: { id: dto.humanAgentId, organizationId },
    });
    if (!agent) throw new NotFoundException('Human agent not found');
    const existing = await this.prisma.mirrorLink.findUnique({
      where: { sessionId: dto.sessionId },
    });
    if (existing) {
      throw new ConflictException('This session already has a mirror link');
    }
    if (session.phoneNumber === agent.phoneNumber) {
      throw new BadRequestException(
        'The human agent number cannot be the session number itself',
      );
    }
    return this.prisma.mirrorLink.create({
      data: {
        sessionId: dto.sessionId,
        agentNumber: agent.phoneNumber,
        humanAgentId: agent.id,
        ...(dto.groupPrefix?.trim()
          ? { groupPrefix: dto.groupPrefix.trim() }
          : {}),
        ...(dto.showLeadName !== undefined
          ? { showLeadName: dto.showLeadName }
          : {}),
      },
    });
  }

  async updateLink(
    organizationId: string,
    id: string,
    patch: { enabled?: boolean; showLeadName?: boolean },
  ) {
    await this.requireLink(organizationId, id);
    return this.prisma.mirrorLink.update({
      where: { id },
      data: {
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.showLeadName !== undefined
          ? { showLeadName: patch.showLeadName }
          : {}),
      },
    });
  }

  async deleteLink(organizationId: string, id: string) {
    await this.requireLink(organizationId, id);
    await this.prisma.mirrorLink.delete({ where: { id } });
    return { ok: true };
  }

  // ---- mirrored conversations (threads) ----

  /**
   * Every live mirror in the org, whatever opened it: a static MirrorLink, a
   * flow handoff node, or the inbox action. Rows carry the conversation id so
   * the dashboard can jump into the thread, and resolve agent numbers to
   * directory names (team groups list several).
   */
  async listAllThreads(organizationId: string) {
    const threads = await this.prisma.mirrorThread.findMany({
      where: { session: { organizationId } },
      orderBy: { createdAt: 'desc' },
      include: {
        session: {
          select: { id: true, label: true, phoneNumber: true, status: true },
        },
        humanAgent: { select: { id: true, name: true } },
      },
    });
    if (threads.length === 0) return [];

    // The lead's conversation shares (sessionId, jid) with the thread.
    const conversations = await this.prisma.conversation.findMany({
      where: {
        OR: threads.map((t) => ({
          sessionId: t.sessionId,
          remoteJid: t.leadJid,
        })),
      },
      select: { id: true, sessionId: true, remoteJid: true, name: true },
    });
    const convByKey = new Map(
      conversations.map((c) => [`${c.sessionId}|${c.remoteJid}`, c]),
    );

    const numbers = [
      ...new Set(
        threads.flatMap((t) =>
          t.agentNumbers.length ? t.agentNumbers : [t.agentNumber],
        ),
      ),
    ];
    const directory = await this.prisma.humanAgent.findMany({
      where: { organizationId, phoneNumber: { in: numbers } },
      select: { phoneNumber: true, name: true },
    });
    const nameByNumber = new Map(
      directory.map((a) => [a.phoneNumber, a.name] as const),
    );

    return threads.map((t) => {
      const conversation = convByKey.get(`${t.sessionId}|${t.leadJid}`) ?? null;
      const agentNumbers = t.agentNumbers.length
        ? t.agentNumbers
        : [t.agentNumber];
      return {
        id: t.id,
        seq: t.seq,
        groupJid: t.groupJid,
        leadJid: t.leadJid,
        leadNumber: addressIdentity(t.leadJid),
        // Team groups (assignGroup) let every listed number reply. The
        // primary agent prefers its own relation: agentNumber is
        // denormalized, so a later phone edit would miss the directory.
        agents: agentNumbers.map((number) => ({
          number,
          name:
            (number === t.agentNumber ? t.humanAgent?.name : null) ??
            nameByNumber.get(number) ??
            null,
        })),
        // Static links keep re-creating the thread on the next inbound
        // message, so the UI warns instead of offering a pointless removal.
        fromLink: t.linkId !== null,
        session: t.session,
        conversationId: conversation?.id ?? null,
        contactName: conversation?.name ?? null,
        createdAt: t.createdAt,
      };
    });
  }

  /** Close one mirror: leave the group, drop the thread. */
  async removeThread(organizationId: string, id: string) {
    const thread = await this.prisma.mirrorThread.findFirst({
      where: { id, session: { organizationId } },
      select: { id: true, sessionId: true, groupJid: true },
    });
    if (!thread) throw new NotFoundException('Mirror not found');
    await this.manager.closeMirrorThread(thread);
    return { ok: true };
  }

  /** Lead ↔ group mapping for one link (org side sees the lead numbers). */
  async listThreads(organizationId: string, id: string) {
    await this.requireLink(organizationId, id);
    const threads = await this.prisma.mirrorThread.findMany({
      where: { linkId: id },
      orderBy: { seq: 'asc' },
      include: { humanAgent: { select: { id: true, name: true } } },
    });
    return threads.map((t) => ({
      id: t.id,
      seq: t.seq,
      leadJid: t.leadJid,
      groupJid: t.groupJid,
      humanAgentId: t.humanAgent?.id ?? null,
      humanAgentName: t.humanAgent?.name ?? null,
      agentNumber: t.agentNumber,
      createdAt: t.createdAt,
    }));
  }

  private async requireLink(organizationId: string, id: string) {
    const link = await this.prisma.mirrorLink.findFirst({
      where: { id, session: { organizationId } },
    });
    if (!link) throw new NotFoundException('Mirror link not found');
    return link;
  }
}
