import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QuotaService } from '../billing/quota.service';
import { PrismaService } from '../prisma/prisma.service';
import { ZernioService } from './zernio.service';

/**
 * Connecting and reconciling Instagram accounts.
 *
 * The connect flow is: gate on a paid seat → make sure the org has a Zernio
 * profile → create a PENDING session → hand back an OAuth URL. The session row
 * exists before the customer authorises so that a half-finished connection is
 * visible in the UI rather than vanishing, and `reconcile` fills in the account
 * identity once Zernio reports it.
 */
@Injectable()
export class InstagramService {
  private readonly log = new Logger(InstagramService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly zernio: ZernioService,
    private readonly quota: QuotaService,
    private readonly config: ConfigService,
  ) {}

  private webBase(): string {
    return (
      this.config.get<string>('WEB_ORIGIN', 'http://localhost:3000') ?? ''
    )
      .split(',')[0]
      .trim();
  }

  /** Zernio profile for this org, created on first use. */
  private async profileFor(organizationId: string): Promise<string> {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { zernioProfileId: true, name: true },
    });
    if (org.zernioProfileId) return org.zernioProfileId;

    // Name it after the org so Zernio's own dashboard stays legible when
    // support has to look at it.
    const profileId = await this.zernio.createProfile(
      `${org.name} (${organizationId.slice(0, 8)})`,
    );
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { zernioProfileId: profileId },
    });
    return profileId;
  }

  /**
   * Begin connecting an Instagram account. Returns the URL to send the
   * customer to; the session lands CONNECTED once `reconcile` sees it.
   */
  async beginConnect(
    organizationId: string,
    label?: string,
  ): Promise<{ authUrl: string; sessionId: string }> {
    // Reuse a connection the customer started and abandoned. Pending rows
    // count against the seat like any other, so without this a customer who
    // closed the Instagram tab would be told every seat was taken and have no
    // obvious way back — and each retry would leave another dead row.
    const pending = await this.prisma.waSession.findFirst({
      where: {
        organizationId,
        channel: 'INSTAGRAM',
        externalAccountId: null,
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, externalProfileId: true },
    });
    if (!pending) await this.quota.assertCanAddInstagramAccount(organizationId);

    const profileId =
      pending?.externalProfileId ?? (await this.profileFor(organizationId));

    const session =
      pending ??
      (await this.prisma.waSession.create({
        data: {
          organizationId,
          channel: 'INSTAGRAM',
          label: label?.trim() || 'Instagram',
          status: 'CONNECTING',
          externalProfileId: profileId,
        },
        select: { id: true },
      }));

    const authUrl = await this.zernio.instagramAuthUrl(
      profileId,
      `${this.webBase()}/dashboard/sessions?instagram=${session.id}`,
    );
    return { authUrl, sessionId: session.id };
  }

  /**
   * Match Zernio's accounts for this org's profile onto our sessions.
   *
   * Zernio's OAuth callback lands on Zernio, not on us, so there is no request
   * of ours that "completes" a connection — we reconcile instead. Called when
   * the customer returns from the redirect, and safe to call repeatedly.
   */
  async reconcile(organizationId: string): Promise<{ connected: number }> {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { zernioProfileId: true },
    });
    if (!org.zernioProfileId) return { connected: 0 };

    const accounts = (await this.zernio.listAccounts()).filter((a) => {
      if (a.platform !== 'instagram') return false;
      const pid =
        typeof a.profileId === 'string' ? a.profileId : a.profileId?._id;
      return pid === org.zernioProfileId;
    });

    const ours = await this.prisma.waSession.findMany({
      where: { organizationId, channel: 'INSTAGRAM' },
      select: { id: true, externalAccountId: true },
    });
    const claimed = new Set(
      ours.map((s) => s.externalAccountId).filter(Boolean),
    );

    let connected = 0;
    for (const account of accounts) {
      if (claimed.has(account._id)) {
        // Already ours: keep status and handle fresh (they can change on
        // Zernio's side without telling us).
        await this.prisma.waSession.updateMany({
          where: { organizationId, externalAccountId: account._id },
          data: {
            externalHandle: account.username,
            status: account.needsReconnection ? 'DISCONNECTED' : 'CONNECTED',
          },
        });
        continue;
      }
      // A newly authorised account: attach it to the oldest session still
      // waiting for one. Without a slot the customer authorised an account we
      // never asked for, so leave it rather than inventing an unpaid session.
      const waiting = ours.find((s) => !s.externalAccountId);
      if (!waiting) {
        this.log.warn(
          `Zernio account ${account._id} has no pending session in org ${organizationId}`,
        );
        continue;
      }
      await this.prisma.waSession.update({
        where: { id: waiting.id },
        data: {
          externalAccountId: account._id,
          externalHandle: account.username,
          label: `@${account.username}`,
          status: 'CONNECTED',
        },
      });
      waiting.externalAccountId = account._id;
      claimed.add(account._id);
      connected += 1;
    }
    return { connected };
  }

  /** Drop a connection. The seat stays paid until billing is changed. */
  async disconnect(organizationId: string, sessionId: string): Promise<void> {
    const session = await this.prisma.waSession.findFirst({
      where: { id: sessionId, organizationId, channel: 'INSTAGRAM' },
      select: { id: true },
    });
    if (!session) throw new BadRequestException('Instagram account not found');
    await this.prisma.waSession.delete({ where: { id: session.id } });
  }
}
