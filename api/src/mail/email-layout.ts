/**
 * Shared transactional email layout. Every email the platform sends renders
 * through this: a light 560px card with the whathooks wordmark, body copy, an
 * optional CTA button (with a copyable link fallback), and a footer crediting
 * logicalminds. Table-based markup with inline styles for email-client
 * compatibility, plus a plain-text alternative — multipart text+html scores
 * far better with spam filters than HTML-only.
 */

import { localeOf, MAIL_MESSAGES, MailLocale } from './messages';

export interface EmailContent {
  /** Language for the layout chrome (footer, link fallback). */
  locale?: MailLocale;
  /** Hidden preview line inboxes show next to the subject. */
  preheader: string;
  heading: string;
  /** Body copy paragraphs (plain text; HTML is escaped). */
  paragraphs: string[];
  cta?: { label: string; url: string };
  /** Small print under the body, e.g. expiry / "ignore this" note. */
  footnote?: string;
}

const BRAND = '#1da851'; // darker brand green — enough contrast on white
const FG = '#1c2420';
const MUTED = '#5f6d66';
const BG = '#f2f5f3';
const CARD = '#ffffff';
const BORDER = '#e2e8e4';

export function renderEmailHtml(c: EmailContent): string {
  const L = MAIL_MESSAGES[localeOf(c.locale)].layout;
  const paragraphs = c.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:${FG};">${escapeHtml(p)}</p>`,
    )
    .join('\n');

  const cta = c.cta
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;">
        <tr>
          <td style="border-radius:8px;background:${BRAND};">
            <a href="${escapeAttr(c.cta.url)}" target="_blank"
               style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">
              ${escapeHtml(c.cta.label)}
            </a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 16px;font-size:12px;line-height:18px;color:${MUTED};">
        ${escapeHtml(L.copyLink)}<br/>
        <a href="${escapeAttr(c.cta.url)}" style="color:${BRAND};word-break:break-all;">${escapeHtml(c.cta.url)}</a>
      </p>`
    : '';

  const footnote = c.footnote
    ? `<p style="margin:0;font-size:12px;line-height:18px;color:${MUTED};">${escapeHtml(c.footnote)}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="color-scheme" content="light"/>
  <title>${escapeHtml(c.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${BG};">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(c.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;">
          <tr>
            <td style="padding:0 8px 16px;">
              <span style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:18px;font-weight:700;color:${FG};">
                <span style="color:${BRAND};">●</span> whathooks
              </span>
            </td>
          </tr>
          <tr>
            <td style="background:${CARD};border:1px solid ${BORDER};border-radius:12px;padding:32px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              <h1 style="margin:0 0 16px;font-size:20px;line-height:28px;color:${FG};">${escapeHtml(c.heading)}</h1>
              ${paragraphs}
              ${cta}
              ${footnote}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 8px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:${MUTED};">
              ${escapeHtml(L.footerTagline)}
              <a href="https://logicalminds.co" style="color:${MUTED};">logicalminds</a><br/>
              ${escapeHtml(L.footerReason)}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Plain-text alternative with the same content. */
export function renderEmailText(c: EmailContent): string {
  const L = MAIL_MESSAGES[localeOf(c.locale)].layout;
  const lines = [c.heading, '', ...c.paragraphs.map((p) => p + '\n')];
  if (c.cta) lines.push(`${c.cta.label}: ${c.cta.url}`, '');
  if (c.footnote) lines.push(c.footnote, '');
  lines.push('—', `${L.footerTagline} logicalminds (https://logicalminds.co)`);
  return lines.join('\n');
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll("'", '&#39;');
}
