import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Org-scoped management for Mirror Links (lead-protection relay) and the
 * human-agent directory they draw from. The relay itself runs in
 * ConnectionManagerService (maybeMirror); this service only manages config.
 */
@Injectable()
export class MirrorService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- human agents ----

  async listAgents(organizationId: string) {
    const reps = await this.prisma.humanAgent.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { mirrorLinks: true } } },
    });
    return reps.map((r) => ({
      id: r.id,
      name: r.name,
      phoneNumber: r.phoneNumber,
      links: r._count.mirrorLinks,
      createdAt: r.createdAt,
    }));
  }

  async createAgent(
    organizationId: string,
    dto: { name: string; phoneNumber: string },
  ) {
    const existing = await this.prisma.humanAgent.findFirst({
      where: { organizationId, phoneNumber: dto.phoneNumber },
    });
    if (existing) {
      throw new ConflictException(
        `That number already belongs to "${existing.name}"`,
      );
    }
    return this.prisma.humanAgent.create({
      data: {
        organizationId,
        name: dto.name.trim(),
        phoneNumber: dto.phoneNumber,
      },
    });
  }

  async updateAgent(
    organizationId: string,
    id: string,
    dto: { name?: string; phoneNumber?: string },
  ) {
    const agent = await this.prisma.humanAgent.findFirst({
      where: { id, organizationId },
    });
    if (!agent) throw new NotFoundException('Human agent not found');
    const updated = await this.prisma.humanAgent.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.phoneNumber !== undefined
          ? { phoneNumber: dto.phoneNumber }
          : {}),
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

  async deleteAgent(organizationId: string, id: string) {
    const agent = await this.prisma.humanAgent.findFirst({
      where: { id, organizationId },
    });
    if (!agent) throw new NotFoundException('Human agent not found');
    const links = await this.prisma.mirrorLink.count({ where: { humanAgentId: id } });
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
