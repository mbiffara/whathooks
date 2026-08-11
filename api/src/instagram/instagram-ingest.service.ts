import { Injectable, Logger } from '@nestjs/common';
import {
  Channel,
  MessageDirection,
  MessageSource,
  MessageStatus,
  MessageType,
} from '@prisma/client';
import { AgentReplyService } from '../channels/agent-reply.service';
import { MessageStoreService } from '../channels/message-store.service';
import type { StagedMedia } from '../channels/message-store.service';
import { instagramAddress } from '../common/address';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookDispatchService } from '../webhooks/webhook-dispatch.service';
import { InstagramChannelDriver } from './instagram-channel.driver';
import { InstagramHealthService } from './instagram-health.service';
import {
  isMessageEvent,
  typeForAttachment,
  type ZernioAccountEvent,
  type ZernioMessageEvent,
} from './zernio-events';

/**
 * Turning a Zernio delivery into a conversation and a message.
 *
 * Three things here are not obvious and all three were learned the hard way
 * against the live API:
 *
 * 1. **Thread key.** Zernio has two conversation id spaces and the webhook
 *    leads with the wrong one: `message.conversationId` is internal and the
 *    REST API returns an empty 200 for it. Threads are keyed on
 *    `conversation.platformConversationId`.
 * 2. **Our own sends come back.** `message.sent` fires for API sends, not just
 *    messages typed in the Instagram app, so without dedupe every outbound
 *    message is stored twice. `platformMessageId` is the same value the send
 *    call returned, so it is the key.
 * 3. **Not every event is a message.** `webhook.test` is itself an event type
 *    and is not in the subscription list, so unknown events are ignored rather
 *    than parsed.
 */
@Injectable()
export class InstagramIngestService {
  private readonly log = new Logger(InstagramIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: MessageStoreService,
    private readonly webhooks: WebhookDispatchService,
    private readonly agentReply: AgentReplyService,
    private readonly driver: InstagramChannelDriver,
    private readonly health: InstagramHealthService,
  ) {}

