import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailContent, renderEmailHtml, renderEmailText } from './email-layout';

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
 * are the guaranteed delivery path. All emails render through the shared
 * layout in email-layout.ts (multipart text+html).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  async sendInvitation(email: InvitationEmail): Promise<boolean> {
    const inviter = email.inviterName ?? 'A teammate';
    const expires = email.expiresAt.toISOString().slice(0, 10);
    return this.send(email.to, {
      subject: `${inviter} invited you to join ${email.orgName} on whathooks`,
      preheader: `Accept your invitation to ${email.orgName} — expires ${expires}.`,
      heading: `Join ${email.orgName} on whathooks`,
      paragraphs: [
        `${inviter} invited you to join ${email.orgName} on whathooks as ${email.role.toLowerCase()}.`,
        'whathooks connects WhatsApp numbers to webhooks, a REST API, and a shared team inbox.',
      ],
      cta: { label: 'Accept the invitation', url: email.inviteUrl },
      footnote: `This invitation expires on ${expires}. If you weren't expecting it, you can ignore this email.`,
    });
  }

  async sendPasswordReset(email: PasswordResetEmail): Promise<boolean> {
    return this.send(email.to, {
      subject: 'Reset your whathooks password',
      preheader: `Your reset link is valid for ${email.validFor}.`,
      heading: 'Reset your password',
      paragraphs: [
        'Someone requested a password reset for your whathooks account. Click the button below to choose a new password.',
      ],
      cta: { label: 'Choose a new password', url: email.resetUrl },
      footnote: `This link is valid for ${email.validFor} and can be used once. If you didn't request it, you can ignore this email — your password is unchanged.`,
    });
  }

  /** Render through the shared layout and deliver via Resend. */
  private async send(
    to: string,
    content: EmailContent & { subject: string },
  ): Promise<boolean> {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      this.logger.log(
        `RESEND_API_KEY not set — skipping "${content.subject}" to ${to}`,
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
          to: [to],
          subject: content.subject,
          html: renderEmailHtml(content),
          text: renderEmailText(content),
        }),
      });
      if (!res.ok) {
        this.logger.warn(
          `Resend responded ${res.status} for "${content.subject}" to ${to}`,
        );
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn(`Failed to send "${content.subject}" to ${to}: ${err}`);
      return false;
    }
  }
}
