import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';

export type SessionAlertKind =
  'sessionDown' | 'sessionLoggedOut' | 'sessionRestored';

/**
 * "Your connected account stopped working" emails.
 *
 * Shared because the recipient rule is subtle and must not be reimplemented
 * per channel: owners and admins always, plus members who either have no
 * session restriction or explicitly hold this one. Getting that wrong either
 * leaks which accounts exist or silently fails to tell the person who can fix
 * it.
 */
@Injectable()
export class SessionAlertService {
  private readonly log = new Logger(SessionAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async alert(sessionId: string, kind: SessionAlertKind): Promise<void> {
    try {
      const session = await this.prisma.waSession.findUnique({
        where: { id: sessionId },
        select: {
          label: true,
          phoneNumber: true,
          externalHandle: true,
          organizationId: true,
        },
      });
      if (!session) return;
      const memberships = await this.prisma.membership.findMany({
        where: { organizationId: session.organizationId },
        include: { user: { select: { email: true, locale: true } } },
        take: 20,
      });
      const recipients = memberships.filter(
        (m) =>
          m.role === 'OWNER' ||
          m.role === 'ADMIN' ||
          (m.role === 'MEMBER' &&
            (m.sessionIds.length === 0 || m.sessionIds.includes(sessionId))),
      );
      const base = this.config
        .get<string>('WEB_ORIGIN', 'http://localhost:3000')
        .split(',')[0]
        .trim();
      // The template's "phone" slot is really "which account is this": a
      // number on WhatsApp, a handle where there is no number.
      const identifier =
        session.phoneNumber ??
        (session.externalHandle ? `@${session.externalHandle}` : '');
      await Promise.all(
        recipients.map((m) =>
          this.mail.sendSessionAlert({
            to: m.user.email,
            locale: m.user.locale,
            kind,
            label: session.label,
            phone: identifier,
            sessionUrl: `${base}/dashboard/sessions`,
          }),
        ),
      );
      this.log.log(`Session ${sessionId} alert sent: ${kind}`);
    } catch (e) {
      this.log.warn(`Session alert failed for ${sessionId}: ${e}`);
    }
  }

  /**
   * Claim the right to send one alert for the current outage.
   *
   * Returns true only for the caller that flips `alertedDisconnectAt` from
   * null, so a repeated webhook, a retry, or two tasks overlapping during a
   * deploy cannot all email the customer about the same outage. Cleared by
   * `clearOutage` when the account comes back.
   */
  async claimOutage(sessionId: string): Promise<boolean> {
    const { count } = await this.prisma.waSession.updateMany({
      where: { id: sessionId, alertedDisconnectAt: null },
      data: { alertedDisconnectAt: new Date() },
    });
    return count === 1;
  }

  /** Returns true if there was an outage to clear (so "restored" is worth sending). */
  async clearOutage(sessionId: string): Promise<boolean> {
    const { count } = await this.prisma.waSession.updateMany({
      where: { id: sessionId, alertedDisconnectAt: { not: null } },
      data: { alertedDisconnectAt: null },
    });
    return count === 1;
  }
}
