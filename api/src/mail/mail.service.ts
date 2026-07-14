import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface PasswordResetEmail {
  to: string;
  resetUrl: string;
  /** Link lifetime shown in the email, e.g. "1 hour". */
  validFor: string;
}

export interface InvitationEmail {
  to: string;
  orgName: string;
  inviterName: string | null;
  role: string;
  inviteUrl: string;
  expiresAt: Date;
}

/**
 * Thin mail sender backed by the Resend REST API (plain fetch, no SDK).
 * Without RESEND_API_KEY it logs and no-ops — invite links shown in the UI
 * are the guaranteed delivery path.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  async sendInvitation(email: InvitationEmail): Promise<boolean> {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      this.logger.log(
        `RESEND_API_KEY not set — skipping invitation email to ${email.to}`,
      );
      return false;
    }

    const from = this.config.get<string>(
      'MAIL_FROM',
      'whathooks <onboarding@resend.dev>',
    );
    const inviter = email.inviterName ?? 'A teammate';
    const expires = email.expiresAt.toISOString().slice(0, 10);

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [email.to],
          subject: `${inviter} invited you to join ${email.orgName} on whathooks`,
          html: [
            `<p>${escapeHtml(inviter)} invited you to join <strong>${escapeHtml(email.orgName)}</strong> on whathooks as <strong>${email.role.toLowerCase()}</strong>.</p>`,
            `<p><a href="${email.inviteUrl}">Accept the invitation</a></p>`,
            `<p>This invitation expires on ${expires}. If you weren't expecting it, you can ignore this email.</p>`,
          ].join('\n'),
        }),
      });
      if (!res.ok) {
        this.logger.warn(
          `Resend responded ${res.status} for invitation to ${email.to}`,
        );
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn(`Failed to send invitation to ${email.to}: ${err}`);
      return false;
    }
  }

  async sendPasswordReset(email: PasswordResetEmail): Promise<boolean> {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      this.logger.log(
        `RESEND_API_KEY not set — skipping password reset email to ${email.to}`,
      );
      return false;
    }

    const from = this.config.get<string>(
      'MAIL_FROM',
      'whathooks <onboarding@resend.dev>',
    );

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [email.to],
          subject: 'Reset your whathooks password',
          html: [
            `<p>Someone requested a password reset for your whathooks account.</p>`,
            `<p><a href="${email.resetUrl}">Choose a new password</a></p>`,
            `<p>This link is valid for ${email.validFor} and can be used once. If you didn't request it, you can ignore this email — your password is unchanged.</p>`,
          ].join('\n'),
        }),
      });
      if (!res.ok) {
        this.logger.warn(
          `Resend responded ${res.status} for password reset to ${email.to}`,
        );
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn(`Failed to send password reset to ${email.to}: ${err}`);
      return false;
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
