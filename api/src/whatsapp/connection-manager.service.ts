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
  fetchLatestWaWebVersion,
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
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { REDIS_PUB } from '../common/redis/redis.module';
import { MailService } from '../mail/mail.service';
import { agentActiveNow } from './agent-schedule';
import { FlowEngineService } from './flow-engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookDispatchService } from '../webhooks/webhook-dispatch.service';
import { usePrismaAuthState } from './baileys-auth-state';

// Baileys internals log at debug/warn (device enumeration, session asserts);
// crank BAILEYS_LOG_LEVEL up temporarily when diagnosing delivery issues.
const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL ?? 'error' });

interface LiveSession {
  sock: WASocket;
  saveCreds: () => Promise<void>;
  clearAuth: () => Promise<void>;
  starting: boolean;
}

/** Inbound-message context shared by the automation layers (mirror, flows). */
export interface InboundAutomationCtx {
  conversationId: string;
  remoteJid: string;
  isGroup: boolean;
  senderJid?: string;
  senderAltJid?: string;
  mentionedMe: boolean;
  pushName: string | null;
  type: MessageType;
  text: string | null;
  media?: { buffer: Buffer; mimeType: string; fileName?: string | null };
}

@Injectable()
export class ConnectionManagerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ConnectionManagerService.name);
  private readonly sessions = new Map<string, LiveSession>();
  private readonly groupNames = new Map<string, string>(); // jid -> subject
  // Consecutive reconnect failures per session (drives backoff; reset on open).
  private readonly reconnectAttempts = new Map<string, number>();
  // Mirror-link config per session, cached briefly (looked up per message).
  private readonly mirrorLinkCache = new Map<
    string,
    {
      link: {
        id: string;
        agentNumber: string;
        groupPrefix: string;
        showLeadName: boolean;
        humanAgentId: string | null;
      } | null;
      expires: number;
    }
  >();
  // Sessions being logged out on purpose (dashboard/API) — suppresses the
  // "unlinked" alert email that fires on surprise logouts.
  private readonly intentionalLogouts = new Set<string>();
  private shuttingDown = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhookDispatchService,
    private readonly media: MediaService,
    private readonly agentRunner: AgentRunnerService,
    private readonly quota: QuotaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly flowEngine: FlowEngineService,
    @Inject(REDIS_PUB) private readonly redis: Redis,
  ) {}

  /**
   * Session leadership: exactly one task may run the Baileys sockets. During
   * start-then-stop deploys both tasks serve HTTP, but the new one waits for
   * the old to release this Redis lock (SIGTERM → releaseLeadership) before
   * connecting sessions — keeping the WhatsApp handover to seconds while HTTP
   * never drops.
   */
  private static readonly LEADER_KEY = 'whathooks:session-leader';
  private static readonly LEADER_TTL_MS = 20_000;
  private readonly instanceId = randomUUID();
  private isLeader = false;
  private leadershipTimer?: ReturnType<typeof setInterval>;

  /** Acquire/renew leadership; on first acquisition restore the sockets. */
  async onModuleInit() {
    const tick = async () => {
      if (this.shuttingDown) return;
      try {
        const key = ConnectionManagerService.LEADER_KEY;
        const ttl = ConnectionManagerService.LEADER_TTL_MS;
        const acquired = await this.redis.set(
          key,
          this.instanceId,
          'PX',
          ttl,
          'NX',
        );
        if (acquired) {
          if (!this.isLeader) {
            this.isLeader = true;
            this.log.log('Acquired session leadership');
            await this.restoreSessions();
          }
          return;
        }
        const holder = await this.redis.get(key);
        if (holder === this.instanceId) {
          await this.redis.pexpire(key, ttl);
          if (!this.isLeader) {
            this.isLeader = true;
            await this.restoreSessions();
          }
        } else if (this.isLeader) {
          // Should not happen while healthy — another task took over.
          this.log.warn('Lost session leadership — closing sockets');
          this.isLeader = false;
          this.closeAllSockets();
        }
      } catch (e) {
        this.log.warn(`Leadership tick failed: ${e}`);
      }
    };
    void tick();
    this.leadershipTimer = setInterval(() => void tick(), 5_000);
  }

  private async restoreSessions() {
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

  private closeAllSockets() {
    for (const [, live] of this.sessions) {
      try {
        live.sock.end(undefined);
      } catch {
        /* ignore */
      }
    }
    this.sessions.clear();
  }

  async onModuleDestroy() {
    this.shuttingDown = true;
    if (this.leadershipTimer) clearInterval(this.leadershipTimer);
    this.closeAllSockets();
    // Release the lock only if we hold it, so the next task takes over fast.
    if (this.isLeader) {
      try {
        const holder = await this.redis.get(
          ConnectionManagerService.LEADER_KEY,
        );
        if (holder === this.instanceId) {
          await this.redis.del(ConnectionManagerService.LEADER_KEY);
        }
        this.log.log('Released session leadership');
      } catch {
        /* the TTL will expire it */
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
    if (!this.isLeader && !this.shuttingDown) {
      throw new ServiceUnavailableException(
        'A deploy is finishing up — try again in a few seconds.',
      );
    }
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
    // Ask WhatsApp itself for the current web version — logging in with an
    // older build number gets refused with failure 405 once WA bumps the
    // minimum (happened 2026-07-28; Baileys' baked list lags). Fall back to
    // Baileys' list, then to the library default.
    const { version } = await fetchLatestWaWebVersion({})
      .catch(() => fetchLatestBaileysVersion())
      .catch(() => ({
        version: undefined as unknown as [number, number, number],
      }));
    this.log.log(
      `Starting ${sessionId} with WA web version ${version?.join('.') ?? 'default'}`,
    );

    // Tag Baileys' own logs (decrypt failures, stream errors) with the session
    // so prod incidents are attributable to a number without DB access.
    const sessionLogger = logger.child({ sessionId });
    const sock = makeWASocket({
      version,
      logger: sessionLogger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, sessionLogger),
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
    sock.ev.on('messages.update', (updates) =>
      this.onMessageStatusUpdates(sessionId, updates),
    );

    live.starting = false;
  }

  /**
   * Track server acks for outbound messages. Most importantly: the server can
   * REJECT a send after sendMessage resolves (e.g. error 463 — missing privacy
   * token when cold-messaging a stranger). Without this, the row stays "SENT"
   * while nothing was delivered.
   */
  private async onMessageStatusUpdates(
    sessionId: string,
    updates: Array<{
      key: { id?: string | null };
      update: { status?: number | null; messageStubParameters?: string[] };
    }>,
  ) {
    for (const { key, update } of updates) {
      const waMessageId = key?.id;
      const status = update?.status;
      if (!waMessageId || status == null) continue;
      // proto.WebMessageInfo.Status: ERROR=0, DELIVERY_ACK=3, READ=4
      if (status === 0) {
        const code = update.messageStubParameters?.[0];
        const error = `WhatsApp rejected the message${code ? ` (error ${code})` : ''}`;
        this.log.warn(
          `Outbound ${waMessageId} on ${sessionId} failed: ${error}`,
        );
        await this.prisma.message
          .updateMany({
            where: {
              sessionId,
              waMessageId,
              direction: MessageDirection.OUTBOUND,
            },
            data: { status: MessageStatus.FAILED, error },
          })
          .catch(() => undefined);
      } else if (status === 3 || status === 4) {
        await this.prisma.message
          .updateMany({
            where: {
              sessionId,
              waMessageId,
              direction: MessageDirection.OUTBOUND,
              // Never downgrade READ back to DELIVERED on late acks.
              status: {
                in:
                  status === 4
                    ? [
                        MessageStatus.QUEUED,
                        MessageStatus.SENT,
                        MessageStatus.DELIVERED,
                      ]
                    : [MessageStatus.QUEUED, MessageStatus.SENT],
              },
            },
            data: {
              status:
                status === 4 ? MessageStatus.READ : MessageStatus.DELIVERED,
            },
          })
          .catch(() => undefined);
      }
    }
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
      this.reconnectAttempts.delete(sessionId);
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
      // Close the outage loop: if we alerted about this session being down,
      // tell the same people it recovered.
      const alerted = await this.prisma.waSession.findUnique({
        where: { id: sessionId },
        select: { alertedDisconnectAt: true },
      });
      if (alerted?.alertedDisconnectAt) {
        await this.prisma.waSession.update({
          where: { id: sessionId },
          data: { alertedDisconnectAt: null },
        });
        void this.alertSession(sessionId, 'sessionRestored');
      }
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      this.log.warn(
        `Session ${sessionId} closed: status ${statusCode ?? 'n/a'} ` +
          `(${(lastDisconnect?.error as Error)?.message ?? 'no error'})`,
      );

      if (loggedOut) {
        await this.sessions.get(sessionId)?.clearAuth();
        this.sessions.delete(sessionId);
        await this.updateStatus(sessionId, WaSessionStatus.LOGGED_OUT, {
          qr: null,
        });
        await this.dispatchStatus(sessionId, 'LOGGED_OUT');
        // Unlinking never self-heals — alert immediately (once per outage),
        // unless the logout was requested from the dashboard/API.
        if (!this.intentionalLogouts.has(sessionId)) {
          void this.markAlertedAndNotify(sessionId, 'sessionLoggedOut');
        }
        return;
      }

      await this.updateStatus(sessionId, WaSessionStatus.DISCONNECTED);
      await this.dispatchStatus(sessionId, 'DISCONNECTED');

      if (!this.shuttingDown) {
        // Exponential backoff with jitter. A fixed short delay hammers
        // WhatsApp when a session flaps (e.g. reconnecting through a big
        // offline backlog) — WA answers with 503 throttling and the loop
        // never converges. Reset on a successful 'open'.
        const attempts = (this.reconnectAttempts.get(sessionId) ?? 0) + 1;
        this.reconnectAttempts.set(sessionId, attempts);
        const delay =
          Math.min(2_000 * 2 ** (attempts - 1), 300_000) +
          Math.floor(Math.random() * 1_000);
        if (attempts > 3) {
          this.log.warn(
            `Session ${sessionId} reconnect attempt ${attempts}; ` +
              `waiting ${Math.round(delay / 1000)}s`,
          );
        }
        // ~1 minute of continuous failure (2+4+8+16+32s) → alert the team.
        // Deploy blips never reach this; the flag makes it once per outage.
        if (attempts === 5) {
          void this.markAlertedAndNotify(sessionId, 'sessionDown');
        }
        setTimeout(() => {
          this.start(sessionId).catch((e) =>
            this.log.error(`Reconnect failed for ${sessionId}: ${e}`),
          );
        }, delay);
      }
    }
  }

  private async onMessages(
    sessionId: string,
    upsert: { messages: WAMessage[]; type: string },
  ) {
    if (upsert.type !== 'notify') return;
    for (const msg of upsert.messages) {
      if (msg.key.fromMe) continue;
      if (!msg.message) {
        // Decryption failed (missing sender key — common in LID groups):
        // Baileys emits a CIPHERTEXT stub and asks the sender to re-send.
        // Nothing is persisted and no webhook fires, so leave a trace.
        if (msg.messageStubType === proto.WebMessageInfo.StubType.CIPHERTEXT) {
          this.log.warn(
            `Undecryptable message on ${sessionId} in ${msg.key.remoteJid} ` +
              `(sender ${msg.key.participant ?? msg.key.remoteJid}, ` +
              `waMessageId ${msg.key.id}) — retry requested from sender`,
          );
        }
        continue;
      }
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

    // Reactions attach to the message they target — no new row, no unread
    // bump, no preview change. An empty emoji means the reaction was removed.
    const reaction = msg.message?.reactionMessage;
    if (reaction) {
      await this.applyReaction(sessionId, {
        targetWaMessageId: reaction.key?.id ?? null,
        emoji: reaction.text ?? '',
        reactor: msg.key.participant ?? remoteJid,
        reactorName: msg.pushName ?? null,
      });
      return;
    }
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

    // Group context: who wrote (participant JID) and whether the connected
    // number was @mentioned — consumers use this to reply only when addressed.
    // Mentions in LID-addressed groups carry the account's LID, not its phone
    // number, so match against every identity of the connected account.
    const botIds = this.botUserIds(sessionId);
    const senderJid = msg.key.participant ?? undefined;
    const mentionedMe = extractMentions(msg).some((j) =>
      botIds.has(j.split('@')[0]),
    );

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
        isGroup,
        participant: isGroup ? (senderJid ?? null) : null,
        mentionedMe,
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

    // Everything that reacts to an inbound message (mirror relay, flows,
    // agent auto-replies) runs through one composition point.
    // In LID-addressed groups `participant` is the sender's LID; the phone
    // number rides in `participantAlt` — pass both for sender matching.
    void this.runAutomation(sessionId, {
      conversationId: result.conversationId,
      remoteJid,
      isGroup,
      senderJid,
      senderAltJid:
        (msg.key as { participantAlt?: string | null }).participantAlt ??
        undefined,
      mentionedMe,
      pushName: msg.pushName ?? null,
      type: described.type,
      text: described.text,
      media,
    });
  }

  /**
   * Post-webhook automation for one inbound message.
   * Groups: mirror-thread relay (rep → lead), then @mention agent replies.
   * DMs, in priority order: an existing mirror thread owns the conversation
   * (relay only); an enabled Flow takes over the session; a static MirrorLink
   * creates the thread on first contact; otherwise the session's assigned
   * agent may auto-reply.
   */
  private async runAutomation(
    sessionId: string,
    ctx: InboundAutomationCtx,
  ): Promise<void> {
    try {
      if (ctx.isGroup) {
        await this.mirrorGroupRelay(sessionId, ctx);
        if (ctx.mentionedMe && ctx.senderJid) {
          void this.maybeAgentReply(
            sessionId,
            ctx.remoteJid,
            ctx.conversationId,
            { jid: ctx.senderJid, number: ctx.senderJid.split('@')[0] },
          );
        }
        return;
      }

      // Session setting: keep the contact book in sync on every inbound DM.
      void this.autoSaveContact(sessionId, ctx);

      // A mirrored conversation is owned by its human agent — relay and stop.
      const thread = await this.prisma.mirrorThread.findUnique({
        where: { sessionId_leadJid: { sessionId, leadJid: ctx.remoteJid } },
      });
      if (thread) {
        await this.forwardLeadToGroup(sessionId, thread, ctx);
        return;
      }

      // An enabled flow takes over the session's automation.
      const flow = await this.flowEngine.enabledFlowFor(sessionId);
      if (flow) {
        await this.flowEngine.run(flow, sessionId, ctx, this);
        return;
      }

      // Legacy: a static mirror link creates the thread on first contact…
      const link = await this.mirrorLinkFor(sessionId);
      if (link) {
        const created = await this.createMirrorThread(
          sessionId,
          ctx.remoteJid,
          [{ id: link.humanAgentId, number: link.agentNumber }],
          {
            prefix: link.groupPrefix,
            showLeadName: link.showLeadName,
            linkId: link.id,
          },
        );
        await this.forwardLeadToGroup(sessionId, created, ctx);
        return;
      }

      // …otherwise the session's assigned agent may reply.
      void this.maybeAgentReply(sessionId, ctx.remoteJid, ctx.conversationId);
    } catch (e) {
      this.log.warn(`Automation failed on ${sessionId}: ${e}`);
    }
  }

  /** Auto-save the sender as a contact when the session opted in. */
  private async autoSaveContact(
    sessionId: string,
    ctx: InboundAutomationCtx,
  ): Promise<void> {
    try {
      const session = await this.prisma.waSession.findUnique({
        where: { id: sessionId },
        select: { saveContacts: true },
      });
      if (!session?.saveContacts) return;
      await this.flowEngine.saveContact(sessionId, ctx);
    } catch (e) {
      this.log.warn(`Auto-save contact failed on ${sessionId}: ${e}`);
    }
  }

  /** Rep → lead: relay a mirror-group message written by the human agent. */
  private async mirrorGroupRelay(
    sessionId: string,
    ctx: InboundAutomationCtx,
  ): Promise<void> {
    const thread = await this.prisma.mirrorThread.findUnique({
      where: { sessionId_groupJid: { sessionId, groupJid: ctx.remoteJid } },
    });
    if (!thread) return;
    // The sender may be addressed by LID with the phone in senderAltJid —
    // accept a match on either identity. Team groups list every agent
    // number in agentNumbers; single-agent threads only have agentNumber.
    const allowed = thread.agentNumbers.length
      ? thread.agentNumbers
      : [thread.agentNumber];
    const senderNumbers = [ctx.senderJid, ctx.senderAltJid]
      .filter((j): j is string => Boolean(j))
      .map((j) => j.split(':')[0]?.split('@')[0]);
    const matched = senderNumbers.find((n) => allowed.includes(n));
    if (!matched) {
      this.log.log(
        `Mirror thread ${thread.id}: ignoring group message from ` +
          `${senderNumbers.join('/') || 'unknown'} ` +
          `(agents: ${allowed.join(', ')})`,
      );
      return;
    }
    // Attribute the lead's stored copy to whichever agent actually wrote.
    const organizationId = await this.orgIdOf(sessionId).catch(() => null);
    const human = organizationId
      ? await this.prisma.humanAgent.findFirst({
          where: { organizationId, phoneNumber: matched },
          select: { name: true },
        })
      : null;
    await this.relayMirrorMessage(
      sessionId,
      thread.leadJid,
      ctx,
      '',
      human?.name ?? null,
    );
  }

  /** Lead → group: forward a lead's DM into their mirror group. */
  async forwardLeadToGroup(
    sessionId: string,
    thread: { groupJid: string; showLeadName: boolean },
    ctx: InboundAutomationCtx,
  ): Promise<void> {
    // *…* renders bold on WhatsApp. Every relayed lead message carries a
    // speaker prefix — the display name, or a generic "Lead:" when the name
    // is hidden (or missing). Keeps transcripts unambiguous once other
    // actors (AI agents) join mirror groups.
    const prefix =
      thread.showLeadName && ctx.pushName ? `*${ctx.pushName}:* ` : `*Lead:* `;
    await this.relayMirrorMessage(sessionId, thread.groupJid, ctx, prefix);
  }

  /**
   * Create the WhatsApp group + thread row binding a lead to one or more
   * human agents (any listed agent may reply as the brand). Shared by the
   * static MirrorLink path and the Flow assign nodes.
   */
  async createMirrorThread(
    sessionId: string,
    leadJid: string,
    agents: Array<{ id?: string | null; number: string }>,
    opts: { prefix: string; showLeadName: boolean; linkId?: string | null },
  ) {
    if (agents.length === 0) throw new Error('Mirror thread needs an agent');
    const seq =
      (await this.prisma.mirrorThread.count({ where: { sessionId } })) + 1;
    const group = await this.createGroup(
      sessionId,
      `${opts.prefix} #${seq}`,
      agents.map((a) => a.number),
    );
    const thread = await this.prisma.mirrorThread.create({
      data: {
        sessionId,
        linkId: opts.linkId ?? null,
        humanAgentId: agents[0].id ?? null,
        agentNumber: agents[0].number,
        agentNumbers: agents.length > 1 ? agents.map((a) => a.number) : [],
        showLeadName: opts.showLeadName,
        leadJid,
        groupJid: group.id,
        seq,
      },
    });
    this.log.log(
      `Mirror thread ${thread.id}: created group ${group.id} ` +
        `("${opts.prefix} #${seq}") on ${sessionId}`,
    );
    return thread;
  }

  /**
   * Send a mirrored message: media re-uploaded, text prefixed, rest stubbed.
   * `senderName` attributes the stored copy (e.g. the human agent's name on
   * a rep → lead relay) so the inbox doesn't label it as a plain API send.
   */
  async relayMirrorMessage(
    sessionId: string,
    to: string,
    m: {
      type: MessageType;
      text: string | null;
      media?: { buffer: Buffer; mimeType: string; fileName?: string | null };
    },
    prefix: string,
    senderName?: string | null,
  ): Promise<void> {
    const opts = { source: MessageSource.MIRROR, senderName };
    if (m.media) {
      await this.sendMedia(
        sessionId,
        to,
        {
          buffer: m.media.buffer,
          mimeType: m.media.mimeType,
          fileName: m.media.fileName ?? undefined,
        },
        m.text ? `${prefix}${m.text}` : prefix || undefined,
        opts,
      );
      return;
    }
    if (m.text) {
      await this.sendText(sessionId, to, `${prefix}${m.text}`, opts);
      return;
    }
    // Location/contact/unknown without a downloadable payload.
    await this.sendText(
      sessionId,
      to,
      `${prefix}[${m.type.toLowerCase()}]`,
      opts,
    );
  }

  /** Enabled mirror link for a session, cached briefly (checked per message). */
  private async mirrorLinkFor(sessionId: string): Promise<{
    id: string;
    agentNumber: string;
    groupPrefix: string;
    showLeadName: boolean;
    humanAgentId: string | null;
  } | null> {
    const cached = this.mirrorLinkCache.get(sessionId);
    if (cached && cached.expires > Date.now()) return cached.link;
    const link = await this.prisma.mirrorLink.findUnique({
      where: { sessionId },
      select: {
        id: true,
        agentNumber: true,
        groupPrefix: true,
        showLeadName: true,
        humanAgentId: true,
        enabled: true,
      },
    });
    const value = link?.enabled
      ? {
          id: link.id,
          agentNumber: link.agentNumber,
          groupPrefix: link.groupPrefix,
          showLeadName: link.showLeadName,
          humanAgentId: link.humanAgentId,
        }
      : null;
    this.mirrorLinkCache.set(sessionId, {
      link: value,
      expires: Date.now() + 30_000,
    });
    return value;
  }

  /** Create a WhatsApp group with the given participant numbers. */
  async createGroup(
    sessionId: string,
    subject: string,
    numbers: string[],
  ): Promise<{ id: string }> {
    const live = this.sessions.get(sessionId);
    if (!live) throw new Error('Session is not connected');
    const meta = await live.sock.groupCreate(
      subject,
      numbers.map((n) => toJid(n)),
    );
    return { id: meta.id };
  }

  /**
   * Leave a group. Used when a mirror is removed: the "<brand> left" system
   * message is the human agent's signal that replies stop relaying.
   */
  async leaveGroup(sessionId: string, groupJid: string): Promise<void> {
    const live = this.sessions.get(sessionId);
    if (!live) throw new Error('Session is not connected');
    await live.sock.groupLeave(groupJid);
  }

  /**
   * Validate a recipient on WhatsApp via the live socket and return its
   * canonical JID (WhatsApp may normalize the number, e.g. AR mobile 549…).
   * Group JIDs pass through untouched — they can't be probed.
   */
  async resolveJid(sessionId: string, to: string): Promise<string> {
    const live = this.sessions.get(sessionId);
    if (!live) {
      throw new ServiceUnavailableException('Session is not connected');
    }
    const jid = toJid(to);
    if (jid.endsWith('@g.us')) return jid;
    const hit = await live.sock
      .onWhatsApp(jid)
      .then((r) => r?.[0])
      .catch(() => undefined);
    if (!hit?.exists) {
      throw new BadRequestException('This number is not on WhatsApp');
    }
    this.log.log(`resolveJid on ${sessionId}: ${to} -> ${hit.jid}`);
    // USync may answer with the contact's LID instead of the phone JID.
    // Keep the phone-number form: sends to @lid silently vanish on Baileys
    // rc13, and inbound threads are keyed by phone JID anyway.
    return hit.jid.endsWith('@lid') ? jid : hit.jid;
  }

  /**
   * Every user-part identifying the connected account: msisdn AND LID (groups
   * on WhatsApp's newer privacy addressing mention the LID). Empty if the
   * session isn't live.
   */
  private botUserIds(sessionId: string): Set<string> {
    const me = this.sessions.get(sessionId)?.sock.user;
    const ids = new Set<string>();
    for (const jid of [me?.id, me?.lid, me?.phoneNumber]) {
      if (jid) ids.add(jidNormalizedUser(jid).split('@')[0]);
    }
    return ids;
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
  /**
   * One AI reply on behalf of a Flow agentReply node (explicit agent, not the
   * session's). Returns what happened so the flow can branch on handoff.
   * `pauseOnHandoff` applies the legacy side effects (agentPaused + email)
   * only when the flow has no onHandoff edge to continue into.
   */
  async runAgentReply(
    sessionId: string,
    conversationId: string,
    remoteJid: string,
    agentId: string,
    opts: { pauseOnHandoff: boolean },
  ): Promise<'replied' | 'handoff' | 'skipped'> {
    if (!this.agentRunner.isConfigured()) return 'skipped';
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
    });
    if (!agent || !agent.enabled) return 'skipped';
    if (!agentActiveNow(agent)) return 'skipped';
    try {
      await this.quota.assertCanSend(agent.organizationId);
    } catch {
      this.log.warn(
        `Flow agent reply skipped for org ${agent.organizationId}: over quota`,
      );
      return 'skipped';
    }
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { agentPaused: true },
    });
    if (convo?.agentPaused) return 'skipped';

    const reply = await this.agentRunner.generateReply(agent, conversationId);
    if (!reply) return 'skipped';
    if (!this.sessions.has(sessionId)) return 'skipped';

    if (reply.text) {
      const delayMs = randomDelayMs(agent);
      if (delayMs > 0) await this.typeAndWait(sessionId, remoteJid, delayMs);
      await this.sendText(sessionId, remoteJid, reply.text, {
        source: MessageSource.AGENT,
        agentId: agent.id,
      });
    }
    if (reply.notify) {
      void this.notifyOwner(
        agent.organizationId,
        conversationId,
        agent.name,
        reply.notify,
      );
    }
    if (reply.handoff) {
      const reason =
        reply.reason?.trim() || 'The agent wasn’t sure how to respond.';
      if (opts.pauseOnHandoff) {
        await this.prisma.conversation.update({
          where: { id: conversationId },
          data: { agentPaused: true, agentPausedReason: reason },
        });
        if (agent.notifyOnHandoff) {
          void this.notifyHandoff(
            agent.organizationId,
            sessionId,
            conversationId,
            agent.name,
            reason,
          );
        }
      }
      return 'handoff';
    }
    return 'replied';
  }

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
    if (!agentActiveNow(agent)) return; // outside its scheduled hours

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

      // The agent called notify_owner → email the account owner. Does not
      // pause the agent (unlike handoff).
      if (reply.notify) {
        void this.notifyOwner(
          session.organizationId,
          conversationId,
          agent.name,
          reply.notify,
        );
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
        if (agent.notifyOnHandoff) {
          void this.notifyHandoff(
            session.organizationId,
            sessionId,
            conversationId,
            agent.name,
            reply.reason?.trim() || 'The agent wasn’t sure how to respond.',
          );
        }
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
      senderName?: string | null;
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
      senderName: opts.senderName ?? null,
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
      senderName?: string | null;
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
      senderName: opts.senderName ?? null,
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

  /**
   * Stamp the once-per-outage flag and send a down/unlinked alert. Skips
   * silently when an alert for the current outage already went out (flag
   * survives restarts, so deploys don't re-send).
   */
  private async markAlertedAndNotify(
    sessionId: string,
    kind: 'sessionDown' | 'sessionLoggedOut',
  ): Promise<void> {
    try {
      const { count } = await this.prisma.waSession.updateMany({
        where: { id: sessionId, alertedDisconnectAt: null },
        data: { alertedDisconnectAt: new Date() },
      });
      if (count === 0) return; // already alerted for this outage
      await this.alertSession(sessionId, kind);
    } catch (e) {
      this.log.warn(`Session alert failed for ${sessionId}: ${e}`);
    }
  }

  /**
   * Email the people who work this session (owner/admins + members with
   * access) about a session outage or recovery.
   */
  private async alertSession(
    sessionId: string,
    kind: 'sessionDown' | 'sessionLoggedOut' | 'sessionRestored',
  ): Promise<void> {
    try {
      const session = await this.prisma.waSession.findUnique({
        where: { id: sessionId },
        select: { label: true, phoneNumber: true, organizationId: true },
      });
      if (!session) return;
      const memberships = await this.prisma.membership.findMany({
        where: { organizationId: session.organizationId },
        include: { user: { select: { email: true, locale: true } } },
        take: 20,
      });
      const recipients = memberships.filter(
        (m) =>
          m.role === 'OWNER' ||
          m.role === 'ADMIN' ||
          (m.role === 'MEMBER' &&
            (m.sessionIds.length === 0 || m.sessionIds.includes(sessionId))),
      );
      const base = this.config
        .get<string>('WEB_ORIGIN', 'http://localhost:3000')
        .split(',')[0]
        .trim();
      await Promise.all(
        recipients.map((m) =>
          this.mail.sendSessionAlert({
            to: m.user.email,
            locale: m.user.locale,
            kind,
            label: session.label,
            phone: session.phoneNumber ?? '',
            sessionUrl: `${base}/dashboard/sessions/${sessionId}`,
          }),
        ),
      );
      this.log.log(`Session ${sessionId} alert sent: ${kind}`);
    } catch (e) {
      this.log.warn(`Session alert failed for ${sessionId}: ${e}`);
    }
  }

  /** The agent's notify_owner tool: email the organization owner. */
  private async notifyOwner(
    organizationId: string,
    conversationId: string,
    agentName: string,
    message: string,
  ): Promise<void> {
    try {
      const [convo, owner] = await Promise.all([
        this.prisma.conversation.findUnique({
          where: { id: conversationId },
          select: { name: true, remoteJid: true },
        }),
        this.prisma.membership.findFirst({
          where: { organizationId, role: 'OWNER' },
          include: { user: { select: { email: true, locale: true } } },
        }),
      ]);
      if (!owner) return;
      const contact =
        convo?.name ?? `+${(convo?.remoteJid ?? '').split('@')[0]}`;
      const base = this.config
        .get<string>('WEB_ORIGIN', 'http://localhost:3000')
        .split(',')[0]
        .trim();
      await this.mail.sendAgentNotify({
        to: owner.user.email,
        locale: owner.user.locale,
        agentName,
        contact,
        message,
        conversationUrl: `${base}/dashboard/messages?c=${conversationId}`,
      });
      this.log.log(
        `Agent "${agentName}" notified the owner about ${conversationId}`,
      );
    } catch (e) {
      this.log.warn(`notify_owner email failed: ${e}`);
    }
  }

  /**
   * Email the teammates who can actually work this session (respecting
   * per-member session restrictions) that the agent handed off.
   */
  private async notifyHandoff(
    organizationId: string,
    sessionId: string,
    conversationId: string,
    agentName: string,
    reason: string,
  ): Promise<void> {
    try {
      const [convo, memberships] = await Promise.all([
        this.prisma.conversation.findUnique({
          where: { id: conversationId },
          select: { name: true, remoteJid: true },
        }),
        this.prisma.membership.findMany({
          where: { organizationId },
          include: { user: { select: { email: true, locale: true } } },
          take: 20,
        }),
      ]);
      const contact =
        convo?.name ?? `+${(convo?.remoteJid ?? '').split('@')[0]}`;
      const base = this.config
        .get<string>('WEB_ORIGIN', 'http://localhost:3000')
        .split(',')[0]
        .trim();
      const url = `${base}/dashboard/messages?c=${conversationId}`;
      const recipients = memberships.filter(
        (m) =>
          m.role === 'OWNER' ||
          m.role === 'ADMIN' ||
          (m.role === 'MEMBER' &&
            (m.sessionIds.length === 0 || m.sessionIds.includes(sessionId))),
      );
      await Promise.all(
        recipients.map((m) =>
          this.mail.sendAgentHandoff({
            to: m.user.email,
            locale: m.user.locale,
            agentName,
            contact,
            reason,
            conversationUrl: url,
          }),
        ),
      );
    } catch (e) {
      this.log.warn(`Handoff notification failed: ${e}`);
    }
  }

  /** Fetch + cache the WhatsApp profile picture for a conversation. */
  private async refreshAvatar(
    sessionId: string,
    conversationId: string,
    remoteJid: string,
  ): Promise<void> {
    try {
      const live = this.sessions.get(sessionId);
      if (!live) return;
      const url = await live.sock
        .profilePictureUrl(remoteJid, 'image')
        .catch(() => null);
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { avatarUrl: url ?? null, avatarFetchedAt: new Date() },
      });
    } catch (e) {
      this.log.debug(`Avatar refresh failed for ${conversationId}: ${e}`);
    }
  }

  /** Set/replace/remove one reactor's reaction on the targeted message. */
  private async applyReaction(
    sessionId: string,
    r: {
      targetWaMessageId: string | null;
      emoji: string;
      reactor: string;
      reactorName: string | null;
    },
  ): Promise<void> {
    if (!r.targetWaMessageId) return;
    const target = await this.prisma.message.findFirst({
      where: { sessionId, waMessageId: r.targetWaMessageId },
      select: { id: true, reactions: true },
    });
    if (!target) return; // reacting to a message outside our history
    const by = r.reactorName ?? r.reactor.split('@')[0];
    const existing = Array.isArray(target.reactions)
      ? (target.reactions as { emoji: string; by: string; key?: string }[])
      : [];
    const others = existing.filter((x) => x.key !== r.reactor);
    const next = r.emoji
      ? [...others, { emoji: r.emoji, by, key: r.reactor }]
      : others;
    await this.prisma.message.update({
      where: { id: target.id },
      data: { reactions: next },
    });
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

    // Refresh the contact's profile picture at most once a day, off the hot
    // path — failures (privacy settings, no photo) just stamp the attempt.
    const AVATAR_TTL_MS = 24 * 60 * 60 * 1000;
    if (
      !conversation.avatarFetchedAt ||
      Date.now() - conversation.avatarFetchedAt.getTime() > AVATAR_TTL_MS
    ) {
      void this.refreshAvatar(p.sessionId, conversation.id, p.remoteJid);
    }

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
    this.intentionalLogouts.add(sessionId);
    // Self-clean: the close event fires within seconds; the grace window
    // just needs to outlive it.
    setTimeout(() => this.intentionalLogouts.delete(sessionId), 30_000);
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
