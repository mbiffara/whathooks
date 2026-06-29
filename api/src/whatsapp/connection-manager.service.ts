import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { WaSessionStatus } from '@prisma/client';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  proto,
  WAMessage,
  WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
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
  private shuttingDown = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhookDispatchService,
  ) {}

  /** Restore previously-connected sockets after a restart. */
  async onModuleInit() {
    const sessions = await this.prisma.waSession.findMany({
      where: { status: { in: ['CONNECTED', 'CONNECTING', 'QR', 'DISCONNECTED'] } },
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

    live.starting = false;
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
    const { type, text } = normalizeMessage(msg);

    const content = {
      text,
      pushName: msg.pushName ?? null,
      raw: JSON.parse(JSON.stringify(msg.message)),
    };

    const logEntry = await this.prisma.messageLog.create({
      data: {
        organizationId,
        sessionId,
        direction: 'INBOUND',
        waMessageId: msg.key.id ?? null,
        remoteJid,
        fromMe: false,
        type,
        content,
        status: 'RECEIVED',
      },
    });

    await this.webhooks.dispatch({
      organizationId,
      sessionId,
      event: 'message.received',
      messageLogId: logEntry.id,
      payload: {
        id: logEntry.id,
        sessionId,
        from: remoteJid,
        pushName: msg.pushName ?? null,
        type,
        text,
        waMessageId: msg.key.id ?? null,
        timestamp: Number(msg.messageTimestamp) || null,
      },
    });
  }

  /** Send a text message and log it. Returns the WhatsApp message id. */
  async sendText(
    sessionId: string,
    to: string,
    text: string,
  ): Promise<{ waMessageId: string | null; logId: string }> {
    const live = this.sessions.get(sessionId);
    if (!live) throw new Error('Session is not connected');

    const jid = toJid(to);
    const sent = await live.sock.sendMessage(jid, { text });
    const organizationId = await this.orgIdOf(sessionId);

    const log = await this.prisma.messageLog.create({
      data: {
        organizationId,
        sessionId,
        direction: 'OUTBOUND',
        waMessageId: sent?.key?.id ?? null,
        remoteJid: jid,
        fromMe: true,
        type: 'text',
        content: { text },
        status: 'SENT',
      },
    });
    return { waMessageId: sent?.key?.id ?? null, logId: log.id };
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

function normalizeMessage(msg: WAMessage): { type: string; text: string | null } {
  const m = msg.message ?? {};
  if (m.conversation) return { type: 'text', text: m.conversation };
  if (m.extendedTextMessage?.text)
    return { type: 'text', text: m.extendedTextMessage.text };
  if (m.imageMessage) return { type: 'image', text: m.imageMessage.caption ?? null };
  if (m.videoMessage) return { type: 'video', text: m.videoMessage.caption ?? null };
  if (m.audioMessage) return { type: 'audio', text: null };
  if (m.documentMessage)
    return { type: 'document', text: m.documentMessage.caption ?? null };
  if (m.stickerMessage) return { type: 'sticker', text: null };
  if (m.locationMessage) return { type: 'location', text: null };
  if (m.contactMessage) return { type: 'contact', text: null };
  const [key] = Object.keys(m);
  return { type: key ?? 'unknown', text: null };
}

// Accept a bare msisdn ("15551234567"), or a full jid.
function toJid(to: string): string {
  if (to.includes('@')) return to;
  const digits = to.replace(/[^0-9]/g, '');
  return `${digits}@s.whatsapp.net`;
}

export { proto };