  /**
   * Claim an event id. Returns false if it has been seen: the insert itself is
   * the claim, so two concurrent deliveries of the same event cannot both win.
   */
  private async claim(id: string, event: string): Promise<boolean> {
    try {
      await this.prisma.externalEvent.create({
        data: { id, provider: 'zernio', event },
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Process one verified delivery. Safe to call with anything. */
  async handle(payload: unknown): Promise<void> {
    const envelope = payload as { id?: string; event?: string };
    if (!envelope?.id || !envelope.event) return;

    if (!isMessageEvent(payload)) {
      if (!(await this.claim(envelope.id, envelope.event))) return;
      await this.handleNonMessage(payload as ZernioAccountEvent);
      return;
    }

    if (!(await this.claim(payload.id, payload.event))) {
      this.log.debug(`zernio ${payload.event} ${payload.id}: duplicate`);
      return;
    }
    await this.ingestMessage(payload);
  }

  /**
   * Account lifecycle. The rest (delivery receipts, reactions, edits,
   * webhook.test) is claimed and dropped for now, deliberately: acting on an
   * event whose payload we have never seen would be guessing.
   */
  private async handleNonMessage(e: ZernioAccountEvent): Promise<void> {
    const accountId = e.account?.accountId ?? e.account?.id;
    if (!accountId) return;
    if (e.event === 'account.disconnected') {
      await this.health.onDisconnected(accountId);
      return;
    }
    if (e.event === 'account.connected') {
      await this.health.onConnected(accountId, e.account?.username);
      return;
    }
    this.log.debug(`zernio ${e.event}: no handler yet`);
  }

  private async ingestMessage(e: ZernioMessageEvent): Promise<void> {
    const accountId = e.account.accountId ?? e.account.id;
    const session = await this.prisma.waSession.findFirst({
      where: { externalAccountId: accountId, channel: Channel.INSTAGRAM },
      select: { id: true, organizationId: true },
    });
    if (!session) {
      // One endpoint serves every customer, so an account we do not know is
      // routine, not an error: another tenant's, or one disconnected here but
      // still live at Zernio. Dropping it quietly is correct.
      this.log.warn(`zernio: no session for account ${accountId}`);
      return;
    }

    const outbound = e.message.direction === 'outgoing';
    const platformMessageId = e.message.platformMessageId;

    // Our own API sends echo back as message.sent. The send call already
    // stored the row with this id, so seeing it again means "already ours".
    if (outbound) {
      const existing = await this.prisma.message.findFirst({
        where: { sessionId: session.id, waMessageId: platformMessageId },
        select: { id: true },
      });
      if (existing) {
        this.log.debug(`zernio: echo of our own send ${platformMessageId}`);
        return;
      }
    }

    const attachment = e.message.attachments?.[0];
    const type = attachment
      ? (typeForAttachment(attachment.type) as MessageType)
      : MessageType.TEXT;
    // Fetch the bytes now. Instagram CDN links expire, so a URL kept for later
    // is a URL that stops working; and a message row carrying a type but no
    // asset renders as "unsupported message", which is worse than not storing
    // it at all because it looks like data loss to the operator.
    const media = attachment
      ? await this.stageAttachment(attachment)
      : undefined;

    const remoteJid = instagramAddress(e.conversation.platformConversationId);
    const handle =
      e.conversation.participantUsername ??
      e.conversation.participantName ??
      null;

    const result = await this.store.persist({
      sessionId: session.id,
      organizationId: session.organizationId,
      remoteJid,
      // Instagram has no phone number; the handle is the identity and lives
      // in `name`, which is what the inbox renders.
      name: handle,
      senderName: outbound ? null : (e.message.sender?.name ?? handle),
      direction: outbound
        ? MessageDirection.OUTBOUND
        : MessageDirection.INBOUND,
      fromMe: outbound,
      // An outbound message we have never seen was typed in the Instagram app
      // itself, exactly like WhatsApp's linked-device case.
      source: outbound ? MessageSource.DEVICE : MessageSource.CONTACT,
      type,
      text: e.message.text ?? null,
      waMessageId: platformMessageId,
      status: outbound ? MessageStatus.SENT : MessageStatus.RECEIVED,
      timestamp: e.message.sentAt ? new Date(e.message.sentAt) : new Date(),
      raw: e.message,
      media,
      incrementUnread: !outbound,
    });

    await this.webhooks.dispatch({
      organizationId: session.organizationId,
      sessionId: session.id,
      event: 'message.received',
      channel: Channel.INSTAGRAM,
      messageId: result.messageId,
      payload: {
        id: result.messageId,
        conversationId: result.conversationId,
        sessionId: session.id,
        channel: Channel.INSTAGRAM,
        from: remoteJid,
        isGroup: false,
        participant: null,
        mentionedMe: false,
        pushName: handle,
        type,
        text: e.message.text ?? null,
        // Our own copy, not Instagram's: their CDN links expire, so passing
        // the original through would hand subscribers a link that rots.
        media: result.mediaUrl
          ? { url: result.mediaUrl, mimeType: media?.mimeType ?? null }
          : null,
        waMessageId: platformMessageId,
        timestamp: e.message.sentAt ?? null,
      },
    });

    this.log.log(
      `instagram ${outbound ? 'out' : 'in'} on ${session.id}: ${type}`,
    );

    // Automation runs on inbound only: an outbound message is either ours
    // already or something the owner typed in the Instagram app, and replying
    // to either would be a loop.
    if (!outbound) {
      await this.maybeAgentReply(session.id, result.conversationId, remoteJid);
    }
  }

  /**
   * Download an attachment so it becomes ours.
   *
   * Never throws: a message that arrived is worth storing even if the media
   * could not be fetched. `refreshUrl` is the documented remedy for an expired
   * link, so it is tried before giving up.
   */
  private async stageAttachment(a: {
    url: string;
    refreshUrl?: string;
    type?: string;
  }): Promise<StagedMedia | undefined> {
    for (const url of [a.url, a.refreshUrl].filter(Boolean) as string[]) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const len = Number(res.headers.get('content-length') ?? 0);
        if (len > MAX_ATTACHMENT_BYTES) {
          this.log.warn(`instagram attachment too large (${len} bytes)`);
          return undefined;
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length > MAX_ATTACHMENT_BYTES) return undefined;
        return {
          buffer,
          // Instagram serves the real type; fall back to the attachment kind
          // so the file at least gets a sane extension in S3.
          mimeType:
            res.headers.get('content-type')?.split(';')[0].trim() ||
            FALLBACK_MIME[a.type ?? ''] ||
            'application/octet-stream',
          fileName: null,
        };
      } catch (err) {
        this.log.warn(`instagram attachment fetch failed: ${String(err)}`);
      }
    }
    return undefined;
  }

  /**
   * Let the session's agent answer. Fire-and-forget from the caller's point of
   * view: the message is already stored, so a failure here must not look like
   * a failed delivery.
   */
  private async maybeAgentReply(
    sessionId: string,
    conversationId: string,
    remoteJid: string,
  ): Promise<void> {
    const session = await this.prisma.waSession.findUnique({
      where: { id: sessionId },
      include: { agent: true },
    });
    if (!session?.agent) return;
    await this.agentReply.maybeReply({
      driver: this.driver,
      agent: session.agent,
      sessionId,
      organizationId: session.organizationId,
      conversationId,
      remoteJid,
      // No typing indicator on Instagram, so the shared service just waits out
      // the agent's configured delay. No mentions either: Instagram DMs are
      // one-to-one, so there is nobody to tag.
    });
  }
}

/** Meta's ceiling for DM attachments is 25 MB; refuse anything beyond it. */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Used only when the CDN response carries no usable content-type. */
const FALLBACK_MIME: Record<string, string> = {
  image: 'image/jpeg',
  video: 'video/mp4',
  audio: 'audio/mp4',
  file: 'application/pdf',
};
