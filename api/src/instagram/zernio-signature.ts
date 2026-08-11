import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verifying Zernio's webhook signature.
 *
 * What is known from a real delivery: two headers arrive, `x-zernio-signature`
 * and `x-late-signature`, each 64 hex characters — i.e. HMAC-SHA256, raw hex,
 * with no `sha256=` prefix and no timestamp-prefixed scheme. The secret is one
 * *we* supply when registering the endpoint, so there is nothing to discover
 * about key material.
 *
 * What is *not* known is which bytes are signed, and Zernio documents none of
 * it. Rather than guess and either reject real deliveries or accept forged
 * ones, `identifyScheme` computes every plausible candidate and reports which
 * matched. Run it in report-only mode until the logs show a scheme matching
 * consistently, then set that scheme and enforce.
 */

export type ZernioScheme =
  'body' | 'timestamp.body' | 'id.body' | 'timestamp+body';

/** The candidate messages, in the order they are worth believing. */
function candidates(
  raw: string,
  fields: { id?: string; timestamp?: string },
): Array<{ scheme: ZernioScheme; message: string }> {
  const out: Array<{ scheme: ZernioScheme; message: string }> = [
    { scheme: 'body', message: raw },
  ];
  if (fields.timestamp) {
    out.push({
      scheme: 'timestamp.body',
      message: `${fields.timestamp}.${raw}`,
    });
    out.push({
      scheme: 'timestamp+body',
      message: `${fields.timestamp}${raw}`,
    });
  }
  if (fields.id) out.push({ scheme: 'id.body', message: `${fields.id}${raw}` });
  return out;
}

function hmacHex(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message, 'utf8').digest('hex');
}

/** Constant-time compare of two hex digests of equal length. */
function hexEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

export interface SchemeReport {
  /** Which candidate matched which header, e.g. "body→x-zernio-signature". */
  matches: string[];
  /** Header names that carried a signature, for spotting shape changes. */
  present: string[];
}

/**
 * Report-only: which (scheme, header) pairs match? Logging this across real
 * deliveries is what tells us the scheme without risking a wrong guess.
 */
export function identifyScheme(
  raw: string,
  secret: string,
  headers: Record<string, string | undefined>,
  fields: { id?: string; timestamp?: string } = {},
): SchemeReport {
  const sigs = Object.entries(headers).filter(
    ([k, v]) => /signature/i.test(k) && !!v,
  ) as Array<[string, string]>;

  const matches: string[] = [];
  for (const { scheme, message } of candidates(raw, fields)) {
    const digest = hmacHex(secret, message);
    for (const [header, value] of sigs) {
      if (hexEquals(digest, value.trim().toLowerCase())) {
        matches.push(`${scheme}→${header}`);
      }
    }
  }
  return { matches, present: sigs.map(([k]) => k) };
}

/**
 * Enforcing check, once the scheme is known. Kept separate from
 * `identifyScheme` so that turning enforcement on is a deliberate one-line
 * change rather than a side effect of the diagnostic.
 */
export function verifyZernioSignature(
  raw: string,
  secret: string,
  signature: string | undefined,
  scheme: ZernioScheme,
  fields: { id?: string; timestamp?: string } = {},
): boolean {
  if (!signature) return false;
  const candidate = candidates(raw, fields).find((c) => c.scheme === scheme);
  if (!candidate) return false;
  return hexEquals(
    hmacHex(secret, candidate.message),
    signature.trim().toLowerCase(),
  );
}
