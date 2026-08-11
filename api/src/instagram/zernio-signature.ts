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
 * **Resolved 2026-08-11 by running `identifyScheme` against real deliveries.**
 * Two of them, a `message.received` and a `message.sent`, both reported
 * `body→x-zernio-signature, body→x-late-signature`: the digest is HMAC-SHA256
 * over the **raw request body**, and the two headers carry the same value
 * (`x-late-signature` appears to be a duplicate or legacy alias). Hence
 * `ZERNIO_SCHEME` below.
 *
 * `identifyScheme` is kept rather than deleted: it is how we would diagnose a
 * silent scheme change, which — given this API has returned "200 and quietly
 * wrong" three separate times — is worth being able to answer quickly.
 */

/** The scheme confirmed against live deliveries. */
export const ZERNIO_SCHEME: ZernioScheme = 'body';

/**
 * The authoritative header. `x-late-signature` carried an identical digest in
 * every observed delivery, so it is accepted as a fallback rather than relied
 * on.
 */
export const ZERNIO_SIGNATURE_HEADER = 'x-zernio-signature';
export const ZERNIO_SIGNATURE_HEADER_ALT = 'x-late-signature';

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
