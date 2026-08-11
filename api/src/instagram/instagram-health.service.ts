import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Channel } from '@prisma/client';
import { SessionAlertService } from '../channels/session-alert.service';
import { PrismaService } from '../prisma/prisma.service';
import { ZernioService } from './zernio.service';

/**
 * Keeping Instagram connections honest.
 *
 * Instagram access tokens expire roughly every 60 days. Nothing in the message
 * path notices: DMs simply stop arriving, sends start failing, and the customer
 * keeps paying $8.99 a month for an account that does nothing. On a per-account
 * add-on that is the worst possible silent failure, so it gets an explicit
 * watchdog rather than waiting for someone to notice.
 *
 * Two signals, because neither alone is enough. `account.disconnected` is
 * immediate but only fires if Zernio observes the break; the periodic sweep
 * catches expiry that nobody reported, and warns *before* the token dies rather
 * than after.
 */
@Injectable()
export class InstagramHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(InstagramHealthService.name);
  private timer?: ReturnType<typeof setInterval>;

  /** Warn this far ahead of expiry, so there is time to act. */
  private static readonly EXPIRY_WARNING_MS = 7 * 24 * 60 * 60 * 1000;
  private static readonly SWEEP_MS = 6 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly zernio: ZernioService,
    private readonly alerts: SessionAlertService,
  ) {}

  onModuleInit() {
    if (!this.zernio.configured) return;
    this.timer = setInterval(
      () => void this.sweep(),
      InstagramHealthService.SWEEP_MS,
    );
    // Once shortly after boot, so a token that died while we were down is
    // noticed now rather than up to six hours later.
    setTimeout(() => void this.sweep(), 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Zernio told us an account dropped. */
  async onDisconnected(accountId: string): Promise<void> {
    const session = await this.prisma.waSession.findFirst({
      where: { externalAccountId: accountId, channel: Channel.INSTAGRAM },
      select: { id: true },
    });
    if (!session) return;
    await this.prisma.waSession.update({
      where: { id: session.id },
      data: { status: 'DISCONNECTED' },
    });
    if (await this.alerts.claimOutage(session.id)) {
      await this.alerts.alert(session.id, 'sessionLoggedOut');
    }
  }

  /** Zernio told us an account connected (or reconnected). */
  async onConnected(accountId: string, username?: string): Promise<void> {
    const session = await this.prisma.waSession.findFirst({
      where: { externalAccountId: accountId, channel: Channel.INSTAGRAM },
      select: { id: true },
    });
    if (!session) return;
    await this.prisma.waSession.update({
      where: { id: session.id },
      data: {
        status: 'CONNECTED',
        ...(username
          ? { externalHandle: username, label: `@${username}` }
          : {}),
      },
    });
    // Only worth an email if we had told them it was broken.
    if (await this.alerts.clearOutage(session.id)) {
      await this.alerts.alert(session.id, 'sessionRestored');
    }
  }

  /**
   * Reconcile every connected Instagram account against Zernio: flag the ones
   * it reports as needing reconnection, and warn about tokens about to expire.
   */
  async sweep(): Promise<void> {
    try {
      const sessions = await this.prisma.waSession.findMany({
        where: { channel: Channel.INSTAGRAM, externalAccountId: { not: null } },
        select: { id: true, externalAccountId: true, status: true },
      });
      if (sessions.length === 0) return;

      const accounts = await this.zernio.listAccounts();
      const byId = new Map(accounts.map((a) => [a._id, a]));

      for (const session of sessions) {
        const account = byId.get(session.externalAccountId!);
        // Gone from Zernio entirely: treat as disconnected rather than
        // guessing it might come back.
        const broken =
          !account ||
          account.needsReconnection === true ||
          account.isActive === false;

        if (broken) {
          if (session.status !== 'DISCONNECTED') {
            await this.prisma.waSession.update({
              where: { id: session.id },
              data: { status: 'DISCONNECTED' },
            });
          }
          if (await this.alerts.claimOutage(session.id)) {
            await this.alerts.alert(session.id, 'sessionLoggedOut');
          }
          continue;
        }

        // Healthy again after an outage we reported. The recovery email is
        // gated on the stored status, NOT on the alert flag: the expiry
        // warning below sets the same flag, so clearing it on every healthy
        // sweep would email "restored" and then "expiring" in a loop, twice a
        // sweep, for as long as the token was near expiry.
        if (session.status === 'DISCONNECTED') {
          await this.prisma.waSession.update({
            where: { id: session.id },
            data: { status: 'CONNECTED' },
          });
          if (await this.alerts.clearOutage(session.id)) {
            await this.alerts.alert(session.id, 'sessionRestored');
          }
        }

        // Expiring soon. Reuses the same claim slot, so the customer gets one
        // warning per expiry cycle rather than one every sweep; reconnecting
        // clears it and re-arms the warning for the next token.
        const expiresAt = account.tokenExpiresAt
          ? new Date(account.tokenExpiresAt).getTime()
          : null;
        if (
          expiresAt &&
          expiresAt - Date.now() < InstagramHealthService.EXPIRY_WARNING_MS
        ) {
          if (await this.alerts.claimOutage(session.id)) {
            this.log.warn(
              `Instagram token for session ${session.id} expires ${account.tokenExpiresAt}`,
            );
            await this.alerts.alert(session.id, 'sessionDown');
          }
        }
      }
    } catch (e) {
      this.log.warn(`Instagram health sweep failed: ${e}`);
    }
  }
}
