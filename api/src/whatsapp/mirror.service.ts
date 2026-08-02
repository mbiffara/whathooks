import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Org-scoped management for Mirror Links (lead-protection relay) and the
 * sales-rep directory they draw from. The relay itself runs in
 * ConnectionManagerService (maybeMirror); this service only manages config.
 */
@Injectable()
export class MirrorService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- sales reps ----

  async listReps(organizationId: string) {
    const reps = await this.prisma.salesRep.findMany({
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

  async createRep(
    organizationId: string,
    dto: { name: string; phoneNumber: string },
  ) {
    const existing = await this.prisma.salesRep.findFirst({
      where: { organizationId, phoneNumber: dto.phoneNumber },
    });
    if (existing) {
      throw new ConflictException(
        `That number already belongs to "${existing.name}"`,
      );
    }
    return this.prisma.salesRep.create({
      data: {
        organizationId,
        name: dto.name.trim(),
        phoneNumber: dto.phoneNumber,
      },
    });
  }

  async updateRep(
    organizationId: string,
    id: string,
    dto: { name?: string; phoneNumber?: string },
  ) {
    const rep = await this.prisma.salesRep.findFirst({
      where: { id, organizationId },
    });
    if (!rep) throw new NotFoundException('Sales rep not found');
    const updated = await this.prisma.salesRep.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.phoneNumber !== undefined
          ? { phoneNumber: dto.phoneNumber }
          : {}),
      },
    });
    // The relay reads the denormalized repNumber — keep links in sync.
    if (dto.phoneNumber && dto.phoneNumber !== rep.phoneNumber) {
      await this.prisma.mirrorLink.updateMany({
        where: { repId: id },
        data: { repNumber: dto.phoneNumber },
      });
    }
    return updated;
  }

  async deleteRep(organizationId: string, id: string) {
    const rep = await this.prisma.salesRep.findFirst({
      where: { id, organizationId },
    });
    if (!rep) throw new NotFoundException('Sales rep not found');
    const links = await this.prisma.mirrorLink.count({ where: { repId: id } });
    if (links > 0) {
      throw new ConflictException(
        'This rep is used by a mirror link — delete the link first',
      );
    }
    await this.prisma.salesRep.delete({ where: { id } });
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
        rep: { select: { id: true, name: true } },
        _count: { select: { threads: true } },
      },
    });
    return links.map((l) => ({
      id: l.id,
      enabled: l.enabled,
      repNumber: l.repNumber,
      repId: l.rep?.id ?? null,
      repName: l.rep?.name ?? null,
      threads: l._count.threads,
      session: l.session,
      createdAt: l.createdAt,
    }));
  }

  async createLink(
    organizationId: string,
    dto: { sessionId: string; repId: string },
  ) {
    const session = await this.prisma.waSession.findFirst({
      where: { id: dto.sessionId, organizationId },
    });
    if (!session) throw new NotFoundException('Session not found');
    const rep = await this.prisma.salesRep.findFirst({
      where: { id: dto.repId, organizationId },
    });
    if (!rep) throw new NotFoundException('Sales rep not found');
    const existing = await this.prisma.mirrorLink.findUnique({
      where: { sessionId: dto.sessionId },
    });
    if (existing) {
      throw new ConflictException('This session already has a mirror link');
    }
    if (session.phoneNumber === rep.phoneNumber) {
      throw new BadRequestException(
        'The rep number cannot be the session number itself',
      );
    }
    return this.prisma.mirrorLink.create({
      data: {
        sessionId: dto.sessionId,
        repNumber: rep.phoneNumber,
        repId: rep.id,
      },
    });
  }

  async updateLink(organizationId: string, id: string, enabled: boolean) {
    await this.requireLink(organizationId, id);
    return this.prisma.mirrorLink.update({ where: { id }, data: { enabled } });
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
    });
    return threads.map((t) => ({
      id: t.id,
      seq: t.seq,
      leadJid: t.leadJid,
      groupJid: t.groupJid,
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
