import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WaSession } from '@prisma/client';
import * as QRCode from 'qrcode';
import { QuotaService } from '../billing/quota.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionManagerService } from './connection-manager.service';

@Injectable()
export class WhatsappService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly manager: ConnectionManagerService,
    private readonly quota: QuotaService,
  ) {}

  async list(organizationId: string, allowed?: string[] | null) {
    const sessions = await this.prisma.waSession.findMany({
      where: { organizationId, ...(allowed ? { id: { in: allowed } } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return sessions.map((s) => this.toPublic(s));
  }

  async create(organizationId: string, label: string) {
    await this.quota.assertCanAddNumber(organizationId);
    const session = await this.prisma.waSession.create({
      data: { organizationId, label, status: 'PENDING' },
    });
    // Kick off the socket so a QR is produced.
    await this.manager.start(session.id);
    return this.toPublic(session);
  }

  async get(organizationId: string, id: string) {
    const session = await this.requireSession(organizationId, id);
    const qrDataUrl = session.qr
      ? await QRCode.toDataURL(session.qr, { margin: 1, width: 320 })
      : null;
    return { ...this.toPublic(session), qr: session.qr, qrDataUrl };
  }

  async connect(organizationId: string, id: string) {
    await this.requireSession(organizationId, id);
    await this.manager.start(id);
    return { ok: true };
  }

  async logout(organizationId: string, id: string) {
    await this.requireSession(organizationId, id);
    await this.manager.logout(id);
    return { ok: true };
  }

  async sendTest(organizationId: string, id: string, to: string, text: string) {
    const session = await this.requireSession(organizationId, id);
    if (session.status !== 'CONNECTED' || !this.manager.isLive(id)) {
      throw new BadRequestException('Session is not connected');
    }
    const result = await this.manager.sendText(id, to, text);
    return { ok: true, ...result };
  }

  async remove(organizationId: string, id: string) {
    await this.requireSession(organizationId, id);
    await this.manager.logout(id).catch(() => undefined);
    await this.prisma.waSession.delete({ where: { id } });
    return { ok: true };
  }

  private async requireSession(
    organizationId: string,
    id: string,
  ): Promise<WaSession> {
    const session = await this.prisma.waSession.findFirst({
      where: { id, organizationId },
    });
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  private toPublic(s: WaSession) {
    return {
      id: s.id,
      label: s.label,
      status: s.status,
      phoneNumber: s.phoneNumber,
      agentId: s.agentId,
      lastConnectedAt: s.lastConnectedAt,
      createdAt: s.createdAt,
      live: this.manager.isLive(s.id),
    };
  }
}
