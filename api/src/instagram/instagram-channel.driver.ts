import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  Channel,
  MessageDirection,
  MessageSource,
  MessageStatus,
  MessageType,
} from '@prisma/client';
import type {
  ChannelDriver,
  MediaSendResult,
  OutboundFile,
  SendOptions,
  SendResult,
} from '../channels/channel-driver';
import {
  MessageStoreService,
  extForMedia,
} from '../channels/message-store.service';
import {
  instagramAddress,
  instagramConversationId,
  isInstagramAddress,
} from '../common/address';
import { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import { checkInstagramAttachment } from './instagram-media';
import type { InstagramAttachmentKind } from './instagram-media';
import { ZernioService } from './zernio.service';

/**
 * Sending on Instagram.
 *
 * Two things differ structurally from the WhatsApp driver:
 *
 * - **There is no socket**, so there is no separate liveness to check. The
 *   account is usable exactly when `WaSession.status` is CONNECTED, which is
 *   what every caller already tests before calling `isLive`.
 * - **Media is sent by URL, not by bytes.** Zernio fetches an `attachmentUrl`,
 *   so the object has to be in S3 *before* the send. The upload therefore
 *   happens here and the resulting key is handed to the store, which reuses it
 *   instead of writing a second copy.
 */
@Injectable()
export class InstagramChannelDriver implements ChannelDriver {
  readonly channel = Channel.INSTAGRAM;
  private readonly log = new Logger(InstagramChannelDriver.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly zernio: ZernioService,
    private readonly store: MessageStoreService,
    private readonly media: MediaService,
  ) {}

  /**
   * Always true. A webhook-delivered channel has nothing that is separately
   * "up": `WaSession.status` is the liveness signal, and every caller checks
   * it before reaching here. Returning a DB-backed answer would mean an extra
   * query per send to restate what the caller already knows.
   */
  isLive(): boolean {
    return true;
  }

  /**
   * Instagram threads are keyed on the platform conversation id, which for a
   * DM equals the participant's id. There is no lookup that turns an arbitrary
   * @handle into one, so callers pass an id we already know and this only
   * normalises the stored form.
   */
  resolveAddress(_sessionId: string, to: string): Promise<string> {
    const id = isInstagramAddress(to) ? instagramConversationId(to) : to;
    if (!id) throw new BadRequestException('Invalid Instagram conversation');
    return Promise.resolve(instagramAddress(id));
  }

  async sendText(
    sessionId: string,
    to: string,
    text: string,
    opts: SendOptions = {},
  ): Promise<SendResult> {
    const { session, conversationId } = await this.target(sessionId, to);
    const { messageId } = await this.zernio.sendMessage({
      accountId: session.externalAccountId,
      platformConversationId: conversationId,
      message: text,
    });
    return this.record(session, to, {
      opts,
      type: MessageType.TEXT,
      text,
      providerId: messageId,
    });
  }

  async sendMedia(
    sessionId: string,
    to: string,
    file: OutboundFile,
    caption?: string | null,
    opts: SendOptions = {},
  ): Promise<MediaSendResult> {
    const verdict = checkInstagramAttachment(file.mimeType, file.buffer.length);
    if (!verdict.ok) {
      // Refuse before spending an upload, and say what would fix it: the
      // common cases are an mp3 or a WhatsApp voice note, neither of which
      // Instagram accepts.
      throw new BadRequestException(verdict.message);
    }
    const { session, conversationId } = await this.target(sessionId, to);

    // Upload first: Zernio fetches the URL, so the object must exist before
    // the send. The key is reused by the store, so this is not a double write.
    const key = this.media.newKey(
      session.organizationId,
      session.id,
      extForMedia(file.mimeType, file.fileName),
    );
    await this.media.put(key, file.buffer, file.mimeType);
    const url = await this.media.viewUrl(
      key,
      file.mimeType,
      file.fileName ?? undefined,
    );

    const { messageId } = await this.zernio.sendMessage({
      accountId: session.externalAccountId,
      platformConversationId: conversationId,
      // Without attachmentType Zernio defaults to `file` and the recipient
      // gets a downloadable document instead of a photo or a playable clip —
      // with a 200 either way.
      attachmentType: verdict.kind,
      attachmentUrl: url,
      ...(caption ? { message: caption } : {}),
    });

    const result = await this.record(session, to, {
      opts,
      type: TYPE_FOR_KIND[verdict.kind],
      text: caption ?? null,
      providerId: messageId,
      media: { ...file, storageKey: key },
    });
    return result;
  }

  /** Resolve the session and the platform conversation id to send against. */
  private async target(sessionId: string, to: string) {
    const session = await this.prisma.waSession.findFirst({
      where: { id: sessionId, channel: Channel.INSTAGRAM },
      select: { id: true, organizationId: true, externalAccountId: true },
    });
    if (!session?.externalAccountId) {
      throw new BadRequestException('Instagram account is not connected');
    }
    const conversationId = isInstagramAddress(to)
      ? instagramConversationId(to)
      : to;
    if (!conversationId) {
      throw new BadRequestException('Invalid Instagram conversation');
    }
    return {
      session: { ...session, externalAccountId: session.externalAccountId },
      conversationId,
    };
  }

  /**
   * Store what we just sent. `waMessageId` is the provider's id, which is also
   * what `message.sent` echoes back moments later — the ingest suppresses that
   * echo by finding this row.
   */
  private async record(
    session: { id: string; organizationId: string },
    to: string,
    p: {
      opts: SendOptions;
      type: MessageType;
      text: string | null;
      providerId: string;
      media?: OutboundFile & { storageKey: string };
    },
  ): Promise<MediaSendResult> {
    const result = await this.store.persist({
      sessionId: session.id,
      organizationId: session.organizationId,
      remoteJid: isInstagramAddress(to) ? to : instagramAddress(to),
      direction: MessageDirection.OUTBOUND,
      fromMe: true,
      source: p.opts.source ?? MessageSource.HUMAN,
      agentId: p.opts.agentId,
      sentByUserId: p.opts.sentByUserId,
      senderName: p.opts.senderName ?? null,
      type: p.type,
      text: p.text,
      waMessageId: p.providerId,
      status: MessageStatus.SENT,
      timestamp: new Date(),
      incrementUnread: false,
      ...(p.media
        ? {
            media: {
              buffer: p.media.buffer,
              mimeType: p.media.mimeType,
              fileName: p.media.fileName ?? null,
              storageKey: p.media.storageKey,
            },
          }
        : {}),
    });
    return {
      waMessageId: p.providerId,
      messageId: result.messageId,
      mediaUrl: result.mediaUrl,
    };
  }
}

const TYPE_FOR_KIND: Record<InstagramAttachmentKind, MessageType> = {
  image: MessageType.IMAGE,
  video: MessageType.VIDEO,
  audio: MessageType.AUDIO,
  file: MessageType.DOCUMENT,
};
