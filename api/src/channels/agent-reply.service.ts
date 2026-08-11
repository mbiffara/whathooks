import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Agent, MessageSource } from '@prisma/client';
import { AgentRunnerService } from '../agents/agent-runner.service';
import { QuotaService } from '../billing/quota.service';
import { addressLabel } from '../common/address';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
// Pure schedule helper; lives under whatsapp/ for historical reasons and has
// no module dependency of its own.
import { agentActiveNow } from '../whatsapp/agent-schedule';
import type { ChannelDriver } from './channel-driver';

/**
 * "Should the AI answer this, and if so, say it."
 *
 * Lifted out of ConnectionManagerService so a second channel can reuse the
 * gates rather than reimplement them. Getting any of them wrong is expensive
 * in a way that is easy to miss: replying outside the agent's hours, replying
 * while an operator has taken the thread over, or spending LLM tokens on a
 * reply the org has no quota to send.
 *
 * Everything WhatsApp-shaped is passed in rather than assumed. The typing
 * indicator is an optional hook because only WhatsApp has one, and mentions
 * are optional because only WhatsApp has groups to mention into.
 */
@Injectable()
export class AgentReplyService {
  private readonly log = new Logger(AgentReplyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentRunner: AgentRunnerService,
    private readonly quota: QuotaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Reply as `agent` if every gate allows it. Never throws: an inbound message
   * must not fail because the automated reply could not be produced.
   */
  async maybeReply(ctx: {
    driver: ChannelDriver;
    agent: Agent;
    sessionId: string;
    organizationId: string;
    conversationId: string;
    remoteJid: string;
    /** WhatsApp group mention; the text must carry the "@<number>" token. */
    mention?: { jid: string; number: string };
    /** WhatsApp shows "typing…" for the delay; other channels just wait. */
    onTyping?: (ms: number) => Promise<void>;
  }): Promise<void> {
    const { agent, driver } = ctx;
    if (!this.agentRunner.isConfigured()) return;
    if (!agent.enabled) return;
    if (!agentActiveNow(agent)) return; // outside its scheduled hours

    // Agents send on the org's behalf, so they respect the same quota gate as
    // manual sends (subscription + monthly cap). Skip quietly — an inbound
    // message must never fail because the reply was over quota. Checked before
    // generateReply so no LLM tokens are spent on a reply we can't send.
    try {
      await this.quota.assertCanSend(ctx.organizationId);
    } catch {
      this.log.warn(
        `Agent reply skipped for org ${ctx.organizationId}: over quota or no active subscription`,
      );
      return;
    }

    // An operator can pause the agent on a single conversation to reply
    // manually.
    const convo = await this.prisma.conversation.findUnique({
      where: { id: ctx.conversationId },
      select: { agentPaused: true },
    });
    if (convo?.agentPaused) return;

    try {
      const reply = await this.agentRunner.generateReply(
        agent,
        ctx.conversationId,
      );
      if (!reply) return;
      if (!driver.isLive(ctx.sessionId)) return; // disconnected meanwhile

      if (reply.text) {
        const text = ctx.mention
          ? `@${ctx.mention.number} ${reply.text}`
          : reply.text;
        // Optional human-like pause before answering.
        const delayMs = randomDelayMs(agent);
        if (delayMs > 0) {
          if (ctx.onTyping) await ctx.onTyping(delayMs);
          else await new Promise((r) => setTimeout(r, delayMs));
        }
        await driver.sendText(ctx.sessionId, ctx.remoteJid, text, {
          source: MessageSource.AGENT,
          agentId: agent.id,
          mentions: ctx.mention ? [ctx.mention.jid] : undefined,
        });
      }

      // The agent called notify_owner → email the account owner. Does not
      // pause the agent (unlike handoff).
      if (reply.notify) {
        void this.notifyOwner(
          ctx.organizationId,
          ctx.conversationId,
          agent.name,
          reply.notify,
        );
      }

      // The agent asked to hand off → pause it on this conversation until an
      // operator resumes. Same flag the operator toggles manually.
      if (reply.handoff) {
        const reason =
          reply.reason?.trim() || 'The agent wasn’t sure how to respond.';
        await this.prisma.conversation.update({
          where: { id: ctx.conversationId },
          data: { agentPaused: true, agentPausedReason: reason },
        });
        this.log.log(
          `Agent "${agent.name}" handed off conversation ${ctx.conversationId}` +
            (reply.reason ? `: ${reply.reason}` : ''),
        );
        if (agent.notifyOnHandoff) {
          void this.notifyHandoff(
            ctx.organizationId,
            ctx.sessionId,
            ctx.conversationId,
            agent.name,
            reason,
          );
        }
      }
    } catch (e) {
      this.log.error(`Agent reply failed for ${ctx.sessionId}: ${e}`);
    }
  }

  async notifyOwner(
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
      const contact = addressLabel(convo?.remoteJid ?? '', convo?.name);
      await this.mail.sendAgentNotify({
        to: owner.user.email,
        locale: owner.user.locale,
        agentName,
        contact,
        message,
        conversationUrl: `${this.webBase()}/dashboard/messages?c=${conversationId}`,
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
   * per-member session access).
   */
  async notifyHandoff(
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
      const contact = addressLabel(convo?.remoteJid ?? '', convo?.name);
      const url = `${this.webBase()}/dashboard/messages?c=${conversationId}`;
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

  private webBase(): string {
    return (
      this.config.get<string>('WEB_ORIGIN', 'http://localhost:3000') ?? ''
    )
      .split(',')[0]
      .trim();
  }
}

function randomDelayMs(agent: {
  replyDelayMinSeconds: number;
  replyDelayMaxSeconds: number;
}): number {
  const min = Math.max(0, agent.replyDelayMinSeconds);
  const max = Math.max(min, agent.replyDelayMaxSeconds);
  if (max <= 0) return 0;
  return Math.round((min + Math.random() * (max - min)) * 1000);
}
