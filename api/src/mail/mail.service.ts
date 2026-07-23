import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailContent, renderEmailHtml, renderEmailText } from './email-layout';
import { localeOf, MAIL_MESSAGES } from './messages';

export interface PasswordResetEmail {
  to: string;
  resetUrl: string;
  /** Recipient's language ("en" | "es"); anything else falls back to en. */
  locale?: string | null;
}

export interface InvitationEmail {
  to: string;
  orgName: string;
  inviterName: string | null;
  role: string;
  inviteUrl: string;
  expiresAt: Date;
  /** Inviter's language ("en" | "es") — the recipient's is unknown. */
  locale?: string | null;
}

export interface WelcomeEmail {
  to: string;
  name: string | null;
  /** Recipient's language ("en" | "es"); anything else falls back to en. */
  locale?: string | null;
}

export interface TrialEndingEmail {
  to: string;
  planLabel: string;
  trialEndsAt: Date;
  billingUrl: string;
  /** Recipient's language ("en" | "es"); anything else falls back to en. */
  locale?: string | null;
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
    const locale = localeOf(email.locale);
    const M = MAIL_MESSAGES[locale].invitation;
    const inviter = email.inviterName ?? M.fallbackInviter;
    const expires = email.expiresAt.toISOString().slice(0, 10);
    return this.send(email.to, {
      locale,
      subject: M.subject(inviter, email.orgName),
      preheader: M.preheader(email.orgName, expires),
      heading: M.heading(email.orgName),
      paragraphs: [
        M.body1(inviter, email.orgName, email.role.toLowerCase()),
        M.body2,
      ],
      cta: { label: M.cta, url: email.inviteUrl },
      footnote: M.footnote(expires),
    });
  }

  async sendPasswordReset(email: PasswordResetEmail): Promise<boolean> {
    const locale = localeOf(email.locale);
    const M = MAIL_MESSAGES[locale].passwordReset;
    return this.send(email.to, {
      locale,
      subject: M.subject,
      preheader: M.preheader(M.validFor),
      heading: M.heading,
      paragraphs: [M.body],
      cta: { label: M.cta, url: email.resetUrl },
      footnote: M.footnote(M.validFor),
    });
  }

  /** Personal founder hello, sent manually from the admin console. */
  async sendWelcome(email: WelcomeEmail): Promise<boolean> {
    const locale = localeOf(email.locale);
    const M = MAIL_MESSAGES[locale].welcome;
    return this.send(email.to, {
      locale,
      subject: M.subject,
      preheader: M.preheader,
      heading: M.heading(email.name),
      paragraphs: [M.body1, M.body2, M.body3],
      footnote: M.footnote,
      // Replies should land with Marcelo, not the send-only domain.
      replyTo: this.config.get<string>('MAIL_REPLY_TO', 'marcelo@logicalminds.co'),
    });
  }

  /** Heads-up ~3 days before a free trial converts into the first charge. */
  async sendTrialEnding(email: TrialEndingEmail): Promise<boolean> {
    const locale = localeOf(email.locale);
    const M = MAIL_MESSAGES[locale].trialEnding;
    const date = email.trialEndsAt.toISOString().slice(0, 10);
    return this.send(email.to, {
      locale,
      subject: M.subject,
      preheader: M.preheader(date),
      heading: M.heading,
      paragraphs: [M.body1(email.planLabel, date), M.body2],
      cta: { label: M.cta, url: email.billingUrl },
      footnote: M.footnote,
    });
  }

  /** Render through the shared layout and deliver via Resend. */
  private async send(
    to: string,
    content: EmailContent & { subject: string; replyTo?: string },
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
          ...(content.replyTo ? { reply_to: [content.replyTo] } : {}),
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
