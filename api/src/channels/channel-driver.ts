import type { Channel, MessageSource } from '@prisma/client';

/**
 * What a channel has to be able to do for the rest of the app.
 *
 * Deliberately narrow. This is the set of operations that non-WhatsApp code
 * actually calls — the inbox, the public message API, the flow engine — and
 * nothing more. Everything WhatsApp-shaped stays on ConnectionManagerService:
 * QR pairing, socket lifecycle, leader election, and the group primitives.
 *
 * Groups in particular are *not* here. Only WhatsApp lets a business account
 * open a multi-party thread, and a mirror group stays on a WhatsApp session
 * even when the lead it mirrors arrived over Instagram, so group operations
 * belong to that driver rather than to a channel-neutral contract.
 */
export interface ChannelDriver {
  readonly channel: Channel;

  /** Can this session send right now? */
  isLive(sessionId: string): boolean;

  /**
   * Normalise a caller-supplied recipient into the address this channel
   * stores, rejecting recipients it cannot reach. WhatsApp probes
   * `onWhatsApp()`; a channel with no such lookup may return the input.
   */
  resolveAddress(sessionId: string, to: string): Promise<string>;

  sendText(
    sessionId: string,
    to: string,
    text: string,
    opts?: SendOptions,
  ): Promise<SendResult>;

  sendMedia(
    sessionId: string,
    to: string,
    file: OutboundFile,
    caption?: string | null,
    opts?: SendOptions,
  ): Promise<MediaSendResult>;
}

export interface SendOptions {
  source?: MessageSource;
  agentId?: string;
  sentByUserId?: string;
  senderName?: string | null;
  /** WhatsApp group mentions; ignored by channels without them. */
  mentions?: string[];
}

export interface SendResult {
  /**
   * The provider's id for the sent message, used for delivery acks and
   * inbound dedupe. Named for WhatsApp because that is the column it lands
   * in (`Message.waMessageId`); other channels put their own id here.
   */
  waMessageId: string | null;
  /** Our `Message.id`. */
  messageId: string;
}

export interface MediaSendResult extends SendResult {
  mediaUrl?: string;
}

export interface OutboundFile {
  buffer: Buffer;
  mimeType: string;
  fileName?: string | null;
}
