/**
 * What Instagram will actually accept as a DM attachment.
 *
 * Verified against the live API on 2026-08-11, not inferred from docs: a PNG,
 * a GIF, an MP4 and a WAV all sent successfully, while an `audio/mpeg` MP3 was
 * rejected by Meta itself (`IGApiException`, code 100, subcode 2534080,
 * "This attachment format is not supported"). The lists below are Meta's, from
 * developers.facebook.com/docs/messenger-platform/instagram/features/send-message.
 *
 * Two gaps matter more than they look:
 *
 * - **MP3 is not accepted.** It is the most common audio type on the web, so
 *   "audio works" is not the same as "audio works".
 * - **OGG/Opus is not accepted as audio.** WhatsApp voice notes are exactly
 *   that, so relaying one into an Instagram thread — the mirror feature's whole
 *   point — fails unless it is transcoded to m4a/aac/wav first. `ogg` appears
 *   in Meta's *video* list, which does not help a voice note.
 *
 * Failing here with a clear reason beats letting Meta reject it: the caller can
 * tell a human agent why their voice note did not arrive.
 */

export type InstagramAttachmentKind = 'image' | 'video' | 'audio' | 'file';

const MB = 1024 * 1024;

interface KindPolicy {
  readonly mimes: readonly string[];
  readonly maxBytes: number;
}

export const INSTAGRAM_ATTACHMENTS: Record<
  InstagramAttachmentKind,
  KindPolicy
> = {
  // Meta documents png and jpeg; gif is accepted in practice (verified).
  image: {
    mimes: ['image/png', 'image/jpeg', 'image/gif'],
    maxBytes: 8 * MB,
  },
  video: {
    mimes: [
      'video/mp4',
      'video/ogg',
      'video/x-msvideo',
      'video/avi',
      'video/quicktime',
      'video/webm',
    ],
    maxBytes: 25 * MB,
  },
  audio: {
    // Note the absence of audio/mpeg (mp3) and audio/ogg (Opus voice notes).
    mimes: [
      'audio/aac',
      'audio/mp4',
      'audio/m4a',
      'audio/x-m4a',
      'audio/wav',
      'audio/x-wav',
      'audio/wave',
    ],
    maxBytes: 25 * MB,
  },
  file: { mimes: ['application/pdf'], maxBytes: 25 * MB },
};

export type AttachmentVerdict =
  | { ok: true; kind: InstagramAttachmentKind }
  | { ok: false; reason: 'format' | 'size'; message: string };

const KINDS = Object.keys(
  INSTAGRAM_ATTACHMENTS,
) as readonly InstagramAttachmentKind[];

/** Strip parameters: `audio/ogg; codecs=opus` → `audio/ogg`. */
function baseMime(mimeType: string): string {
  return mimeType.split(';')[0].trim().toLowerCase();
}

/**
 * Can this file be sent as an Instagram DM attachment? Size is optional
 * because callers relaying a remote URL do not always know it up front.
 */
export function checkInstagramAttachment(
  mimeType: string,
  bytes?: number,
): AttachmentVerdict {
  const mime = baseMime(mimeType);
  const kind = KINDS.find((k) => INSTAGRAM_ATTACHMENTS[k].mimes.includes(mime));

  if (!kind) {
    return {
      ok: false,
      reason: 'format',
      message: transcodeHint(mime),
    };
  }
  const { maxBytes } = INSTAGRAM_ATTACHMENTS[kind];
  if (bytes != null && bytes > maxBytes) {
    return {
      ok: false,
      reason: 'size',
      message: `Instagram accepts ${kind} attachments up to ${Math.round(
        maxBytes / MB,
      )} MB; this one is ${(bytes / MB).toFixed(1)} MB.`,
    };
  }
  return { ok: true, kind };
}

/**
 * The two near-misses deserve a message that names the fix, because both are
 * things a human agent will hit while relaying from WhatsApp and neither is
 * obvious from "unsupported format".
 */
function transcodeHint(mime: string): string {
  if (mime === 'audio/ogg' || mime === 'application/ogg') {
    return 'Instagram does not accept OGG/Opus audio, which is what WhatsApp voice notes are. Convert to m4a, aac or wav first.';
  }
  if (mime === 'audio/mpeg' || mime === 'audio/mp3') {
    return 'Instagram does not accept MP3 audio. Convert to m4a, aac or wav first.';
  }
  return `Instagram does not accept ${mime} attachments.`;
}
