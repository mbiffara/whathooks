import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  MessageDirection,
  MessageSource,
  MessageStatus,
  MessageType,
  WaSessionStatus,
} from '@prisma/client';
import makeWASocket, {
  AnyMessageContent,
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  proto,
  WAMessage,
  WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { createHash } from 'crypto';
import pino from 'pino';
import { AgentRunnerService } from '../agents/agent-runner.service';
import { MediaService } from '../media/media.service';
import { QuotaService } from '../billing/quota.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookDispatchService } from '../webhooks/webhook-dispatch.service';
import { usePrismaAuthState } from './baileys-auth-state';

const logger = pino({ level: 'error' });

interface LiveSession {
  sock: WASocket;
  saveCreds: () => Promise<void>;
  clearAuth: () => Promise<void>;
  starting: boolean;
}

@Injectable()
export class ConnectionManagerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ConnectionManagerService.name);
  private readonly sessions = new Map<string, LiveSession>();
  private readonly groupNames = new Map<string, string>(); // jid -> subject
  private shuttingDown = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhookDispatchService,
    private readonly media: MediaService,
    private readonly agentRunner: AgentRunnerService,
    private readonly quota: QuotaService,
  ) {}

  /** Restore previously-connected sockets after a restart. */
  async onModuleInit() {
    const sessions = await this.prisma.waSession.findMany({
      where: {
        status: { in: ['CONNECTED', 'CONNECTING', 'QR', 'DISCONNECTED'] },
      },
      select: { id: true },
    });
    this.log.log(`Restoring ${sessions.length} WhatsApp session(s)`);
    for (const s of sessions) {
      this.start(s.id).catch((e) =>
        this.log.error(`Failed to restore session ${s.id}: ${e}`),
      );
    }
  }

  async onModuleDestroy() {
    this.shuttingDown = true;
    for (const [, live] of this.sessions) {
      try {
        live.sock.end(undefined);
      } catch {
        /* ignore */
      }
    }
  }

  isLive(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** Number of live Baileys sockets currently held by this process. */
  getLiveSessionCount(): number {
    return this.sessions.size;
  }

  /** Boot (or reboot) the Baileys socket for a session. */
  async start(sessionId: string): Promise<void> {
    const existing = this.sessions.get(sessionId);
    if (existing?.starting) return;

    const session = await this.prisma.waSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new Error(`Session ${sessionId} not found`);

    // Tear down any previous socket for this session.
    if (existing) {
      try {
        existing.sock.end(undefined);
      } catch {
        /* ignore */
      }
      this.sessions.delete(sessionId);
    }

    const { state, saveCreds, clear } = await usePrismaAuthState(
      this.prisma,
      sessionId,
    );
    const { version } = await fetchLatestBaileysVersion().catch(() => ({
      version: undefined as unknown as [number, number, number],
    }));

    const sock = makeWASocket({
      version,
      logger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      browser: Browsers.appropriate('Chrome'),
      generateHighQualityLinkPreview: false,
      markOnlineOnConnect: false,
    });

    const live: LiveSession = {
      sock,
      saveCreds,
      clearAuth: clear,
      starting: true,
    };
    this.sessions.set(sessionId, live);

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) =>
      this.onConnectionUpdate(sessionId, update),
    );
    sock.ev.on('messages.upsert', (upsert) =>
      this.onMessages(sessionId, upsert),
    );
    sock.ev.on('groups.update', (updates) =>
      this.onGroupsUpdate(sessionId, updates),
    );

    live.starting = false;
  }

  // Keep group conversation titles in sync with the group subject.
  private async onGroupsUpdate(
    sessionId: string,
    updates: Array<{ id?: string | null; subject?: string | null }>,
  ) {
    for (const u of updates) {
      if (!u.id || !u.subject) continue;
      this.groupNames.set(u.id, u.subject);
      await this.prisma.conversation
        .updateMany({
          where: { sessionId, remoteJid: u.id },
          data: { name: u.subject },
        })
        .catch(() => undefined);
    }
  }

  /** Resolve (and cache) a group's subject; null for non-groups or on failure. */
  private async groupSubject(
    sessionId: string,
    jid: string,
  ): Promise<string | null> {
    const cached = this.groupNames.get(jid);
    if (cached) return cached;
    const sock = this.sessions.get(sessionId)?.sock;
    if (!sock) return null;
    try {
      const meta = await sock.groupMetadata(jid);
      if (meta?.subject) {
        this.groupNames.set(jid, meta.subject);
        return meta.subject;
      }
    } catch {
      /* metadata unavailable */
    }
    return null;
  }

  private async onConnectionUpdate(
    sessionId: string,
    update: Partial<{
      connection: string;
      lastDisconnect: { error?: Error };
      qr: string;
    }>,
  ) {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      await this.updateStatus(sessionId, WaSessionStatus.QR, { qr });
      await this.webhooks
        .dispatch({
          organizationId: await this.orgIdOf(sessionId),
          sessionId,
          event: 'session.qr',
          payload: { sessionId, qr },
        })
        .catch(() => undefined);
    }

    if (connection === 'connecting') {
      await this.updateStatus(sessionId, WaSessionStatus.CONNECTING);
    }

    if (connection === 'open') {
      const sock = this.sessions.get(sessionId)?.sock;
      const phoneNumber = sock?.user?.id
        ? jidNormalizedUser(sock.user.id).split('@')[0]
        : null;
      await this.updateStatus(sessionId, WaSessionStatus.CONNECTED, {
        qr: null,
        phoneNumber,
        lastConnectedAt: new Date(),
      });
      await this.dispatchStatus(sessionId, 'CONNECTED', { phoneNumber });
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      if (loggedOut) {
        await this.sessions.get(sessionId)?.clearAuth();
        this.sessions.delete(sessionId);
        await this.updateStatus(sessionId, WaSessionStatus.LOGGED_OUT, {
          qr: null,
        });
        await this.dispatchStatus(sessionId, 'LOGGED_OUT');
        return;
      }

      await this.updateStatus(sessionId, WaSessionStatus.DISCONNECTED);
      await this.dispatchStatus(sessionId, 'DISCONNECTED');

      if (!this.shuttingDown) {
        // reconnect with a small delay
        setTimeout(() => {
          this.start(sessionId).catch((e) =>
            this.log.error(`Reconnect failed for ${sessionId}: ${e}`),
          );
        }, 2_000);
      }
    }
  }

  private async onMessages(
    sessionId: string,
    upsert: { messages: WAMessage[]; type: string },
  ) {
    if (upsert.type !== 'notify') return;
    for (const msg of upsert.messages) {
      if (!msg.message || msg.key.fromMe) continue;
      try {
        await this.handleInbound(sessionId, msg);
      } catch (e) {
        this.log.error(`Inbound handling failed for ${sessionId}: ${e}`);
      }
    }
  }

  private async handleInbound(sessionId: string, msg: WAMessage) {
    const organizationId = await this.orgIdOf(sessionId);
    const remoteJid = msg.key.remoteJid ?? 'unknown';
    const isGroup = remoteJid.endsWith('@g.us');
    // For groups the conversation title is the group subject (pushName is the
    // individual sender, not the group); for 1:1 it's the contact's pushName.
    const contactName = isGroup
      ? await this.groupSubject(sessionId, remoteJid)
      : (msg.pushName ?? null);
    const described = describeMessage(msg);
    const timestamp = msg.messageTimestamp
      ? new Date(Number(msg.messageTimestamp) * 1000)
      : new Date();

    // Download media (if any) and stage it for storage.
    let media: StagedMedia | undefined;
    if (described.media) {
      try {
        const buffer = await downloadMediaMessage(
          msg,
          'buffer',
          {},
          {
            logger,
            reuploadRequest:
              this.sessions.get(sessionId)!.sock.updateMediaMessage,
          },
        );
        media = { ...described.media, buffer };
      } catch (e) {
        this.log.warn(`Media download failed for ${sessionId}: ${e}`);
      }
    }

    const result = await this.persistMessage({
      sessionId,
      organizationId,
      remoteJid,
      name: contactName,
      // In a group, pushName is the individual sender — keep it for agent context.
      senderName: isGroup ? (msg.pushName ?? null) : null,
      direction: MessageDirection.INBOUND,
      fromMe: false,
      source: MessageSource.CONTACT,
      type: described.type,
      text: described.text,
      waMessageId: msg.key.id ?? null,
      status: MessageStatus.RECEIVED,
      timestamp,
      raw: JSON.parse(JSON.stringify(msg.message)),
      media,
      incrementUnread: true,
    });

    await this.webhooks.dispatch({
      organizationId,
      sessionId,
      event: 'message.received',
      messageId: result.messageId,
      payload: {
        id: result.messageId,
        conversationId: result.conversationId,
        sessionId,
        from: remoteJid,
        pushName: msg.pushName ?? null,
        type: described.type,
        text: described.text,
        media: result.mediaUrl
          ? {
              url: result.mediaUrl,
              mimeType: media?.mimeType ?? null,
              fileName: media?.fileName ?? null,
            }
          : null,
        waMessageId: msg.key.id ?? null,
        timestamp: Math.floor(timestamp.getTime() / 1000),
      },
    });

    // Auto-reply if an enabled agent is assigned. In 1:1 the agent always
    // considers replying; in a group it only replies when the bot is @mentioned.
    if (!isGroup) {
      void this.maybeAgentReply(sessionId, remoteJid, result.conversationId);
    } else {
      const botNum = this.botNumber(sessionId);
      const senderJid = msg.key.participant ?? undefined;
      const mentioned =
        botNum != null &&
        extractMentions(msg).some((j) => j.split('@')[0] === botNum);
      if (mentioned && senderJid) {
        void this.maybeAgentReply(sessionId, remoteJid, result.conversationId, {
          jid: senderJid,
          number: senderJid.split('@')[0],
        });
      }
    }
  }

  /** The connected number's own msisdn (no domain), or null if not live. */
  private botNumber(sessionId: string): string | null {
    const id = this.sessions.get(sessionId)?.sock.user?.id;
    return id ? jidNormalizedUser(id).split('@')[0] : null;
  }

  /**
   * Show a "typing…" presence in the chat for `ms`, refreshing it periodically
   * (WhatsApp clears the composing state on its own after a few seconds).
   */
  private async typeAndWait(
    sessionId: string,
    jid: string,
    ms: number,
  ): Promise<void> {
    const live = this.sessions.get(sessionId);
    if (!live) return;
    const REFRESH = 4000;
    let elapsed = 0;
    try {
      await live.sock.sendPresenceUpdate('composing', jid);
      while (elapsed < ms && this.sessions.has(sessionId)) {
        const step = Math.min(REFRESH, ms - elapsed);
        await sleep(step);
        elapsed += step;
        if (elapsed < ms) await live.sock.sendPresenceUpdate('composing', jid);
      }
    } catch (e) {
      this.log.warn(`Typing indicator failed for ${sessionId}: ${e}`);
    } finally {
      // Clear the indicator; the outgoing message also resolves it.
      try {
        await live.sock.sendPresenceUpdate('paused', jid);
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * If the session has an enabled agent, generate and send a reply. When
   * `mention` is set (group reply), the reply tags that sender.
   */
  private async maybeAgentReply(
    sessionId: string,
    remoteJid: string,
    conversationId: string,
    mention?: { jid: string; number: string },
  ) {
    if (!this.agentRunner.isConfigured()) return;
    const session = await this.prisma.waSession.findUnique({
      where: { id: sessionId },
      include: { agent: true },
    });
    const agent = session?.agent;
    if (!agent || !agent.enabled) return;

    // Agents send on the org's behalf, so they respect the same quota gate as
    // manual sends (subscription + monthly cap). Skip quietly — an inbound
    // message must never fail because the reply was over quota. Checked before
    // generateReply so no LLM tokens are spent on a reply we can't send.
    try {
      await this.quota.assertCanSend(session.organizationId);
    } catch {
      this.log.warn(
        `Agent reply skipped for org ${session.organizationId}: over quota or no active subscription`,
      );
      return;
    }

    // An operator can pause the agent on a single conversation to reply manually.
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { agentPaused: true },
    });
    if (convo?.agentPaused) return;

    try {
      const reply = await this.agentRunner.generateReply(agent, conversationId);
      if (!reply) return;
      if (!this.sessions.has(sessionId)) return; // disconnected meanwhile

      // Send the reply text (if the agent produced any). In a group, tag the
      // sender — the text must carry the "@<number>" token to render a mention.
      if (reply.text) {
        const text = mention ? `@${mention.number} ${reply.text}` : reply.text;
        // Optional human-like pause: show a "typing…" indicator for a random
        // time in the agent's [min,max] window before actually sending.
        const delayMs = randomDelayMs(agent);
        if (delayMs > 0) await this.typeAndWait(sessionId, remoteJid, delayMs);
        await this.sendText(sessionId, remoteJid, text, {
          source: MessageSource.AGENT,
          agentId: agent.id,
          mentions: mention ? [mention.jid] : undefined,
        });
      }

      // The agent asked to hand off → pause it on this conversation until an
      // operator resumes. Same flag the operator toggles manually.
      if (reply.handoff) {
        await this.prisma.conversation.update({
          where: { id: conversationId },
          data: {
            agentPaused: true,
            agentPausedReason:
              reply.reason?.trim() || 'The agent wasn’t sure how to respond.',
          },
        });
        this.log.log(
          `Agent "${agent.name}" handed off conversation ${conversationId}` +
            (reply.reason ? `: ${reply.reason}` : ''),
        );
      }
    } catch (e) {
      this.log.error(`Agent reply failed for ${sessionId}: ${e}`);
    }
  }

  /** Send a text message. Returns the WhatsApp message id + stored message id. */
  async sendText(
    sessionId: string,
    to: string,
    text: string,
    opts: {
      source?: MessageSource;
      agentId?: string;
      sentByUserId?: string;
      mentions?: string[];
    } = {},
  ): Promise<{ waMessageId: string | null; messageId: string }> {
    const live = this.sessions.get(sessionId);
    if (!live) throw new Error('Session is not connected');

    const jid = toJid(to);
    const sent = await live.sock.sendMessage(jid, {
      text,
      ...(opts.mentions?.length ? { mentions: opts.mentions } : {}),
    });
    const organizationId = await this.orgIdOf(sessionId);

    const result = await this.persistMessage({
      sessionId,
      organizationId,
      remoteJid: jid,
      direction: MessageDirection.OUTBOUND,
      fromMe: true,
      source: opts.source ?? MessageSource.HUMAN,
      sentByUserId: opts.sentByUserId,
      agentId: opts.agentId,
      type: MessageType.TEXT,
      text,
      waMessageId: sent?.key?.id ?? null,
      status: MessageStatus.SENT,
      timestamp: new Date(),
      incrementUnread: false,
    });
    return { waMessageId: sent?.key?.id ?? null, messageId: result.messageId };
  }

  /** Send a media message (image/video/audio/document). */
  async sendMedia(
    sessionId: string,
    to: string,
    file: { buffer: Buffer; mimeType: string; fileName?: string | null },
    caption?: string | null,
    opts: {
      sentByUserId?: string;
      source?: MessageSource;
      agentId?: string;
    } = {},
  ): Promise<{
    waMessageId: string | null;
    messageId: string;
    mediaUrl?: string;
  }> {
    const live = this.sessions.get(sessionId);
    if (!live) throw new Error('Session is not connected');

    const jid = toJid(to);
    const kind = mediaKind(file.mimeType);
    const content = buildBaileysMedia(kind, file, caption);
    const sent = await live.sock.sendMessage(jid, content);
    const organizationId = await this.orgIdOf(sessionId);

    const result = await this.persistMessage({
      sessionId,
      organizationId,
      remoteJid: jid,
      direction: MessageDirection.OUTBOUND,
      fromMe: true,
      source: opts.source ?? MessageSource.HUMAN,
      sentByUserId: opts.sentByUserId,
      agentId: opts.agentId,
      type: kindToType(kind),
      text: caption ?? null,
      waMessageId: sent?.key?.id ?? null,
      status: MessageStatus.SENT,
      timestamp: new Date(),
      media: {
        buffer: file.buffer,
        mimeType: file.mimeType,
        fileName: file.fileName ?? null,
      },
      incrementUnread: false,
    });
    return {
      waMessageId: sent?.key?.id ?? null,
      messageId: result.messageId,
      mediaUrl: result.mediaUrl,
    };
  }

  /** Upsert the conversation, create the message row, store media. */
  private async persistMessage(p: {
    sessionId: string;
    organizationId: string;
    remoteJid: string;
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
  }): Promise<{
    messageId: string;
    conversationId: string;
    mediaUrl?: string;
  }> {
    const preview = p.text || mediaLabel(p.type);
    const isGroup = p.remoteJid.endsWith('@g.us');

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
        name: p.name ?? null,
        isGroup,
        lastMessageAt: p.timestamp,
        lastMessageText: preview,
        lastMessageType: p.type,
        unreadCount: p.incrementUnread ? 1 : 0,
      },
      update: {
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

    return { messageId: message.id, conversationId: conversation.id, mediaUrl };
  }

  /** Log out and remove the socket + persisted auth. */
  async logout(sessionId: string): Promise<void> {
    const live = this.sessions.get(sessionId);
    if (live) {
      try {
        await live.sock.logout();
      } catch {
        /* ignore */
      }
      try {
        live.sock.end(undefined);
      } catch {
        /* ignore */
      }
      await live.clearAuth();
      this.sessions.delete(sessionId);
    } else {
      const { clear } = await usePrismaAuthState(this.prisma, sessionId);
      await clear();
    }
    await this.updateStatus(sessionId, WaSessionStatus.LOGGED_OUT, {
      qr: null,
      phoneNumber: null,
    });
  }

  private async orgIdOf(sessionId: string): Promise<string> {
    const s = await this.prisma.waSession.findUnique({
      where: { id: sessionId },
      select: { organizationId: true },
    });
    if (!s) throw new Error(`Session ${sessionId} not found`);
    return s.organizationId;
  }

  private async updateStatus(
    sessionId: string,
    status: WaSessionStatus,
    extra: Record<string, unknown> = {},
  ) {
    await this.prisma.waSession
      .update({ where: { id: sessionId }, data: { status, ...extra } })
      .catch(() => undefined);
  }

  private async dispatchStatus(
    sessionId: string,
    status: string,
    extra: Record<string, unknown> = {},
  ) {
    const organizationId = await this.orgIdOf(sessionId).catch(() => null);
    if (!organizationId) return;
    await this.webhooks
      .dispatch({
        organizationId,
        sessionId,
        event: 'session.status',
        payload: { sessionId, status, ...extra },
      })
      .catch(() => undefined);
  }
}

