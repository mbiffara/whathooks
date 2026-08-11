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
import { instagramAddress } from '../common/address';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookDispatchService } from '../webhooks/webhook-dispatch.service';
import { InstagramChannelDriver } from './instagram-channel.driver';
import {
  isMessageEvent,
  typeForAttachment,
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
      // account.connected/disconnected, delivery receipts, reactions,
      // webhook.test — all subscribed but not yet acted on. Claiming them
      // anyway keeps the ledger honest about what has been delivered.
      await this.claim(envelope.id, envelope.event);
      this.log.debug(`zernio ${envelope.event}: no handler yet`);
      return;
    }

    if (!(await this.claim(payload.id, payload.event))) {
      this.log.debug(`zernio ${payload.event} ${payload.id}: duplicate`);
      return;
    }
    await this.ingestMessage(payload);
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
        // Instagram CDN links expire, which is why the attachment carries a
        // refreshUrl; passing the raw url on would hand subscribers a link
        // that rots. Media staging into S3 comes with the driver work.
        media: null,
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
