import { Channel } from '@prisma/client';
import type { FlowNodeType } from '../flows/flow-graph';
import {
  checkInstagramAttachment,
  type AttachmentVerdict,
} from '../instagram/instagram-media';

/**
 * What each channel can actually do.
 *
 * This exists because the same bug shipped twice: a flow enabled on an
 * Instagram session did nothing, and a Mirror Link on an Instagram session did
 * nothing. Both were configurable, both looked correct, and both failed in
 * silence. Each was fixed by teaching the *runtime* about channels, which does
 * not stop the next one — the editors still offer whatever they like.
 *
 * One table, read by validation and by the UI, so a new channel inherits every
 * guard instead of reintroducing every gap.
 */
export interface ChannelCapabilities {
  /**
   * Can a business account open a multi-party thread here? Only WhatsApp can,
   * which is why a mirror group for an Instagram lead is hosted on a WhatsApp
   * number rather than on the lead's own channel.
   */
  hostsGroups: boolean;
  /** Group mentions ("@5491122334455"), a WhatsApp group concept. */
  mentions: boolean;
  /** Connected by scanning a QR, as opposed to an OAuth redirect. */
  qrPairing: boolean;
  /** Can show a "typing…" indicator while an agent composes. */
  typingIndicator: boolean;
  /**
   * Will this channel deliver a file of this type and size? Instagram takes
   * a short list of formats (no MP3, no Opus, PDF as the only document);
   * WhatsApp takes anything under its size cap. Asked at flow save time so
   * a node that can never deliver is refused in the editor, not mid-chat.
   */
  attachment: (mimeType: string, bytes?: number) => AttachmentVerdict;
}

const MB = 1024 * 1024;
/** Baileys uploads happily past this, but WhatsApp clients stop rendering. */
const WHATSAPP_MAX_ATTACHMENT_BYTES = 64 * MB;

function checkWhatsappAttachment(
  mimeType: string,
  bytes?: number,
): AttachmentVerdict {
  if (bytes != null && bytes > WHATSAPP_MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      reason: 'size',
      message: `WhatsApp accepts files up to ${WHATSAPP_MAX_ATTACHMENT_BYTES / MB} MB; this one is ${(bytes / MB).toFixed(1)} MB.`,
    };
  }
  const mime = mimeType.split(';')[0].trim().toLowerCase();
  const kind = mime.startsWith('image/')
    ? 'image'
    : mime.startsWith('video/')
      ? 'video'
      : mime.startsWith('audio/')
        ? 'audio'
        : 'file';
  return { ok: true, kind };
}

export const CHANNEL_CAPABILITIES: Record<Channel, ChannelCapabilities> = {
  WHATSAPP: {
    hostsGroups: true,
    mentions: true,
    qrPairing: true,
    typingIndicator: true,
    attachment: checkWhatsappAttachment,
  },
  INSTAGRAM: {
    hostsGroups: false,
    mentions: false,
    qrPairing: false,
    typingIndicator: false,
    attachment: checkInstagramAttachment,
  },
};

/**
 * Flow nodes that hand a conversation to a human through a mirror group.
 *
 * They still work on a channel that cannot host groups, but only by borrowing
 * a WhatsApp number — so they need one to exist. Without it the flow throws
 * mid-conversation with a customer waiting, which is the failure this whole
 * file is meant to move to configuration time.
 */
export const GROUP_HANDOFF_NODES: FlowNodeType[] = [
  'assignHuman',
  'roundRobin',
  'assignGroup',
  'assignContactAgent',
];

export function capabilitiesOf(channel: Channel): ChannelCapabilities {
  return CHANNEL_CAPABILITIES[channel] ?? CHANNEL_CAPABILITIES.WHATSAPP;
}