interface MediaMeta {
  mimeType: string;
  fileName?: string | null;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
}
interface StagedMedia extends MediaMeta {
  buffer: Buffer;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** A random reply delay (ms) inside the agent's [min,max] window, else 0. */
function randomDelayMs(agent: {
  replyDelayMinSeconds: number;
  replyDelayMaxSeconds: number;
}): number {
  const min = Math.max(0, agent.replyDelayMinSeconds);
  const max = Math.max(min, agent.replyDelayMaxSeconds);
  if (max <= 0) return 0;
  return Math.round((min + Math.random() * (max - min)) * 1000);
}

/** JIDs @mentioned in a message (from whichever content type carries it). */
function extractMentions(msg: WAMessage): string[] {
  const m = msg.message ?? {};
  const ctx =
    m.extendedTextMessage?.contextInfo ??
    m.imageMessage?.contextInfo ??
    m.videoMessage?.contextInfo ??
    m.documentMessage?.contextInfo ??
    m.audioMessage?.contextInfo ??
    m.stickerMessage?.contextInfo ??
    null;
  return ctx?.mentionedJid ?? [];
}

function describeMessage(msg: WAMessage): {
  type: MessageType;
  text: string | null;
  media?: MediaMeta;
} {
  const m = msg.message ?? {};
  if (m.conversation) return { type: MessageType.TEXT, text: m.conversation };
  if (m.extendedTextMessage?.text)
    return { type: MessageType.TEXT, text: m.extendedTextMessage.text };
  if (m.imageMessage)
    return {
      type: MessageType.IMAGE,
      text: m.imageMessage.caption ?? null,
      media: {
        mimeType: m.imageMessage.mimetype ?? 'image/jpeg',
        width: num(m.imageMessage.width),
        height: num(m.imageMessage.height),
      },
    };
  if (m.videoMessage)
    return {
      type: MessageType.VIDEO,
      text: m.videoMessage.caption ?? null,
      media: {
        mimeType: m.videoMessage.mimetype ?? 'video/mp4',
        width: num(m.videoMessage.width),
        height: num(m.videoMessage.height),
        durationSeconds: num(m.videoMessage.seconds),
      },
    };
  if (m.audioMessage)
    return {
      type: MessageType.AUDIO,
      text: null,
      media: {
        mimeType: m.audioMessage.mimetype ?? 'audio/ogg',
        durationSeconds: num(m.audioMessage.seconds),
      },
    };
  if (m.documentMessage)
    return {
      type: MessageType.DOCUMENT,
      text: m.documentMessage.caption ?? null,
      media: {
        mimeType: m.documentMessage.mimetype ?? 'application/octet-stream',
        fileName: m.documentMessage.fileName ?? m.documentMessage.title ?? null,
      },
    };
  if (m.stickerMessage)
    return {
      type: MessageType.STICKER,
      text: null,
      media: { mimeType: m.stickerMessage.mimetype ?? 'image/webp' },
    };
  if (m.locationMessage) return { type: MessageType.LOCATION, text: null };
  if (m.contactMessage) return { type: MessageType.CONTACT, text: null };
  return { type: MessageType.UNKNOWN, text: null };
}

type MediaKind = 'image' | 'video' | 'audio' | 'document';
function mediaKind(mime: string): MediaKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}
function kindToType(kind: MediaKind): MessageType {
  return {
    image: MessageType.IMAGE,
    video: MessageType.VIDEO,
    audio: MessageType.AUDIO,
    document: MessageType.DOCUMENT,
  }[kind];
}
function buildBaileysMedia(
  kind: MediaKind,
  file: { buffer: Buffer; mimeType: string; fileName?: string | null },
  caption?: string | null,
): AnyMessageContent {
  const cap = caption ?? undefined;
  switch (kind) {
    case 'image':
      return {
        image: file.buffer,
        mimetype: file.mimeType,
        caption: cap,
      };
    case 'video':
      return {
        video: file.buffer,
        mimetype: file.mimeType,
        caption: cap,
      };
    case 'audio':
      return {
        audio: file.buffer,
        mimetype: file.mimeType,
        ptt: false,
      };
    default:
      return {
        document: file.buffer,
        mimetype: file.mimeType,
        fileName: file.fileName ?? 'file',
        caption: cap,
      };
  }
}
function mediaLabel(type: MessageType): string {
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
function extForMedia(mime: string, fileName?: string | null): string {
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

// Accept a bare msisdn ("15551234567"), or a full jid.
function toJid(to: string): string {
  if (to.includes('@')) return to;
  const digits = to.replace(/[^0-9]/g, '');
  return `${digits}@s.whatsapp.net`;
}

export { proto };
