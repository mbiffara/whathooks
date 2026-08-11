import { checkInstagramAttachment } from './instagram-media';

describe('checkInstagramAttachment', () => {
  it('accepts the types verified against the live API', () => {
    // Each of these was actually delivered to an Instagram thread on
    // 2026-08-11; they are regression anchors, not guesses.
    expect(checkInstagramAttachment('image/png')).toEqual({
      ok: true,
      kind: 'image',
    });
    expect(checkInstagramAttachment('image/gif')).toEqual({
      ok: true,
      kind: 'image',
    });
    expect(checkInstagramAttachment('video/mp4')).toEqual({
      ok: true,
      kind: 'video',
    });
    expect(checkInstagramAttachment('audio/x-wav')).toEqual({
      ok: true,
      kind: 'audio',
    });
  });

  it('rejects mp3, which Meta refused in practice', () => {
    const v = checkInstagramAttachment('audio/mpeg');
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toBe('format');
    expect(v.message).toMatch(/MP3/);
    expect(v.message).toMatch(/m4a/);
  });

  it('rejects WhatsApp voice notes and says why', () => {
    // The mirror feature relays these, so the message has to name the fix
    // rather than just refusing.
    const v = checkInstagramAttachment('audio/ogg; codecs=opus');
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.message).toMatch(/voice notes/);
    expect(v.message).toMatch(/m4a, aac or wav/);
  });

  it('ignores mime parameters and casing', () => {
    expect(checkInstagramAttachment('IMAGE/PNG')).toEqual({
      ok: true,
      kind: 'image',
    });
    expect(checkInstagramAttachment('audio/wav; rate=44100')).toEqual({
      ok: true,
      kind: 'audio',
    });
  });

  it('enforces the per-kind size ceiling', () => {
    const MB = 1024 * 1024;
    expect(checkInstagramAttachment('image/png', 7 * MB).ok).toBe(true);
    const big = checkInstagramAttachment('image/png', 9 * MB);
    expect(big.ok).toBe(false);
    if (big.ok) return;
    expect(big.reason).toBe('size');
    expect(big.message).toMatch(/8 MB/);

    // Video and audio get a higher ceiling than images.
    expect(checkInstagramAttachment('video/mp4', 20 * MB).ok).toBe(true);
    expect(checkInstagramAttachment('video/mp4', 30 * MB).ok).toBe(false);
  });

  it('skips the size check when the size is unknown', () => {
    expect(checkInstagramAttachment('image/png').ok).toBe(true);
  });

  it('returns kinds that are valid Meta attachment types', () => {
    // `kind` is sent verbatim as `attachmentType`, which Zernio forwards to
    // Meta's message[attachment][type]. Renaming any of these would make
    // attachments silently arrive as downloadable files instead of rendering.
    const META_TYPES = ['image', 'video', 'audio', 'file'];
    for (const mime of [
      'image/png',
      'video/mp4',
      'audio/wav',
      'application/pdf',
    ]) {
      const v = checkInstagramAttachment(mime);
      expect(v.ok).toBe(true);
      if (!v.ok) return;
      expect(META_TYPES).toContain(v.kind);
    }
  });

  it('still rejects mp3 even though audio is a valid type', () => {
    // Verified against the live API: MP3 fails with an explicit
    // attachmentType=audio too, so this is a format rule, not a typing bug.
    expect(checkInstagramAttachment('audio/mpeg').ok).toBe(false);
  });

  it('rejects an unrelated type without a transcode hint', () => {
    const v = checkInstagramAttachment('application/zip');
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.message).toBe(
      'Instagram does not accept application/zip attachments.',
    );
  });
});
