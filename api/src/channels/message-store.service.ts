import { Injectable } from '@nestjs/common';
import {
  MessageDirection,
  MessageSource,
  MessageStatus,
  MessageType,
} from '@prisma/client';
import { createHash } from 'crypto';
import { isGroupAddress } from '../common/address';
import { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Writing an inbound or outbound message to the database.
 *
 * Lifted out of ConnectionManagerService unchanged in behaviour: it was
 * already channel-neutral in substance (upsert the thread, insert the row,
 * push media to S3) and only lived there because that class owned the sockets.
 * Instagram needs exactly this and cannot depend on Baileys to get it.
 *
 * The one thing that did not come along is the profile-picture refresh, which
 * needs a live WhatsApp socket. Rather than reach back into the transport,
 * `persist` reports `avatarStale` and the caller refreshes if it can.
 */
@Injectable()
export class MessageStoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  /** Avatars are re-fetched at most once a day. */
  private static readonly AVATAR_TTL_MS = 24 * 60 * 60 * 1000;

  async persist(p: PersistMessageParams): Promise<PersistedMessage> {
    const preview = p.text || mediaLabel(p.type);
    const isGroup = isGroupAddress(p.remoteJid);

    const conversation = await this.prisma.conversation.upsert({
      where: {
        sessionId_remoteJid: {
          sessionId: p.sessionId,
          remoteJid: p.remoteJid,
        },
      },
      create: {
        organizationId: p.organizationId,
        sessionId: p.sessionId,
        remoteJid: p.remoteJid,
        phoneNumber: p.phoneNumber ?? null,
        name: p.name ?? null,
        isGroup,
        lastMessageAt: p.timestamp,
        lastMessageText: preview,
        lastMessageType: p.type,
        unreadCount: p.incrementUnread ? 1 : 0,
      },
      update: {
        // undefined leaves a known number in place when a later message
        // arrives without one.
        phoneNumber: p.phoneNumber ?? undefined,
        name: p.name ?? undefined,
        lastMessageAt: p.timestamp,
        lastMessageText: preview,
        lastMessageType: p.type,
        ...(p.incrementUnread ? { unreadCount: { increment: 1 } } : {}),
      },
    });

    const message = await this.prisma.message.create({
      data: {
        organizationId: p.organizationId,
        conversationId: conversation.id,
        sessionId: p.sessionId,
        waMessageId: p.waMessageId ?? null,
        direction: p.direction,
        fromMe: p.fromMe,
        source: p.source,
        senderName: p.senderName ?? null,
        agentId: p.agentId ?? null,
        sentByUserId: p.sentByUserId ?? null,
        type: p.type,
        text: p.text ?? null,
        status: p.status,
        timestamp: p.timestamp,
        raw: p.raw ? p.raw : undefined,
      },
    });

    let mediaUrl: string | undefined;
    if (p.media?.buffer) {
      const ext = extForMedia(p.media.mimeType, p.media.fileName);
      const key = this.media.newKey(p.organizationId, p.sessionId, ext);
      await this.media.put(key, p.media.buffer, p.media.mimeType);
      await this.prisma.mediaAsset.create({
        data: {
          messageId: message.id,
          storageKey: key,
          mimeType: p.media.mimeType,
          fileName: p.media.fileName ?? null,
          size: p.media.buffer.length,
          width: p.media.width ?? null,
          height: p.media.height ?? null,
          durationSeconds: p.media.durationSeconds ?? null,
          sha256: createHash('sha256').update(p.media.buffer).digest('hex'),
        },
      });
      mediaUrl = await this.media.viewUrl(
        key,
        p.media.mimeType,
        p.media.fileName ?? undefined,
      );
    }

    return {
      messageId: message.id,
      conversationId: conversation.id,
      mediaUrl,
      avatarStale:
        !conversation.avatarFetchedAt ||
        Date.now() - conversation.avatarFetchedAt.getTime() >
          MessageStoreService.AVATAR_TTL_MS,
    };
  }
}

export interface MediaMeta {
  mimeType: string;
  fileName?: string | null;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
}

export interface StagedMedia extends MediaMeta {
  buffer: Buffer;
}

export interface PersistMessageParams {
  sessionId: string;
  organizationId: string;
  remoteJid: string;
  /** Contact phone digits when remoteJid is a LID; never overwritten with null. */
  phoneNumber?: string | null;
  name?: string | null;
  senderName?: string | null;
  direction: MessageDirection;
  fromMe: boolean;
  source: MessageSource;
  agentId?: string;
  sentByUserId?: string;
  type: MessageType;
  text?: string | null;
  waMessageId?: string | null;
  status: MessageStatus;
  timestamp: Date;
  raw?: unknown;
  media?: StagedMedia;
  incrementUnread: boolean;
}

export interface PersistedMessage {
  messageId: string;
  conversationId: string;
  mediaUrl?: string;
  /** The thread's avatar is older than a day; refresh it if the channel can. */
  avatarStale: boolean;
}

export function mediaLabel(type: MessageType): string {
  return (
    {
      [MessageType.IMAGE]: '📷 Photo',
      [MessageType.VIDEO]: '🎥 Video',
      [MessageType.AUDIO]: '🎤 Audio',
      [MessageType.DOCUMENT]: '📄 Document',
      [MessageType.STICKER]: 'Sticker',
      [MessageType.LOCATION]: '📍 Location',
      [MessageType.CONTACT]: '👤 Contact',
      [MessageType.TEXT]: '',
      [MessageType.UNKNOWN]: 'Message',
    }[type] || 'Message'
  );
}

export function extForMedia(mime: string, fileName?: string | null): string {
  if (fileName && fileName.includes('.')) return fileName.split('.').pop()!;
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'application/pdf': 'pdf',
  };
  return map[mime] ?? mime.split('/')[1] ?? 'bin';
}
