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
  /**
   * A fresh Zernio profile for one Instagram account.
   *
   * **A profile holds one account per platform, not many.** The docs describe
   * it as "a container that groups connected accounts" and say to create one
   * per customer, which is what this used to do — and connecting a second
   * Instagram account then silently overwrote the first, reusing the same
   * Zernio account id under a new username. The first account simply ceased to
   * exist, with no error anywhere.
   *
   * So: one profile per account. Named after the org plus the session so
   * Zernio's own dashboard stays legible when support has to look at it.
   */
  private async createProfileFor(
    organizationId: string,
    sessionId: string,
  ): Promise<string> {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true },
    });
    return this.zernio.createProfile(
      `${org.name} ${sessionId.slice(-6)}`.slice(0, 60),
    );
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

    const session =
      pending ??
      (await this.prisma.waSession.create({
        data: {
          organizationId,
          channel: 'INSTAGRAM',
          label: label?.trim() || 'Instagram',
          status: 'CONNECTING',
        },
        select: { id: true, externalProfileId: true },
      }));

    // Each account needs its own profile, so the profile is created per
    // session rather than per organization. A resumed pending session keeps
    // the one it already has.
    let profileId = session.externalProfileId;
    if (!profileId) {
      profileId = await this.createProfileFor(organizationId, session.id);
      await this.prisma.waSession.update({
        where: { id: session.id },
        data: { externalProfileId: profileId },
      });
    }

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
    const ours = await this.prisma.waSession.findMany({
      where: { organizationId, channel: 'INSTAGRAM' },
      select: { id: true, externalProfileId: true, externalAccountId: true },
    });
    if (ours.length === 0) return { connected: 0 };

    const accounts = (await this.zernio.listAccounts()).filter(
      (a) => a.platform === 'instagram',
    );
    const profileOf = (a: (typeof accounts)[number]) =>
      typeof a.profileId === 'string' ? a.profileId : a.profileId?._id;

    let connected = 0;
    for (const session of ours) {
      if (!session.externalProfileId) continue;
      // Match on the session's OWN profile. Matching on the organization's
      // would let one account claim another's session, which is exactly how
      // a second connection came to overwrite the first.
      const account = accounts.find(
        (a) => profileOf(a) === session.externalProfileId,
      );
      if (!account) continue;

      const isNew = session.externalAccountId !== account._id;
      await this.prisma.waSession.update({
        where: { id: session.id },
        data: {
          externalAccountId: account._id,
          externalHandle: account.username,
          label: `@${account.username}`,
          status: account.needsReconnection ? 'DISCONNECTED' : 'CONNECTED',
        },
      });
      if (isNew) connected += 1;
    }
    return { connected };
  }

  /**
   * Point an org at an existing Zernio profile and adopt whatever is in it.
   *
   * Migration path for accounts connected before this integration existed (or
   * directly in Zernio's dashboard). Platform-admin only, because adopting an
   * arbitrary profile id would otherwise let one organization claim another
   * customer's connected accounts.
   */
  async adoptProfile(
    organizationId: string,
    profileId: string,
  ): Promise<{ connected: number }> {
    const taken = await this.prisma.organization.findFirst({
      where: { zernioProfileId: profileId, NOT: { id: organizationId } },
      select: { id: true },
    });
    if (taken) {
      throw new BadRequestException(
        `Profile ${profileId} already belongs to organization ${taken.id}`,
      );
    }
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { zernioProfileId: profileId },
    });
    // Adopted accounts need a session row each; reconcile only fills sessions
    // that already exist, so create the missing ones first.
    const accounts = (await this.zernio.listAccounts()).filter((a) => {
      const pid =
        typeof a.profileId === 'string' ? a.profileId : a.profileId?._id;
      return a.platform === 'instagram' && pid === profileId;
    });
    // One session per account in the profile, each carrying the profile id so
    // reconcile can match it. Only accounts we do not already hold.
    const held = await this.prisma.waSession.findMany({
      where: { organizationId, channel: 'INSTAGRAM' },
      select: { externalAccountId: true },
    });
    const have = new Set(held.map((h) => h.externalAccountId).filter(Boolean));
    for (const account of accounts) {
      if (have.has(account._id)) continue;
      await this.prisma.waSession.create({
        data: {
          organizationId,
          channel: 'INSTAGRAM',
          label: `@${account.username}`,
          status: 'CONNECTING',
          externalProfileId: profileId,
          externalAccountId: account._id,
          externalHandle: account.username,
        },
      });
    }
    return this.reconcile(organizationId);
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
