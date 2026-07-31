import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WaSession } from '@prisma/client';
import { randomBytes } from 'crypto';
import * as QRCode from 'qrcode';
import { QuotaService } from '../billing/quota.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionManagerService } from './connection-manager.service';

// Public QR-share links stay valid for 24h; regenerating rotates the token.
const SHARE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

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

  /** Create (or rotate) the public QR-share link for a session. */
  async createShareLink(organizationId: string, id: string) {
    await this.requireSession(organizationId, id);
    const token = randomBytes(24).toString('base64url');
    const createdAt = new Date();
    await this.prisma.waSession.update({
      where: { id },
      data: { shareToken: token, shareTokenCreatedAt: createdAt },
    });
    return {
      token,
      expiresAt: new Date(createdAt.getTime() + SHARE_TOKEN_TTL_MS),
    };
  }

  /** Revoke the public QR-share link. */
  async revokeShareLink(organizationId: string, id: string) {
    await this.requireSession(organizationId, id);
    await this.prisma.waSession.update({
      where: { id },
      data: { shareToken: null, shareTokenCreatedAt: null },
    });
    return { ok: true };
  }

  /**
   * Public (unauthenticated) view for the QR-share page: label, status and the
   * current QR. Wakes the socket when it isn't running so the QR regenerates
   * even if the visitor opens the link hours after it was created.
   */
  async getByShareToken(token: string) {
    const session = await this.prisma.waSession.findUnique({
      where: { shareToken: token },
      include: { organization: { select: { name: true } } },
    });
    if (
      !session ||
      !session.shareTokenCreatedAt ||
      Date.now() - session.shareTokenCreatedAt.getTime() > SHARE_TOKEN_TTL_MS
    ) {
      throw new NotFoundException('This link is invalid or has expired');
    }
    if (session.status !== 'CONNECTED' && !this.manager.isLive(session.id)) {
      await this.manager.start(session.id).catch(() => undefined);
    }
    const qrDataUrl = session.qr
      ? await QRCode.toDataURL(session.qr, { margin: 1, width: 320 })
      : null;
    // The page renders in the account's language (org owner's locale) — the
    // visitor is the org's customer, so that's a better guess than their
    // browser language.
    const owner = await this.prisma.membership.findFirst({
      where: { organizationId: session.organizationId, role: 'OWNER' },
      select: { user: { select: { locale: true } } },
    });
    return {
      label: session.label,
      organization: session.organization.name,
      locale: owner?.user.locale ?? 'en',
      status: session.status,
      qrDataUrl,
    };
  }

  async rename(organizationId: string, id: string, label: string) {
    await this.requireSession(organizationId, id);
    const session = await this.prisma.waSession.update({
      where: { id },
      data: { label },
    });
    return this.toPublic(session);
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
