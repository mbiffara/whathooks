import { createHmac } from 'crypto';
import { identifyScheme, verifyZernioSignature } from './zernio-signature';

const SECRET = 'a'.repeat(64);
const RAW =
  '{"id":"evt-1","event":"message.received","timestamp":"2026-08-11T13:43:50.138Z"}';
const FIELDS = { id: 'evt-1', timestamp: '2026-08-11T13:43:50.138Z' };

const sign = (msg: string) =>
  createHmac('sha256', SECRET).update(msg, 'utf8').digest('hex');

describe('identifyScheme', () => {
  it('names the scheme and header that matched', () => {
    const r = identifyScheme(
      RAW,
      SECRET,
      { 'x-zernio-signature': sign(RAW) },
      FIELDS,
    );
    expect(r.matches).toEqual(['body→x-zernio-signature']);
    expect(r.present).toEqual(['x-zernio-signature']);
  });

  it('distinguishes a timestamp-prefixed scheme', () => {
    const r = identifyScheme(
      RAW,
      SECRET,
      { 'x-zernio-signature': sign(`${FIELDS.timestamp}.${RAW}`) },
      FIELDS,
    );
    expect(r.matches).toEqual(['timestamp.body→x-zernio-signature']);
  });

  it('reports both headers when they use different schemes', () => {
    // The real deliveries carry x-zernio-signature and x-late-signature; this
    // is how we learn whether they cover the same bytes.
    const r = identifyScheme(
      RAW,
      SECRET,
      {
        'x-zernio-signature': sign(RAW),
        'x-late-signature': sign(`${FIELDS.timestamp}.${RAW}`),
      },
      FIELDS,
    );
    expect(r.matches.sort()).toEqual([
      'body→x-zernio-signature',
      'timestamp.body→x-late-signature',
    ]);
  });

  it('matches nothing when the secret is wrong', () => {
    const r = identifyScheme(
      RAW,
      'b'.repeat(64),
      { 'x-zernio-signature': sign(RAW) },
      FIELDS,
    );
    expect(r.matches).toEqual([]);
    expect(r.present).toEqual(['x-zernio-signature']);
  });

  it('ignores non-signature headers', () => {
    const r = identifyScheme(RAW, SECRET, {
      'content-type': 'application/json',
      'x-request-id': 'abc',
    });
    expect(r.present).toEqual([]);
  });
});

describe('verifyZernioSignature', () => {
  it('accepts a correct signature for the configured scheme', () => {
    expect(verifyZernioSignature(RAW, SECRET, sign(RAW), 'body', FIELDS)).toBe(
      true,
    );
  });

  it('rejects a signature computed over different bytes', () => {
    expect(
      verifyZernioSignature(
        RAW,
        SECRET,
        sign(`${FIELDS.timestamp}.${RAW}`),
        'body',
        FIELDS,
      ),
    ).toBe(false);
  });

  it('rejects a tampered body', () => {
    const forged = RAW.replace('message.received', 'message.sent');
    expect(verifyZernioSignature(forged, SECRET, sign(RAW), 'body')).toBe(
      false,
    );
  });

  it('rejects a missing or malformed signature', () => {
    expect(verifyZernioSignature(RAW, SECRET, undefined, 'body')).toBe(false);
    expect(verifyZernioSignature(RAW, SECRET, 'not-hex', 'body')).toBe(false);
    expect(verifyZernioSignature(RAW, SECRET, 'abc123', 'body')).toBe(false);
  });

  it('is case-insensitive about hex', () => {
    expect(
      verifyZernioSignature(RAW, SECRET, sign(RAW).toUpperCase(), 'body'),
    ).toBe(true);
  });
});
